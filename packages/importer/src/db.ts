/**
 * Single point of coupling to `@mytvtime/db` (owned by the DB agent, per CONTRACT.md).
 *
 * Everything the importer needs from the DB package is imported and re-exported
 * here so that if the DB agent's export names differ from the contract assumptions,
 * there is exactly ONE file to adjust.
 *
 * Contract assumptions (see CONTRACT.md §Database schema):
 *   - `createDb(url)` returns a Drizzle client (postgres-js driver).
 *   - `@mytvtime/db/schema` exports table objects with camelCase names and columns.
 */

import { createDb } from "@mytvtime/db";
import * as schema from "@mytvtime/db/schema";

export { schema, createDb };

/** The Drizzle DB client type — `createDb` returns `{ db, client }`, we want `db`. */
export type DbClient = ReturnType<typeof createDb>["db"];
