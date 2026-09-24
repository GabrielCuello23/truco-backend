import { randomInt, randomUUID } from 'node:crypto';

import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';

import type { Database } from '../../database/client';
import { gameEvents, games, roomMembers, rooms, users } from '../../database/schema';
import { requireAuth } from '../../middlewares/auth';
import { realtimeEvents } from '../../realtime/events';
import { AppError } from '../../shared/errors';
import { scheduleBotTurn, scheduleNextHand } from '../games/bot.service';
import {
  applyGameAction,
  BOT_PLAYER_ID,
  canBotAct,
  createInitialGameState,
  toPublicGameState,
  type GameActionType,
  type GameState,
} from '../games/game.engine';

const createRoomSchema = z.object({
  maxPlayers: z.number().int().min(2).max(4).default(4),
  targetScore: z.union([z.literal(15), z.literal(30)]).default(30),
  withFlor: z.boolean().default(true),
});

const roomIdSchema = z.string().uuid();
const joinRoomSchema = z.object({
  code: z.string().trim().toUpperCase().length(6),
});
const gameRoomIdSchema = z.string().uuid();
const startGameSchema = z.object({}).default({});
const gameActionSchema = z.object({
  type: z.enum([
    'truco',
    'retruco',
    'vale_cuatro',
    'envido',
    'real_envido',
    'falta_envido',
    'flor',
    'contra_flor',
    'contra_flor_al_resto',
    'quiero',
    'no_quiero',
    'fold',
    'play_card',
    'new_hand',
  ]),
  cardId: z.string().min(1).optional(),
  expectedVersion: z.number().int().nonnegative().optional(),
  commandId: z.string().uuid().optional(),
});
const codeAlphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateRoomCode(): string {
  return Array.from({ length: 6 }, () => codeAlphabet[randomInt(codeAlphabet.length)]).join('');
}

export function createRoomRouter(database: Database): Router {
  const router = Router();
  router.use(requireAuth);

  async function assertRoomMember(roomId: string, userId: string) {
    const [membership] = await database
      .select()
      .from(roomMembers)
      .where(
        and(
          eq(roomMembers.roomId, roomId),
          eq(roomMembers.userId, userId),
          isNull(roomMembers.leftAt),
        ),
      )
      .limit(1);

    if (!membership) {
      throw new AppError(403, 'ROOM_ACCESS_DENIED', 'No perteneces a esta sala.');
    }

    return membership;
  }

  async function getCurrentGame(roomId: string) {
    const [game] = await database
      .select()
      .from(games)
      .where(
        and(
          eq(games.roomId, roomId),
          inArray(games.status, ['waiting', 'in_progress', 'finished']),
        ),
      )
      .orderBy(desc(games.createdAt))
      .limit(1);

    return game;
  }

  router.post('/', async (request, response) => {
    const input = createRoomSchema.parse(request.body ?? {});
    const userId = request.auth!.userId;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const result = await database.transaction(async (transaction) => {
          const [room] = await transaction
            .insert(rooms)
            .values({
              code: generateRoomCode(),
              hostId: userId,
              maxPlayers: input.maxPlayers,
              targetScore: input.targetScore,
              withFlor: input.withFlor,
            })
            .returning();

          if (!room) {
            throw new AppError(500, 'ROOM_CREATION_FAILED', 'No se pudo crear la sala.');
          }

          await transaction.insert(roomMembers).values({
            roomId: room.id,
            userId,
            role: 'host',
          });

          return room;
        });

        response.status(201).json({ room: result });
        return;
      } catch (error) {
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          error.code === '23505'
        ) {
          continue;
        }

        throw error;
      }
    }

    throw new AppError(503, 'ROOM_CODE_UNAVAILABLE', 'No se pudo reservar un código de sala.');
  });

  router.post('/bot', async (request, response) => {
    const input = createRoomSchema.parse(request.body ?? {});
    const userId = request.auth!.userId;

    const result = await database.transaction(async (transaction) => {
      const [user] = await transaction.select().from(users).where(eq(users.id, userId)).limit(1);
      if (!user) {
        throw new AppError(404, 'USER_NOT_FOUND', 'Usuario no encontrado.');
      }

      const [room] = await transaction
        .insert(rooms)
        .values({
          code: generateRoomCode(),
          hostId: userId,
          maxPlayers: 2,
          status: 'in_progress',
          targetScore: input.targetScore,
          withFlor: input.withFlor,
        })
        .returning();

      if (!room) {
        throw new AppError(500, 'ROOM_CREATION_FAILED', 'No se pudo crear la sala contra el bot.');
      }

      await transaction.insert(roomMembers).values({
        roomId: room.id,
        userId,
        role: 'host',
      });

      const state = createInitialGameState(
        [
          { id: user.id, displayName: user.displayName },
          { id: BOT_PLAYER_ID, displayName: 'Bot' },
        ],
        input.targetScore,
        input.withFlor,
      );
      const [game] = await transaction
        .insert(games)
        .values({
          roomId: room.id,
          status: 'in_progress',
          stateVersion: 0,
          state: state as unknown as Record<string, unknown>,
        })
        .returning();

      if (!game) {
        throw new AppError(
          500,
          'GAME_CREATION_FAILED',
          'No se pudo iniciar la partida contra el bot.',
        );
      }

      return { room, game, state };
    });

    realtimeEvents.emit('game:updated', {
      roomId: result.game.roomId,
      gameId: result.game.id,
      stateVersion: result.game.stateVersion,
    });

    response.status(201).json({
      room: result.room,
      members: [
        {
          id: userId,
          displayName: result.state.players[0]!.displayName,
          role: 'host',
          joinedAt: result.room.createdAt,
        },
      ],
      game: {
        id: result.game.id,
        roomId: result.game.roomId,
        status: result.game.status,
        stateVersion: result.game.stateVersion,
        state: toPublicGameState(result.state, userId),
      },
    });
  });

  router.post('/join', async (request, response) => {
    const { code } = joinRoomSchema.parse(request.body);
    const userId = request.auth!.userId;

    const room = await database.transaction(async (transaction) => {
      const [roomRecord] = await transaction
        .select()
        .from(rooms)
        .where(eq(rooms.code, code))
        .for('update')
        .limit(1);

      if (!roomRecord) {
        throw new AppError(404, 'ROOM_NOT_FOUND', 'Sala no encontrada.');
      }

      const [existingMembership] = await transaction
        .select()
        .from(roomMembers)
        .where(and(eq(roomMembers.roomId, roomRecord.id), eq(roomMembers.userId, userId)))
        .limit(1);

      if (existingMembership) {
        return roomRecord;
      }

      if (roomRecord.status !== 'waiting') {
        throw new AppError(409, 'ROOM_NOT_OPEN', 'La sala ya no acepta nuevos jugadores.');
      }

      const members = await transaction
        .select({ userId: roomMembers.userId })
        .from(roomMembers)
        .where(eq(roomMembers.roomId, roomRecord.id));

      if (members.length >= roomRecord.maxPlayers) {
        throw new AppError(409, 'ROOM_FULL', 'La sala ya alcanzó su capacidad máxima.');
      }

      await transaction.insert(roomMembers).values({
        roomId: roomRecord.id,
        userId,
        role: 'player',
      });

      const [updatedRoom] = await transaction
        .update(rooms)
        .set({ updatedAt: new Date() })
        .where(eq(rooms.id, roomRecord.id))
        .returning();

      return updatedRoom ?? roomRecord;
    });

    const members = await database
      .select({
        id: users.id,
        displayName: users.displayName,
        role: roomMembers.role,
        joinedAt: roomMembers.joinedAt,
      })
      .from(roomMembers)
      .innerJoin(users, eq(users.id, roomMembers.userId))
      .where(eq(roomMembers.roomId, room.id));

    response.status(200).json({ room, members });
  });

  router.get('/:roomId', async (request, response) => {
    const roomId = roomIdSchema.parse(request.params.roomId);
    const userId = request.auth!.userId;

    const [membership] = await database
      .select()
      .from(roomMembers)
      .where(
        and(
          eq(roomMembers.roomId, roomId),
          eq(roomMembers.userId, userId),
          isNull(roomMembers.leftAt),
        ),
      )
      .limit(1);

    if (!membership) {
      throw new AppError(403, 'ROOM_ACCESS_DENIED', 'No perteneces a esta sala.');
    }

    const [room] = await database.select().from(rooms).where(eq(rooms.id, roomId)).limit(1);

    if (!room) {
      throw new AppError(404, 'ROOM_NOT_FOUND', 'Sala no encontrada.');
    }

    const members = await database
      .select({
        id: users.id,
        displayName: users.displayName,
        role: roomMembers.role,
        joinedAt: roomMembers.joinedAt,
      })
      .from(roomMembers)
      .innerJoin(users, eq(users.id, roomMembers.userId))
      .where(eq(roomMembers.roomId, roomId));

    const game = await getCurrentGame(roomId);
    response
      .status(200)
      .json({ room, members, game: game ? { id: game.id, status: game.status } : null });
  });

  router.delete('/:roomId', async (request, response) => {
    const roomId = roomIdSchema.parse(request.params.roomId);
    const userId = request.auth!.userId;

    await database.transaction(async (transaction) => {
      const [membership] = await transaction
        .select()
        .from(roomMembers)
        .where(
          and(
            eq(roomMembers.roomId, roomId),
            eq(roomMembers.userId, userId),
            isNull(roomMembers.leftAt),
          ),
        )
        .limit(1);

      if (!membership) {
        throw new AppError(403, 'ROOM_ACCESS_DENIED', 'No perteneces a esta sala.');
      }

      const [room] = await transaction
        .select({ id: rooms.id })
        .from(rooms)
        .where(eq(rooms.id, roomId))
        .for('update')
        .limit(1);

      if (!room) {
        throw new AppError(404, 'ROOM_NOT_FOUND', 'Sala no encontrada.');
      }

      await transaction.delete(rooms).where(eq(rooms.id, roomId));
    });

    realtimeEvents.emit('room:closed', { roomId });
    response.status(204).send();
  });

  router.post('/:roomId/game', async (request, response) => {
    const roomId = gameRoomIdSchema.parse(request.params.roomId);
    startGameSchema.parse(request.body ?? {});
    const userId = request.auth!.userId;
    const membership = await assertRoomMember(roomId, userId);

    const game = await database.transaction(async (transaction) => {
      const [room] = await transaction
        .select()
        .from(rooms)
        .where(eq(rooms.id, roomId))
        .for('update')
        .limit(1);
      if (!room) {
        throw new AppError(404, 'ROOM_NOT_FOUND', 'Sala no encontrada.');
      }

      if (membership.role !== 'host' && room.status !== 'finished') {
        throw new AppError(
          403,
          'ONLY_HOST_CAN_START',
          'Solo el anfitrión puede iniciar la partida; una partida terminada puede reiniciarse por cualquier jugador.',
        );
      }

      const [latestGame] = await transaction
        .select()
        .from(games)
        .where(eq(games.roomId, roomId))
        .orderBy(desc(games.createdAt))
        .limit(1);

      if (latestGame && ['waiting', 'in_progress'].includes(latestGame.status)) {
        return latestGame;
      }

      const previousState = latestGame?.state as unknown as GameState | undefined;
      const previousBotPlayers =
        room.status === 'finished' &&
        previousState?.players.some((player) => player.id === BOT_PLAYER_ID)
          ? previousState.players.map(({ id, displayName }) => ({ id, displayName }))
          : null;
      const members =
        previousBotPlayers ??
        (await transaction
          .select({ id: users.id, displayName: users.displayName })
          .from(roomMembers)
          .innerJoin(users, eq(users.id, roomMembers.userId))
          .where(and(eq(roomMembers.roomId, roomId), isNull(roomMembers.leftAt)))
          .orderBy(asc(roomMembers.joinedAt)));

      if (members.length !== 2 && members.length !== 4) {
        throw new AppError(
          409,
          'INVALID_PLAYER_COUNT',
          'La partida necesita 2 o 4 jugadores conectados.',
        );
      }

      const state = createInitialGameState(members, room.targetScore as 15 | 30, room.withFlor);
      const [createdGame] = await transaction
        .insert(games)
        .values({
          roomId,
          status: 'in_progress',
          stateVersion: 0,
          state: state as unknown as Record<string, unknown>,
        })
        .returning();

      if (!createdGame) {
        throw new AppError(500, 'GAME_CREATION_FAILED', 'No se pudo iniciar la partida.');
      }

      await transaction
        .update(rooms)
        .set({ status: 'in_progress', updatedAt: new Date() })
        .where(eq(rooms.id, roomId));

      return createdGame;
    });

    realtimeEvents.emit('game:updated', {
      roomId: game.roomId,
      gameId: game.id,
      stateVersion: game.stateVersion,
    });

    response.status(201).json({
      game: {
        id: game.id,
        roomId: game.roomId,
        status: game.status,
        stateVersion: game.stateVersion,
        state: toPublicGameState(game.state as unknown as GameState, userId),
      },
    });
  });

  router.get('/:roomId/game', async (request, response) => {
    const roomId = gameRoomIdSchema.parse(request.params.roomId);
    const userId = request.auth!.userId;
    await assertRoomMember(roomId, userId);
    const game = await getCurrentGame(roomId);

    if (!game) {
      throw new AppError(404, 'GAME_NOT_FOUND', 'La sala todavía no tiene una partida iniciada.');
    }

    response.status(200).json({
      game: {
        id: game.id,
        roomId: game.roomId,
        status: game.status,
        stateVersion: game.stateVersion,
        state: toPublicGameState(game.state as unknown as GameState, userId),
      },
    });
  });

  router.post('/:roomId/game/actions', async (request, response) => {
    const roomId = gameRoomIdSchema.parse(request.params.roomId);
    const input = gameActionSchema.parse(request.body);
    const userId = request.auth!.userId;
    await assertRoomMember(roomId, userId);
    const commandId = input.commandId ?? randomUUID();

    const result = await database.transaction(async (transaction) => {
      const [game] = await transaction
        .select()
        .from(games)
        .where(and(eq(games.roomId, roomId), inArray(games.status, ['in_progress', 'finished'])))
        .orderBy(desc(games.createdAt))
        .for('update')
        .limit(1);

      if (!game) {
        throw new AppError(404, 'GAME_NOT_FOUND', 'La sala todavía no tiene una partida iniciada.');
      }

      if (game.status === 'finished') {
        throw new AppError(409, 'GAME_FINISHED', 'La partida ya terminó.');
      }

      if (input.expectedVersion !== undefined && input.expectedVersion !== game.stateVersion) {
        throw new AppError(
          409,
          'GAME_VERSION_CONFLICT',
          'La partida cambió; actualiza el estado e intenta de nuevo.',
          {
            currentVersion: game.stateVersion,
          },
        );
      }

      const [existingEvent] = await transaction
        .select()
        .from(gameEvents)
        .where(and(eq(gameEvents.gameId, game.id), eq(gameEvents.commandId, commandId)))
        .limit(1);
      if (existingEvent) {
        return { game, state: game.state as unknown as GameState };
      }

      const currentState = game.state as unknown as GameState;
      const stateAfterAction = applyGameAction(currentState, userId, {
        type: input.type as GameActionType,
        cardId: input.cardId,
      });
      const nextState = stateAfterAction;
      const nextStatus =
        Math.max(nextState.scores.A, nextState.scores.B) >= nextState.targetScore
          ? 'finished'
          : 'in_progress';
      const nextVersion = game.stateVersion + 1;
      const now = new Date();
      const [updatedGame] = await transaction
        .update(games)
        .set({
          status: nextStatus,
          stateVersion: nextVersion,
          state: nextState as unknown as Record<string, unknown>,
          updatedAt: now,
        })
        .where(eq(games.id, game.id))
        .returning();

      if (!updatedGame) {
        throw new AppError(500, 'GAME_UPDATE_FAILED', 'No se pudo actualizar la partida.');
      }

      await transaction.insert(gameEvents).values({
        gameId: game.id,
        version: nextVersion,
        type: input.type,
        commandId,
        actorId: userId,
        payload: { cardId: input.cardId },
      });

      await transaction
        .update(rooms)
        .set({
          status: nextStatus === 'finished' ? 'finished' : 'in_progress',
          updatedAt: now,
        })
        .where(eq(rooms.id, roomId));

      return { game: updatedGame, state: nextState };
    });

    realtimeEvents.emit('game:updated', {
      roomId: result.game.roomId,
      gameId: result.game.id,
      stateVersion: result.game.stateVersion,
    });
    if (result.game.status === 'in_progress') {
      if (result.state.handStatus === 'finished') {
        scheduleNextHand(database, result.game.id);
      } else if (canBotAct(result.state)) {
        scheduleBotTurn(database, result.game.id);
      }
    }

    response.status(200).json({
      game: {
        id: result.game.id,
        roomId: result.game.roomId,
        status: result.game.status,
        stateVersion: result.game.stateVersion,
        state: toPublicGameState(result.state, userId),
      },
    });
  });

  return router;
}
