import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { env } from '../config/env';
import * as schema from './schema';

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: env.DB_POOL_MAX,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

export const db = drizzle(pool, { schema });
export type Database = typeof db;

export async function pingDatabase(): Promise<void> {
  await pool.query('select 1');
}

export async function closeDatabase(): Promise<void> {
  await pool.end();
}
