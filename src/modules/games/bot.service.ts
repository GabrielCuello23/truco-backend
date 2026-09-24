import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';

import type { Database } from '../../database/client';
import { gameEvents, games, rooms } from '../../database/schema';
import { realtimeEvents } from '../../realtime/events';
import {
  applyGameAction,
  canBotAct,
  getNextBotAction,
  BOT_PLAYER_ID,
  type GameState,
} from './game.engine';

export const BOT_TURN_DELAY_MS = 1500;
export const NEXT_HAND_DELAY_MS = 2000;

type BotTurnResult = {
  game: typeof games.$inferSelect;
  state: GameState;
};

export function scheduleBotTurn(database: Database, gameId: string): void {
  const timer = setTimeout(() => {
    void processBotTurn(database, gameId);
  }, BOT_TURN_DELAY_MS);

  timer.unref();
}

export function scheduleNextHand(database: Database, gameId: string): void {
  const timer = setTimeout(() => {
    void processNextHand(database, gameId);
  }, NEXT_HAND_DELAY_MS);

  timer.unref();
}

async function processNextHand(database: Database, gameId: string): Promise<void> {
  const result = await database.transaction<BotTurnResult | null>(async (transaction) => {
    const [game] = await transaction
      .select()
      .from(games)
      .where(eq(games.id, gameId))
      .for('update')
      .limit(1);

    if (!game || game.status === 'finished') {
      return null;
    }

    const currentState = game.state as unknown as GameState;
    if (
      currentState.handStatus !== 'finished' ||
      Math.max(currentState.scores.A, currentState.scores.B) >= currentState.targetScore
    ) {
      return null;
    }

    const nextState = applyGameAction(currentState, currentState.manoPlayerId, {
      type: 'new_hand',
    });
    const nextVersion = game.stateVersion + 1;
    const [updatedGame] = await transaction
      .update(games)
      .set({
        stateVersion: nextVersion,
        state: nextState as unknown as Record<string, unknown>,
        updatedAt: new Date(),
      })
      .where(eq(games.id, game.id))
      .returning();

    if (!updatedGame) {
      return null;
    }

    await transaction.insert(gameEvents).values({
      gameId: game.id,
      version: nextVersion,
      type: 'new_hand',
      commandId: randomUUID(),
      actorId: null,
      payload: { automatic: true },
    });

    return { game: updatedGame, state: nextState };
  });

  if (!result) {
    return;
  }

  realtimeEvents.emit('game:updated', {
    roomId: result.game.roomId,
    gameId: result.game.id,
    stateVersion: result.game.stateVersion,
  });

  if (result.game.status === 'in_progress' && canBotAct(result.state)) {
    scheduleBotTurn(database, result.game.id);
  }
}

export async function processBotTurn(database: Database, gameId: string): Promise<void> {
  const result = await database.transaction<BotTurnResult | null>(async (transaction) => {
    const [game] = await transaction
      .select()
      .from(games)
      .where(eq(games.id, gameId))
      .for('update')
      .limit(1);

    if (!game || game.status === 'finished') {
      return null;
    }

    const currentState = game.state as unknown as GameState;
    if (!canBotAct(currentState)) {
      return null;
    }

    const action = getNextBotAction(currentState);
    if (!action) {
      return null;
    }

    const nextState = applyGameAction(currentState, BOT_PLAYER_ID, action);
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
      return null;
    }

    await transaction.insert(gameEvents).values({
      gameId: game.id,
      version: nextVersion,
      type: action.type,
      commandId: randomUUID(),
      actorId: null,
      payload: {
        actorId: BOT_PLAYER_ID,
        type: action.type,
        ...(action.cardId ? { cardId: action.cardId } : {}),
      },
    });

    if (nextStatus === 'finished') {
      await transaction
        .update(rooms)
        .set({ status: 'finished', updatedAt: new Date() })
        .where(eq(rooms.id, game.roomId));
    }

    return { game: updatedGame, state: nextState };
  });

  if (!result) {
    return;
  }

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
}
