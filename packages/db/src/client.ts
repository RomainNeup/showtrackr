/**
 * Typed Drizzle client factory for ShowTrackr.
 *
 * Uses the postgres.js driver (single dependency, ESM-native, no build step).
 * `createDb(url)` returns a drizzle instance with the full schema attached,
 * so `db.query.*` relational helpers and `db.select()` are fully typed.
 */
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import * as schema from './schema.js';

export type Database = PostgresJsDatabase<typeof schema>;

export interface CreateDbResult {
  /** Typed Drizzle client. */
  db: Database;
  /** Underlying postgres.js connection — call `client.end()` on shutdown. */
  client: Sql;
}

export interface CreateDbOptions {
  /** Max pool size. Keep small for self-host / Raspberry footprint. */
  max?: number;
  /** Log every SQL statement (drizzle logger). */
  logger?: boolean;
}

/**
 * Create a typed Drizzle client from a Postgres connection URL.
 *
 * @example
 * const { db, client } = createDb(process.env.DATABASE_URL!);
 * const shows = await db.select().from(schema.catalogShows);
 * await client.end();
 */
export function createDb(url: string, options: CreateDbOptions = {}): CreateDbResult {
  if (!url) {
    throw new Error('createDb: a Postgres connection URL is required (DATABASE_URL).');
  }
  const client = postgres(url, { max: options.max ?? 10 });
  const db = drizzle(client, { schema, logger: options.logger ?? false });
  return { db, client };
}

export { schema };
