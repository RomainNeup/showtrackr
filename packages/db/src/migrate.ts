/**
 * Runtime migration entrypoint (production-safe).
 *
 * Uses drizzle-orm's postgres-js migrator — NOT drizzle-kit — so it runs in the
 * pruned production image where dev tooling is absent. Applies every migration
 * in ../drizzle (tracked in the `drizzle.__drizzle_migrations` table), so it is
 * idempotent: re-running only applies what hasn't been applied yet.
 *
 * Invoked by `pnpm run migrate` (compose `migrate` one-shot). Reads DATABASE_URL.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is required to run migrations.');
  }

  // ../drizzle relative to the compiled dist/migrate.js (and src/migrate.ts).
  const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), '../drizzle');

  // Single connection, no pooling — the process exits right after migrating.
  const client = postgres(url, { max: 1 });
  try {
    console.log(`[migrate] applying migrations from ${migrationsFolder} …`);
    await migrate(drizzle(client), { migrationsFolder });
    console.log('[migrate] done.');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('[migrate] failed:', err);
  process.exit(1);
});
