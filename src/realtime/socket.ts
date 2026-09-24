import { randomUUID } from 'node:crypto';
import type { Server as HttpServer } from 'node:http';

import { createAdapter } from '@socket.io/redis-adapter';
import { and, eq } from 'drizzle-orm';
import { jwtVerify } from 'jose';
import { Server } from 'socket.io';
import { z } from 'zod';

import { env, corsOrigins } from '../config/env';
import type { Database } from '../database/client';
import { gameEvents, games, roomMembers, rooms } from '../database/schema';
import type { RedisClient } from '../infrastructure/redis';
import { realtimeEvents, type GameUpdatedEvent, type RoomClosedEvent } from './events';
import { AppError } from '../shared/errors';
import { scheduleBotTurn, scheduleNextHand } from '../modules/games/bot.service';
import {
  canBotAct,
  applyGameAction,
  toPublicGameState,
  type GameActionType,
  type GameState,
} from '../modules/games/game.engine';

const jwtSecret = new TextEncoder().encode(env.JWT_SECRET);

const joinRoomSchema = z.object({ roomId: z.string().uuid() });
const gameCommandSchema = z.object({
  gameId: z.string().uuid(),
  commandId: z.string().uuid(),
  type: z.string().min(1).max(80),
  expectedVersion: z.number().int().nonnegative(),
  payload: z.record(z.string(), z.unknown()).default({}),
});

type SocketDependencies = {
  database: Database;
  redis: RedisClient;
};

function extractToken(
  socket: Parameters<NonNullable<Parameters<Server['use']>[0]>>[0],
): string | undefined {
  const authToken = socket.handshake.auth.token;
  if (typeof authToken === 'string') {
    return authToken.replace(/^Bearer\s+/i, '');
  }

  const authorization = socket.handshake.headers.authorization;
  return typeof authorization === 'string' ? authorization.replace(/^Bearer\s+/i, '') : undefined;
}

export async function createSocketServer(
  httpServer: HttpServer,
  dependencies: SocketDependencies,
): Promise<{ io: Server; close: () => Promise<void> }> {
  const io = new Server(httpServer, {
    cors: {
      origin: corsOrigins,
      credentials: false,
    },
    transports: ['websocket', 'polling'],
    pingInterval: 25_000,
    pingTimeout: 20_000,
    maxHttpBufferSize: 32 * 1024,
  });

  const pubClient = dependencies.redis.duplicate();
  const subClient = dependencies.redis.duplicate();
  await Promise.all([pubClient.connect(), subClient.connect()]);
  io.adapter(createAdapter(pubClient, subClient));

  const emitGameUpdated = (event: GameUpdatedEvent) => {
    io.to(`room:${event.roomId}`).emit('game:updated', {
      gameId: event.gameId,
      stateVersion: event.stateVersion,
    });
  };
  const emitRoomClosed = (event: RoomClosedEvent) => {
    io.to(`room:${event.roomId}`).emit('room:closed', { roomId: event.roomId });
  };
  realtimeEvents.on('game:updated', emitGameUpdated);
  realtimeEvents.on('room:closed', emitRoomClosed);

  io.use(async (socket, next) => {
    try {
      const token = extractToken(socket);
      if (!token) {
        throw new AppError(401, 'AUTH_REQUIRED', 'Se requiere un token para conectar.');
      }

      const { payload } = await jwtVerify(token, jwtSecret, { algorithms: ['HS256'] });
      if (payload.type !== 'access' || typeof payload.sub !== 'string') {
        throw new AppError(401, 'INVALID_ACCESS_TOKEN', 'El access token no es válido.');
      }

      socket.data.userId = payload.sub;
      next();
    } catch {
      next(new Error('UNAUTHORIZED'));
    }
  });

  io.on('connection', (socket) => {
    socket.on('room:join', async (rawPayload, acknowledge) => {
      try {
        const { roomId } = joinRoomSchema.parse(rawPayload);
        const [membership] = await dependencies.database
          .select()
          .from(roomMembers)
          .where(and(eq(roomMembers.roomId, roomId), eq(roomMembers.userId, socket.data.userId)))
          .limit(1);

        if (!membership) {
          throw new AppError(403, 'ROOM_ACCESS_DENIED', 'No perteneces a esta sala.');
        }

        await socket.join(`room:${roomId}`);
        acknowledge?.({ ok: true, roomId });
        socket.to(`room:${roomId}`).emit('room:member_online', { userId: socket.data.userId });
      } catch (error) {
        const appError =
          error instanceof AppError
            ? error
            : new AppError(400, 'INVALID_ROOM_JOIN', 'No se pudo unir a la sala.');
        acknowledge?.({ ok: false, error: { code: appError.code, message: appError.message } });
      }
    });

    socket.on('game:command', async (rawPayload, acknowledge) => {
      try {
        const command = gameCommandSchema.parse(rawPayload);
        const [membership] = await dependencies.database
          .select({ roomId: games.roomId })
          .from(games)
          .innerJoin(roomMembers, eq(roomMembers.roomId, games.roomId))
          .where(and(eq(games.id, command.gameId), eq(roomMembers.userId, socket.data.userId)))
          .limit(1);

        if (!membership) {
          throw new AppError(403, 'GAME_ACCESS_DENIED', 'No tienes acceso a esta partida.');
        }

        const commandId = command.commandId ?? randomUUID();
        const result = await dependencies.database.transaction(async (transaction) => {
          const [game] = await transaction
            .select()
            .from(games)
            .where(eq(games.id, command.gameId))
            .for('update')
            .limit(1);

          if (!game || game.roomId !== membership.roomId) {
            throw new AppError(404, 'GAME_NOT_FOUND', 'La partida no existe.');
          }

          if (game.status === 'finished') {
            throw new AppError(409, 'GAME_FINISHED', 'La partida ya terminó.');
          }

          if (command.expectedVersion !== game.stateVersion) {
            throw new AppError(
              409,
              'GAME_VERSION_CONFLICT',
              'La partida cambió; sincroniza el estado.',
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
            return {
              game,
              state: game.state as unknown as GameState,
              shouldScheduleBot: false,
            };
          }

          const cardId =
            typeof command.payload.cardId === 'string' ? command.payload.cardId : undefined;
          const currentState = game.state as unknown as GameState;
          const stateAfterAction = applyGameAction(currentState, socket.data.userId, {
            type: command.type as GameActionType,
            cardId,
          });
          const nextState = stateAfterAction;
          const nextStatus =
            Math.max(nextState.scores.A, nextState.scores.B) >= nextState.targetScore
              ? 'finished'
              : 'in_progress';
          const nextVersion = game.stateVersion + 1;
          const [updatedGame] = await transaction
            .update(games)
            .set({
              status: nextStatus,
              stateVersion: nextVersion,
              state: nextState as unknown as Record<string, unknown>,
              updatedAt: new Date(),
            })
            .where(eq(games.id, game.id))
            .returning();

          if (!updatedGame) {
            throw new AppError(500, 'GAME_UPDATE_FAILED', 'No se pudo actualizar la partida.');
          }

          await transaction.insert(gameEvents).values({
            gameId: game.id,
            version: nextVersion,
            type: command.type,
            commandId,
            actorId: socket.data.userId,
            payload: command.payload,
          });

          if (nextStatus === 'finished') {
            await transaction
              .update(rooms)
              .set({ status: 'finished', updatedAt: new Date() })
              .where(eq(rooms.id, game.roomId));
          }

          return {
            game: updatedGame,
            state: nextState,
            shouldScheduleBot: nextStatus === 'in_progress' && canBotAct(nextState),
          };
        });

        acknowledge?.({
          ok: true,
          game: {
            id: result.game.id,
            roomId: result.game.roomId,
            status: result.game.status,
            stateVersion: result.game.stateVersion,
            state: toPublicGameState(result.state, socket.data.userId),
          },
        });
        realtimeEvents.emit('game:updated', {
          roomId: membership.roomId,
          gameId: result.game.id,
          stateVersion: result.game.stateVersion,
        });
        if (result.game.status === 'in_progress') {
          if (result.state.handStatus === 'finished') {
            scheduleNextHand(dependencies.database, result.game.id);
          } else if (result.shouldScheduleBot) {
            scheduleBotTurn(dependencies.database, result.game.id);
          }
        }
      } catch (error) {
        const appError =
          error instanceof AppError
            ? error
            : new AppError(400, 'INVALID_GAME_COMMAND', 'El comando de juego no es válido.');
        acknowledge?.({ ok: false, error: { code: appError.code, message: appError.message } });
      }
    });

    socket.on('disconnect', () => {
      // La presencia persistente se manejará con TTL en Redis cuando se agregue el matchmaking.
    });
  });

  return {
    io,
    close: async () => {
      realtimeEvents.off('game:updated', emitGameUpdated);
      realtimeEvents.off('room:closed', emitRoomClosed);
      await io.close();
      await Promise.all([pubClient.quit(), subClient.quit()]);
    },
  };
}
