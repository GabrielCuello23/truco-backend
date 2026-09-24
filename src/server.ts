import { createServer } from 'node:http';

import { env } from './config/env';
import { closeDatabase, db, pingDatabase } from './database/client';
import { createRedisClient } from './infrastructure/redis';
import { initializeSentry } from './observability/sentry';
import { initializeTelemetry, shutdownTelemetry } from './observability/telemetry';
import { createApp } from './app';
import { createSocketServer } from './realtime/socket';

async function main(): Promise<void> {
  initializeSentry();
  initializeTelemetry();

  const redis = createRedisClient();
  await redis.connect();

  const app = createApp({ database: db, redis, pingDatabase });
  const httpServer = createServer(app);
  const realtime = await createSocketServer(httpServer, { database: db, redis });

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`Received ${signal}; shutting down gracefully`);
    httpServer.close(async () => {
      await realtime.close();
      await redis.quit();
      await closeDatabase();
      await shutdownTelemetry();
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  httpServer.listen(env.PORT, () => {
    console.log(`Truco backend listening on port ${env.PORT}`);
  });
}

void main().catch((error: unknown) => {
  console.error('Unable to start server', error);
  process.exitCode = 1;
});
