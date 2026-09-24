import 'dotenv/config';

import { z } from 'zod';

const developmentJwtSecret = 'local-development-secret-change-me-32chars';

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    DATABASE_URL: z.string().url().default('postgresql://truco:truco_dev@localhost:5433/truco'),
    REDIS_URL: z.string().url().default('redis://localhost:6380'),
    JWT_SECRET: z.string().min(32).default(developmentJwtSecret),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(180),
    CORS_ORIGINS: z.string().default('http://localhost:8081,http://localhost:19006'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    SENTRY_DSN: z.union([z.string().url(), z.literal('')]).default(''),
    OTEL_ENABLED: z
      .union([z.literal('true'), z.literal('false')])
      .default('false')
      .transform((value) => value === 'true'),
    OTEL_SERVICE_NAME: z.string().default('truco-backend'),
    DB_POOL_MAX: z.coerce.number().int().positive().max(100).default(20),
    ROOM_INACTIVITY_TTL_HOURS: z.coerce.number().positive().default(4),
    ROOM_CLEANUP_INTERVAL_SECONDS: z.coerce.number().int().min(30).default(300),
  })
  .superRefine((values, context) => {
    if (values.NODE_ENV === 'production' && values.JWT_SECRET === developmentJwtSecret) {
      context.addIssue({
        code: 'custom',
        path: ['JWT_SECRET'],
        message: 'JWT_SECRET debe configurarse explícitamente en producción.',
      });
    }
  });

export const env = envSchema.parse(process.env);

export const corsOrigins = env.CORS_ORIGINS.split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
