import { defineConfig } from 'drizzle-kit';

/**
 * drizzle-kit configuration.
 * Migrations are emitted to ./drizzle and applied against DATABASE_URL.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://mytvtime:mytvtime@localhost:5432/mytvtime',
  },
  strict: true,
  verbose: true,
});
