import { Queue } from 'bullmq';
import IORedis from 'ioredis';

import { env } from '../config/env';

export const GAME_EVENTS_QUEUE = 'game-events';

export function createQueueConnection(): IORedis {
  return new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
}

export function createGameEventsQueue(connection: IORedis): Queue {
  return new Queue(GAME_EVENTS_QUEUE, { connection });
}
