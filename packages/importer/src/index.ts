#!/usr/bin/env node
/**
 * @mytvtime/importer — GDPR export backfill CLI (PLAN §8).
 *
 * Usage:
 *   mytvtime-import [--dry-run] [--data-dir <path>] [--only-step <0-7>]
 *
 * Environment:
 *   DATABASE_URL   Postgres connection string (required unless --dry-run).
 *   TMDB_API_KEY   TMDB v3 api key or v4 bearer token (required).
 *   GDPR_DATA_DIR  Default data dir (overridden by --data-dir). Defaults to /gdpr-data.
 */

import { Command } from "commander";
import { createDb } from "./db.js";
import { log, setLogLevel, type LogLevel } from "./logger.js";
import { Pipeline } from "./pipeline.js";
import { TmdbClient } from "./tmdb.js";

interface CliOptions {
  dryRun: boolean;
  dataDir: string;
  onlyStep?: string;
  logLevel: LogLevel;
}

async function main(): Promise<void> {
  const program = new Command();
  program
    .name("mytvtime-import")
    .description("Backfill MyTVTime from a TV Time GDPR export (idempotent).")
    .option("--dry-run", "read + resolve everything but write nothing to the DB", false)
    .option("--data-dir <path>", "path to the GDPR export directory", process.env.GDPR_DATA_DIR ?? "/gdpr-data")
    .option("--only-step <n>", "run a single pipeline step (0-7); context steps 0-2 auto-run when needed")
    .option("--log-level <level>", "debug|info|warn|error", "info")
    .parse();

  const opts = program.opts<CliOptions>();
  setLogLevel(opts.logLevel);

  const onlyStep = opts.onlyStep !== undefined ? Number(opts.onlyStep) : undefined;
  if (onlyStep !== undefined && (!Number.isInteger(onlyStep) || onlyStep < 0 || onlyStep > 7)) {
    log.error(`--only-step must be an integer 0-7, got "${opts.onlyStep}"`);
    process.exit(2);
  }

  const tmdbKey = process.env.TMDB_API_KEY;
  if (!tmdbKey) {
    log.error("TMDB_API_KEY is required (needed to resolve TheTVDB ids and hydrate the catalog).");
    process.exit(2);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl && !opts.dryRun) {
    log.error("DATABASE_URL is required unless --dry-run.");
    process.exit(2);
  }

  log.info("Starting import", {
    dataDir: opts.dataDir,
    dryRun: opts.dryRun,
    onlyStep: onlyStep ?? "all",
  });

  const tmdb = new TmdbClient({ apiKey: tmdbKey });
  // In dry-run without a DATABASE_URL we still need a client object, but no query
  // ever executes (every write is guarded and reads are skipped). postgres.js is
  // lazy — it does not connect until the first query — so a placeholder URL is safe.
  const { db, client } = createDb(databaseUrl ?? "postgres://dry:dry@localhost:5432/dry");

  const pipeline = new Pipeline(db, {
    dataDir: opts.dataDir,
    dryRun: opts.dryRun,
    onlyStep,
    tmdb,
  });

  try {
    const report = await pipeline.run(onlyStep);
    const withinTolerance =
      Math.abs(report.episodeDeltaPct) < 2 && Math.abs(report.totalMinuteDeltaPct) < 5;
    // Non-zero exit if the import produced numbers well outside the export's control
    // values, so CI / `docker compose run` surfaces a bad backfill. Skipped for
    // single-step and dry runs (which don't produce final DB numbers).
    if (!opts.dryRun && onlyStep === undefined && !withinTolerance) {
      log.warn("Validation outside 5% tolerance — exiting non-zero for visibility.");
      process.exitCode = 1;
    }
  } catch (err) {
    log.error("Import failed", { err: err instanceof Error ? err.message : String(err) });
    process.exitCode = 1;
  } finally {
    // postgres.js keeps the process alive via its connection pool — close it.
    await client.end().catch(() => undefined);
  }
}

main().catch((err) => {
  log.error("Fatal", { err: err instanceof Error ? err.stack : String(err) });
  process.exit(1);
});
