import compression from 'compression';
import cors from 'cors';
import express, { Router } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { randomUUID } from 'node:crypto';
import { RedisStore } from 'rate-limit-redis';

import { env, corsOrigins } from './config/env';
import type { Database } from './database/client';
import type { RedisClient } from './infrastructure/redis';
import { errorHandler } from './middlewares/error-handler';
import { notFoundHandler } from './middlewares/not-found';
import { createAuthRouter } from './modules/auth/auth.routes';
import { createHealthRouter } from './modules/health/health.routes';
import { createRoomRouter } from './modules/rooms/room.routes';
import { httpRequestsTotal, metricsPayload } from './observability/metrics';

export type AppDependencies = {
  database: Database;
  redis: Pick<RedisClient, 'ping'> & Partial<Pick<RedisClient, 'sendCommand'>>;
  pingDatabase: () => Promise<void>;
};

export function createApp(dependencies: AppDependencies): express.Express {
  const app = express();
  const apiRouter = Router();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(
    pinoHttp({
      genReqId: (request) => request.headers['x-request-id']?.toString() ?? randomUUID(),
      level: env.LOG_LEVEL,
    }),
  );
  app.use(helmet());
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || corsOrigins.includes(origin)) {
          callback(null, true);
          return;
        }

        callback(new Error('CORS origin not allowed'));
      },
    }),
  );
  app.use(compression());
  app.use(express.json({ limit: '32kb' }));
  app.use(express.urlencoded({ extended: false, limit: '16kb' }));
  app.use((request, response, next) => {
    const startedAt = process.hrtime.bigint();
    response.on('finish', () => {
      const route = request.route?.path?.toString() ?? request.path;
      httpRequestsTotal.inc({
        method: request.method,
        route,
        status_code: response.statusCode.toString(),
      });
      request.log.debug({ durationNs: process.hrtime.bigint() - startedAt }, 'Request completed');
    });
    next();
  });
  const rateLimitOptions = {
    windowMs: 60_000,
    limit: 120,
    standardHeaders: 'draft-8' as const,
    legacyHeaders: false,
  };

  if ('sendCommand' in dependencies.redis && dependencies.redis.sendCommand) {
    app.use(
      rateLimit({
        ...rateLimitOptions,
        store: new RedisStore({
          sendCommand: (...args: string[]) => dependencies.redis.sendCommand!(args),
        }),
      }),
    );
  } else {
    app.use(rateLimit(rateLimitOptions));
  }

  app.use(
    '/health',
    createHealthRouter({ pingDatabase: dependencies.pingDatabase, redis: dependencies.redis }),
  );
  app.get('/metrics', async (_request, response) => {
    response.type('text/plain').send(await metricsPayload());
  });

  apiRouter.use(
    '/health',
    createHealthRouter({ pingDatabase: dependencies.pingDatabase, redis: dependencies.redis }),
  );
  apiRouter.use('/auth', createAuthRouter(dependencies.database));
  apiRouter.use('/rooms', createRoomRouter(dependencies.database));
  app.use('/api/v1', apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
