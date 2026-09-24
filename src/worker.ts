import { Worker } from 'bullmq';

import { env } from './config/env';
import { closeDatabase, db } from './database/client';
import {
  createQueueConnection,
  createRoomCleanupQueue,
  GAME_EVENTS_QUEUE,
  ROOM_CLEANUP_QUEUE,
} from './jobs/queues';
import { serializeRealtimeEvent, REALTIME_EVENTS_CHANNEL } from './realtime/events';
import { abandonStaleRooms } from './modules/rooms/room-cleanup.service';

async function main(): Promise<void> {
  const connection = createQueueConnection();
  const gameWorker = new Worker(
    GAME_EVENTS_QUEUE,
    async (job) => {
      console.log(`Processing ${job.name}`, job.data);
    },
    { connection },
  );
  const cleanupQueue = createRoomCleanupQueue(connection);
  const cleanupWorker = new Worker(
    ROOM_CLEANUP_QUEUE,
    async () => {
      const result = await abandonStaleRooms(db, {
        inactivityTtlMs: env.ROOM_INACTIVITY_TTL_HOURS * 60 * 60 * 1000,
      });

      for (const roomId of result.roomIds) {
        await connection.publish(
          REALTIME_EVENTS_CHANNEL,
          serializeRealtimeEvent({ type: 'room:closed', roomId }),
        );
      }

      if (result.roomIds.length > 0) {
        console.log(`Abandoned ${result.roomIds.length} stale room(s)`);
      }

      return result;
    },
    { connection },
  );

  await cleanupQueue.upsertJobScheduler(
    'stale-room-cleanup',
    { every: env.ROOM_CLEANUP_INTERVAL_SECONDS * 1000 },
    {
      name: 'cleanup-stale-rooms',
      data: {},
      opts: { removeOnComplete: 100, removeOnFail: 1000 },
    },
  );

  gameWorker.on('completed', (job) => {
    console.log(`Job ${job.id} completed`);
  });
  gameWorker.on('failed', (job, error) => {
    console.error(`Job ${job?.id ?? 'unknown'} failed`, error);
  });
  cleanupWorker.on('failed', (job, error) => {
    console.error(`Room cleanup job ${job?.id ?? 'unknown'} failed`, error);
  });

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`Received ${signal}; stopping worker`);
    await Promise.all([gameWorker.close(), cleanupWorker.close(), cleanupQueue.close()]);
    await connection.quit();
    await closeDatabase();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  console.log(`Worker ready for ${env.NODE_ENV}`);
}

void main().catch((error: unknown) => {
  console.error('Unable to start worker', error);
  process.exitCode = 1;
});
