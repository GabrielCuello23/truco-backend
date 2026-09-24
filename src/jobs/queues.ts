import { Queue } from 'bullmq';
import IORedis from 'ioredis';

import { env } from '../config/env';

export const GAME_EVENTS_QUEUE = 'game-events';
export const ROOM_CLEANUP_QUEUE = 'room-cleanup';

export function createQueueConnection(): IORedis {
  return new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
}

export function createGameEventsQueue(connection: IORedis): Queue {
  return new Queue(GAME_EVENTS_QUEUE, { connection });
}

export function createRoomCleanupQueue(connection: IORedis): Queue {
  return new Queue(ROOM_CLEANUP_QUEUE, { connection });
}
