import { Worker } from 'bullmq';

import { env } from './config/env';
import { createQueueConnection, GAME_EVENTS_QUEUE } from './jobs/queues';

async function main(): Promise<void> {
  const connection = createQueueConnection();
  const worker = new Worker(
    GAME_EVENTS_QUEUE,
    async (job) => {
      console.log(`Processing ${job.name}`, job.data);
    },
    { connection },
  );

  worker.on('completed', (job) => {
    console.log(`Job ${job.id} completed`);
  });
  worker.on('failed', (job, error) => {
    console.error(`Job ${job?.id ?? 'unknown'} failed`, error);
  });

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`Received ${signal}; stopping worker`);
    await worker.close();
    await connection.quit();
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
