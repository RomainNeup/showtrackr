CREATE TYPE "public"."follow_status" AS ENUM('watching', 'archived', 'stopped', 'upcoming');--> statement-breakpoint
CREATE TYPE "public"."list_type" AS ENUM('list', 'collection');--> statement-breakpoint
CREATE TYPE "public"."ref_type" AS ENUM('show', 'movie', 'episode');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "catalog_episodes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"show_id" bigint NOT NULL,
	"season_number" integer NOT NULL,
	"episode_number" integer NOT NULL,
	"name" text,
	"air_date" date,
	"runtime_min" integer,
	"tmdb_id" integer,
	"tvdb_episode_id" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "catalog_movies" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tmdb_id" integer NOT NULL,
	"title" text NOT NULL,
	"poster_path" text,
	"overview" text,
	"runtime_min" integer,
	"release_date" date
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "catalog_seasons" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"show_id" bigint NOT NULL,
	"season_number" integer NOT NULL,
	"name" text,
	"episode_count" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "catalog_shows" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tmdb_id" integer NOT NULL,
	"tvdb_id" integer,
	"name" text NOT NULL,
	"poster_path" text,
	"backdrop_path" text,
	"overview" text,
	"status" text,
	"first_air_date" date,
	"network" text,
	"runtime_avg_min" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "comments" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"ref_type" "ref_type" NOT NULL,
	"ref_id" bigint NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "episode_emotions" (
	"user_id" bigint NOT NULL,
	"episode_id" bigint NOT NULL,
	"emotion_id" integer NOT NULL,
	CONSTRAINT "episode_emotions_user_id_episode_id_emotion_id_pk" PRIMARY KEY("user_id","episode_id","emotion_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "episode_ratings" (
	"user_id" bigint NOT NULL,
	"episode_id" bigint NOT NULL,
	"rating" integer NOT NULL,
	CONSTRAINT "episode_ratings_user_id_episode_id_pk" PRIMARY KEY("user_id","episode_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "episode_watches" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"episode_id" bigint NOT NULL,
	"watch_count" integer DEFAULT 1 NOT NULL,
	"first_watched_at" timestamp with time zone,
	"last_watched_at" timestamp with time zone,
	"platform" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "follows" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"show_id" bigint NOT NULL,
	"status" "follow_status" DEFAULT 'watching' NOT NULL,
	"is_favorite" boolean DEFAULT false NOT NULL,
	"notify" boolean DEFAULT true NOT NULL,
	"followed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "list_items" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"list_id" bigint NOT NULL,
	"ref_type" "ref_type" NOT NULL,
	"ref_id" bigint NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lists" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"type" "list_type" DEFAULT 'list' NOT NULL,
	"is_public" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "movie_ratings" (
	"user_id" bigint NOT NULL,
	"movie_id" bigint NOT NULL,
	"rating" integer NOT NULL,
	CONSTRAINT "movie_ratings_user_id_movie_id_pk" PRIMARY KEY("user_id","movie_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "movie_watches" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"movie_id" bigint NOT NULL,
	"watched_at" timestamp with time zone,
	"platform" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "settings" (
	"user_id" bigint NOT NULL,
	"key" text NOT NULL,
	"value" text,
	CONSTRAINT "settings_user_id_key_pk" PRIMARY KEY("user_id","key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "stats_monthly" (
	"user_id" bigint NOT NULL,
	"period" text NOT NULL,
	"episodes" integer DEFAULT 0 NOT NULL,
	"minutes" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "stats_monthly_user_id_period_pk" PRIMARY KEY("user_id","period")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_stats" (
	"user_id" bigint PRIMARY KEY NOT NULL,
	"episodes_watched" integer DEFAULT 0 NOT NULL,
	"movies_watched" integer DEFAULT 0 NOT NULL,
	"minutes_watched" bigint DEFAULT 0 NOT NULL,
	"shows_followed" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"display_name" text,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "catalog_episodes" ADD CONSTRAINT "catalog_episodes_show_id_catalog_shows_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."catalog_shows"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "catalog_seasons" ADD CONSTRAINT "catalog_seasons_show_id_catalog_shows_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."catalog_shows"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "comments" ADD CONSTRAINT "comments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "episode_emotions" ADD CONSTRAINT "episode_emotions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "episode_emotions" ADD CONSTRAINT "episode_emotions_episode_id_catalog_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."catalog_episodes"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "episode_ratings" ADD CONSTRAINT "episode_ratings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "episode_ratings" ADD CONSTRAINT "episode_ratings_episode_id_catalog_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."catalog_episodes"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "episode_watches" ADD CONSTRAINT "episode_watches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "episode_watches" ADD CONSTRAINT "episode_watches_episode_id_catalog_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."catalog_episodes"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "follows" ADD CONSTRAINT "follows_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "follows" ADD CONSTRAINT "follows_show_id_catalog_shows_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."catalog_shows"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "list_items" ADD CONSTRAINT "list_items_list_id_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."lists"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lists" ADD CONSTRAINT "lists_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "movie_ratings" ADD CONSTRAINT "movie_ratings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "movie_ratings" ADD CONSTRAINT "movie_ratings_movie_id_catalog_movies_id_fk" FOREIGN KEY ("movie_id") REFERENCES "public"."catalog_movies"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "movie_watches" ADD CONSTRAINT "movie_watches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "movie_watches" ADD CONSTRAINT "movie_watches_movie_id_catalog_movies_id_fk" FOREIGN KEY ("movie_id") REFERENCES "public"."catalog_movies"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "settings" ADD CONSTRAINT "settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stats_monthly" ADD CONSTRAINT "stats_monthly_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_stats" ADD CONSTRAINT "user_stats_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "catalog_episodes_show_season_episode_key" ON "catalog_episodes" USING btree ("show_id","season_number","episode_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "catalog_episodes_show_id_idx" ON "catalog_episodes" USING btree ("show_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "catalog_movies_tmdb_id_key" ON "catalog_movies" USING btree ("tmdb_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "catalog_seasons_show_season_key" ON "catalog_seasons" USING btree ("show_id","season_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "catalog_seasons_show_id_idx" ON "catalog_seasons" USING btree ("show_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "catalog_shows_tmdb_id_key" ON "catalog_shows" USING btree ("tmdb_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "catalog_shows_tvdb_id_idx" ON "catalog_shows" USING btree ("tvdb_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "comments_user_id_idx" ON "comments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "comments_ref_idx" ON "comments" USING btree ("ref_type","ref_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "episode_emotions_episode_id_idx" ON "episode_emotions" USING btree ("episode_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "episode_ratings_episode_id_idx" ON "episode_ratings" USING btree ("episode_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "episode_watches_user_episode_key" ON "episode_watches" USING btree ("user_id","episode_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "episode_watches_user_id_idx" ON "episode_watches" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "episode_watches_episode_id_idx" ON "episode_watches" USING btree ("episode_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "follows_user_show_key" ON "follows" USING btree ("user_id","show_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "follows_user_id_idx" ON "follows" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "follows_show_id_idx" ON "follows" USING btree ("show_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "list_items_list_ref_key" ON "list_items" USING btree ("list_id","ref_type","ref_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "list_items_list_id_idx" ON "list_items" USING btree ("list_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "lists_user_slug_key" ON "lists" USING btree ("user_id","slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lists_user_id_idx" ON "lists" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "movie_ratings_movie_id_idx" ON "movie_ratings" USING btree ("movie_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "movie_watches_user_movie_key" ON "movie_watches" USING btree ("user_id","movie_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "movie_watches_user_id_idx" ON "movie_watches" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "movie_watches_movie_id_idx" ON "movie_watches" USING btree ("movie_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_email_key" ON "users" USING btree ("email");