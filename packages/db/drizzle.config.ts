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
    url: process.env.DATABASE_URL ?? 'postgres://showtrackr:showtrackr@localhost:5432/showtrackr',
  },
  strict: true,
  verbose: true,
});
