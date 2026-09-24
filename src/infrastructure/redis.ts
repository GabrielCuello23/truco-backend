import { createClient } from 'redis';

import { env } from '../config/env';

export type RedisClient = ReturnType<typeof createClient>;

export function createRedisClient(): RedisClient {
  const client = createClient({ url: env.REDIS_URL });

  client.on('error', (error) => {
    console.error('Redis client error', error);
  });

  return client;
}

export async function pingRedis(client: Pick<RedisClient, 'ping'>): Promise<void> {
  await client.ping();
}
