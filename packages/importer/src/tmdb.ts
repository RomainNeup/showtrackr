/**
 * Minimal, rate-limited TMDB fetcher.
 *
 * Mirrors the endpoints defined in CONTRACT.md §Metadata provider contract so the
 * importer stays interchangeable with `apps/web/src/lib/server/tmdb.ts`:
 *   - findByTvdbId(tvdbId)          → /find/{id}?external_source=tvdb_id  (tv_results)
 *   - findEpisodeByTvdbId(tvdbId)   → /find/{id}?external_source=tvdb_id  (tv_episode_results)
 *   - getShow(tmdbId)               → /tv/{id}
 *   - getSeasonEpisodes(tmdbId, s)  → /tv/{id}/season/{s}
 *   - getMovie(tmdbId)              → /movie/{id}
 *
 * Requests are serialised with a small inter-request delay + exponential backoff
 * retry (429 / 5xx / network) so a 130-show import stays well under TMDB limits.
 *
 * Auth: reads `TMDB_API_KEY` from the environment. Supports both the v3 API key
 * (query param `api_key`) and a v4 bearer token (starts with `eyJ`, sent as a header).
 */

import { setTimeout as sleep } from "node:timers/promises";
import { log } from "./logger.js";

const BASE = "https://api.themoviedb.org/3";

export interface TmdbFindShow {
  tmdbId: number;
  type: "tv";
  name?: string;
}

export interface TmdbFindEpisode {
  tmdbEpisodeId: number;
  showTmdbId?: number;
  seasonNumber: number;
  episodeNumber: number;
  name?: string;
}

export interface TmdbShow {
  id: number;
  name: string;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  status?: string;
  first_air_date?: string;
  episode_run_time?: number[];
  networks?: { name: string }[];
  seasons?: { season_number: number; name: string; episode_count: number }[];
}

export interface TmdbEpisode {
  id: number;
  name?: string;
  season_number: number;
  episode_number: number;
  air_date?: string | null;
  runtime?: number | null;
}

export interface TmdbSeason {
  season_number: number;
  name?: string;
  episodes: TmdbEpisode[];
}

export interface TmdbMovie {
  id: number;
  title: string;
  overview?: string;
  poster_path?: string | null;
  runtime?: number | null;
  release_date?: string;
}

export interface TmdbOptions {
  apiKey: string;
  /** ms between requests (default 120ms ≈ 8 req/s, comfortably under TMDB's ~40/10s). */
  minDelayMs?: number;
  maxRetries?: number;
}

export class TmdbClient {
  private readonly apiKey: string;
  private readonly bearer: boolean;
  private readonly minDelayMs: number;
  private readonly maxRetries: number;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(opts: TmdbOptions) {
    this.apiKey = opts.apiKey;
    this.bearer = opts.apiKey.startsWith("eyJ"); // v4 tokens are JWTs
    this.minDelayMs = opts.minDelayMs ?? 120;
    this.maxRetries = opts.maxRetries ?? 5;
  }

  /** Serialise all requests through a single chain so calls never overlap (rate-limit safety). */
  private schedule<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    // keep the chain alive regardless of individual failures
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async request<T>(path: string, params: Record<string, string> = {}): Promise<T | null> {
    return this.schedule(async () => {
      const url = new URL(BASE + path);
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
      if (!this.bearer) url.searchParams.set("api_key", this.apiKey);
      const headers: Record<string, string> = { accept: "application/json" };
      if (this.bearer) headers.authorization = `Bearer ${this.apiKey}`;

      for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
        await sleep(this.minDelayMs);
        try {
          const res = await fetch(url, { headers });
          if (res.status === 404) return null;
          if (res.status === 429) {
            const retryAfter = Number(res.headers.get("retry-after")) || 2;
            log.warn(`TMDB 429 rate-limited, backing off ${retryAfter}s`, { path });
            await sleep(retryAfter * 1000);
            continue;
          }
          if (res.status >= 500) {
            log.warn(`TMDB ${res.status}, retrying`, { path, attempt });
            await sleep(this.backoff(attempt));
            continue;
          }
          if (!res.ok) {
            log.error(`TMDB ${res.status} ${res.statusText}`, { path });
            return null;
          }
          return (await res.json()) as T;
        } catch (err) {
          log.warn(`TMDB network error, retrying`, { path, attempt, err: String(err) });
          await sleep(this.backoff(attempt));
        }
      }
      log.error(`TMDB request failed after ${this.maxRetries} retries`, { path });
      return null;
    });
  }

  private backoff(attempt: number): number {
    return Math.min(1000 * 2 ** attempt, 15000);
  }

  /** Resolve a TheTVDB *series* id to a TMDB show. */
  async findByTvdbId(tvdbId: number): Promise<TmdbFindShow | null> {
    const data = await this.request<{ tv_results?: { id: number; name?: string }[] }>(
      `/find/${tvdbId}`,
      { external_source: "tvdb_id" },
    );
    const hit = data?.tv_results?.[0];
    return hit ? { tmdbId: hit.id, type: "tv", name: hit.name } : null;
  }

  /** Resolve a TheTVDB *episode* id to its TMDB (season, episode) — the key to the watermark. */
  async findEpisodeByTvdbId(tvdbEpisodeId: number): Promise<TmdbFindEpisode | null> {
    const data = await this.request<{
      tv_episode_results?: {
        id: number;
        show_id?: number;
        season_number: number;
        episode_number: number;
        name?: string;
      }[];
    }>(`/find/${tvdbEpisodeId}`, { external_source: "tvdb_id" });
    const hit = data?.tv_episode_results?.[0];
    return hit
      ? {
          tmdbEpisodeId: hit.id,
          showTmdbId: hit.show_id,
          seasonNumber: hit.season_number,
          episodeNumber: hit.episode_number,
          name: hit.name,
        }
      : null;
  }

  /** Fallback resolution by name + first-air year. */
  async searchShow(query: string, year?: number): Promise<TmdbFindShow | null> {
    const params: Record<string, string> = { query };
    if (year) params.first_air_date_year = String(year);
    const data = await this.request<{ results?: { id: number; name?: string }[] }>(
      `/search/tv`,
      params,
    );
    const hit = data?.results?.[0];
    return hit ? { tmdbId: hit.id, type: "tv", name: hit.name } : null;
  }

  /** Fallback movie resolution by title (+ optional year). */
  async searchMovie(query: string, year?: number): Promise<{ tmdbId: number; title?: string } | null> {
    const params: Record<string, string> = { query };
    if (year) params.year = String(year);
    const data = await this.request<{ results?: { id: number; title?: string }[] }>(`/search/movie`, params);
    const hit = data?.results?.[0];
    return hit ? { tmdbId: hit.id, title: hit.title } : null;
  }

  async getShow(tmdbId: number): Promise<TmdbShow | null> {
    return this.request<TmdbShow>(`/tv/${tmdbId}`);
  }

  async getSeasonEpisodes(tmdbId: number, seasonNumber: number): Promise<TmdbSeason | null> {
    return this.request<TmdbSeason>(`/tv/${tmdbId}/season/${seasonNumber}`);
  }

  async getMovie(tmdbId: number): Promise<TmdbMovie | null> {
    return this.request<TmdbMovie>(`/movie/${tmdbId}`);
  }
}
