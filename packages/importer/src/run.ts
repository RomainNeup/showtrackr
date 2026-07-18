/**
 * Library entry point for `@showtrackr/importer`.
 *
 * This module is the package's public API (`import { runImport } from
 * "@showtrackr/importer"`) and is intentionally SIDE-EFFECT FREE — importing it
 * neither parses argv nor connects to anything, so the SvelteKit server can bundle
 * it safely. The CLI (`src/index.ts`, the `showtrackr-import` bin) is a separate
 * entry point that layers argv parsing on top of the same pipeline.
 *
 * `runImport()` runs the full reconstruction pipeline against an EXISTING user id
 * (per-user / in-app import). It never creates or modifies any other user.
 */
import { createDb, type DbClient } from "./db.js";
import { setLogLevel, type LogLevel } from "./logger.js";
import { Pipeline, TOTAL_STEPS, type ImportProgress, type ProgressCallback, type ValidationReport } from "./pipeline.js";
import { TmdbClient } from "./tmdb.js";

export { Pipeline, TmdbClient, TOTAL_STEPS };
export type { ImportProgress, ProgressCallback, ValidationReport, DbClient, LogLevel };

export interface RunImportOptions {
  /** Directory containing the extracted GDPR CSVs (may be a nested sub-folder). */
  dataDir: string;
  /** EXISTING user id to import into. The pipeline never creates/edits other users. */
  userId: number;
  /** TMDB v3 API key or v4 bearer token (auto-detected). */
  tmdbApiKey: string;
  /**
   * An existing Drizzle client to reuse (the app passes its own pooled client so
   * the import shares the app's single connection pool). Mutually exclusive with
   * `databaseUrl`; if neither is given, that's an error.
   */
  db?: DbClient;
  /** Connection string used to open a dedicated client when `db` is not supplied. */
  databaseUrl?: string;
  /** Live progress sink (throttle DB writes inside it, not here). */
  onProgress?: ProgressCallback;
  /** Log verbosity for the pipeline's structured logger. Defaults to "info". */
  logLevel?: LogLevel;
  /** Optional override for the TMDB inter-request delay (ms). */
  tmdbMinDelayMs?: number;
}

/**
 * Run the full GDPR reconstruction pipeline into an existing account.
 *
 * Ownership of the DB connection:
 *  - when `db` is supplied, the caller owns it and we never close it;
 *  - when `databaseUrl` is supplied, we open a dedicated client and close it in
 *    a `finally` so the process/pool is not leaked.
 */
export async function runImport(opts: RunImportOptions): Promise<ValidationReport> {
  if (opts.logLevel) setLogLevel(opts.logLevel);
  if (!opts.db && !opts.databaseUrl) {
    throw new Error("runImport: either `db` or `databaseUrl` must be provided.");
  }
  if (!opts.tmdbApiKey) {
    throw new Error("runImport: `tmdbApiKey` is required to resolve shows against TMDB.");
  }

  const tmdb = new TmdbClient({ apiKey: opts.tmdbApiKey, minDelayMs: opts.tmdbMinDelayMs });

  let db: DbClient;
  let ownClient: ReturnType<typeof createDb>["client"] | null = null;
  if (opts.db) {
    db = opts.db;
  } else {
    const created = createDb(opts.databaseUrl!);
    db = created.db;
    ownClient = created.client;
  }

  const pipeline = new Pipeline(db, {
    dataDir: opts.dataDir,
    dryRun: false,
    tmdb,
    userId: opts.userId,
    onProgress: opts.onProgress,
  });

  try {
    return await pipeline.run();
  } finally {
    if (ownClient) await ownClient.end().catch(() => undefined);
  }
}
