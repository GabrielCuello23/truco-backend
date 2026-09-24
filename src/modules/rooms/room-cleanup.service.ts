import { and, inArray, lt } from 'drizzle-orm';

import type { Database } from '../../database/client';
import { games, rooms } from '../../database/schema';

export type RoomCleanupResult = {
  roomIds: string[];
};

export async function abandonStaleRooms(
  database: Database,
  options: { inactivityTtlMs: number; now?: Date },
): Promise<RoomCleanupResult> {
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - options.inactivityTtlMs);

  const roomIds = await database.transaction(async (transaction) => {
    const staleGames = await transaction
      .update(games)
      .set({ status: 'abandoned', updatedAt: now })
      .where(and(inArray(games.status, ['in_progress']), lt(games.updatedAt, cutoff)))
      .returning({ roomId: games.roomId });

    const staleWaitingRooms = await transaction
      .update(rooms)
      .set({ status: 'abandoned', updatedAt: now })
      .where(and(inArray(rooms.status, ['waiting']), lt(rooms.updatedAt, cutoff)))
      .returning({ id: rooms.id });

    const staleInProgressRoomIds = [...new Set(staleGames.map((game) => game.roomId))];
    const staleInProgressRooms =
      staleInProgressRoomIds.length > 0
        ? await transaction
            .update(rooms)
            .set({ status: 'abandoned', updatedAt: now })
            .where(
              and(
                inArray(rooms.id, staleInProgressRoomIds),
                inArray(rooms.status, ['in_progress']),
              ),
            )
            .returning({ id: rooms.id })
        : [];

    return [
      ...staleWaitingRooms.map((room) => room.id),
      ...staleInProgressRooms.map((room) => room.id),
    ];
  });

  return { roomIds };
}
