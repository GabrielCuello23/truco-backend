import { Router } from 'express';

import type { RedisClient } from '../../infrastructure/redis';
import { AppError } from '../../shared/errors';

type HealthDependencies = {
  pingDatabase: () => Promise<void>;
  redis: Pick<RedisClient, 'ping'>;
};

export function createHealthRouter(dependencies: HealthDependencies): Router {
  const router = Router();

  router.get('/live', (_request, response) => {
    response.status(200).json({ status: 'ok' });
  });

  router.get('/ready', async (_request, response) => {
    const checks = await Promise.allSettled([
      dependencies.pingDatabase(),
      dependencies.redis.ping(),
    ]);

    const databaseOk = checks[0]?.status === 'fulfilled';
    const redisOk = checks[1]?.status === 'fulfilled';
    const ready = databaseOk && redisOk;

    response.status(ready ? 200 : 503).json({
      status: ready ? 'ok' : 'unavailable',
      checks: {
        database: databaseOk ? 'ok' : 'error',
        redis: redisOk ? 'ok' : 'error',
      },
    });
  });

  router.get('/', (_request, response) => {
    response.status(200).json({ service: 'truco-backend', status: 'ok' });
  });

  return router;
}

export function healthError(): AppError {
  return new AppError(503, 'SERVICE_UNAVAILABLE', 'El servicio no está disponible.');
}
