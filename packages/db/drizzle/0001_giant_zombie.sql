CREATE TYPE "public"."watch_provider_kind" AS ENUM('show', 'movie');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "catalog_watch_providers" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"kind" "watch_provider_kind" NOT NULL,
	"tmdb_id" bigint NOT NULL,
	"results" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "catalog_watch_providers_kind_tmdb_key" ON "catalog_watch_providers" USING btree ("kind","tmdb_id");