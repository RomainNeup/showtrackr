/**
 * Typed CSV readers for the TV Time GDPR export.
 *
 * Only the files relevant to the backfill (PLAN §2) are modelled. Header names
 * come straight from the real export (inspected before coding). We read with
 * `columns: true` so column *order* never matters — the two `ratings-*` variants
 * ship the same fields in a different order, for instance.
 *
 * All parsing is tolerant: missing/blank fields become `undefined`, never throw.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parse } from "csv-parse/sync";

// ── low-level helpers ───────────────────────────────────────────────────────

type Raw = Record<string, string>;

function readRaw(dataDir: string, file: string): Raw[] {
  const path = join(dataDir, file);
  if (!existsSync(path)) return [];
  const text = readFileSync(path, "utf8");
  if (text.trim().length === 0) return [];
  return parse(text, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
    bom: true,
  }) as Raw[];
}

function num(v: string | undefined): number | undefined {
  if (v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function bool(v: string | undefined): boolean {
  return v === "1" || v?.toLowerCase() === "true";
}

function str(v: string | undefined): string | undefined {
  if (v === undefined) return undefined;
  const t = v.trim();
  return t.length === 0 ? undefined : t;
}

/**
 * Parse a TV Time timestamp (`YYYY-MM-DD HH:MM:SS`) into a Date.
 * TV Time stores wall-clock time; we anchor it to UTC for determinism. Sub-day
 * precision is irrelevant for the backfill (we only need day-level ordering).
 */
export function parseTimestamp(v: string | undefined): Date | undefined {
  const s = str(v);
  if (!s) return undefined;
  const iso = s.includes("T") ? s : s.replace(" ", "T");
  const d = new Date(iso.endsWith("Z") ? iso : iso + "Z");
  return Number.isNaN(d.getTime()) ? undefined : d;
}

// ── row types ───────────────────────────────────────────────────────────────

export interface FollowedShow {
  tvShowName: string;
  tvdbId: number; // TV Time `tv_show_id` == TheTVDB series id
  createdAt?: Date;
  notificationType?: number;
  archived: boolean;
  diffusion?: string;
}

export interface UserTvShowData {
  tvdbId: number;
  isFollowed: boolean;
  isFavorited: boolean;
  nbEpisodesSeen: number;
  tvShowName: string;
}

export interface Watermark {
  tvdbId: number;
  /** TheTVDB *episode* id of the last-seen episode. No season/episode number in the export. */
  episodeTvdbId: number;
  createdAt?: Date;
  updatedAt?: Date;
  tvShowName: string;
}

export interface SeenEpisodeSource {
  source?: string;
  createdAt?: Date;
  tvShowName: string;
  seasonNumber: number;
  episodeNumber: number;
  episodeTvdbId: number;
}

export interface RewatchedEpisode {
  episodeTvdbId: number;
  cpt: number; // number of *re*watches (total watches = 1 + cpt)
  createdAt?: Date;
  tvShowName: string;
  seasonNumber: number;
  episodeNumber: number;
}

export interface EpisodeVote {
  voteKey?: string;
  episodeTvdbId: number;
  seriesName?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  /** Trailing integer of `vote_key` (see README: rating semantics are best-effort). */
  voteValue?: number;
}

export interface EpisodeEmotion {
  tvShowName?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  episodeTvdbId: number;
  emotionId: number;
  createdAt?: Date;
}

export interface ListObject {
  id: number;
  type: string; // series | movie | episode | ...
}

export interface ListRow {
  slug?: string;
  name?: string;
  type?: string; // list | collection
  isPublic: boolean;
  objects: ListObject[];
}

export interface WhereToWatch {
  episodeTvdbId?: number;
  seriesName?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  platform?: string;
  createdAt?: Date;
}

export interface CommentRow {
  entityUuid?: string;
  seriesName?: string;
  movieName?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  body?: string;
  createdAt?: Date;
}

export interface UserRow {
  id: number;
  name?: string;
  email?: string;
  passwordHash?: string;
  language?: string;
  timezone?: string;
  createdAt?: Date;
}

export interface UserSetting {
  key: string;
  value?: string;
}

// NOTE: user_statistics.csv is deliberately NOT read — it is a stale cached row
// (time_spent=1745h, nb_episodes_watched=3). The authoritative control values come
// from the `tracking-stats` row of tracking-prod-records-v2.csv (see readTrackingStats).

// ── the trailing integer of a vote_key ("349352-18235147-3" -> 3) ────────────
function voteKeyTail(voteKey: string | undefined): number | undefined {
  if (!voteKey) return undefined;
  const parts = voteKey.split("-");
  return num(parts[parts.length - 1]);
}

// ── Go fmt map extraction (lists / where-to-watch dump `map[k:v ...]`) ───────
function extractListObjects(field: string | undefined): ListObject[] {
  if (!field) return [];
  const out: ListObject[] = [];
  // Each entry looks like: map[created_at:... id:336924 type:series]
  const re = /id:(\d+)\s+type:(\w+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(field)) !== null) {
    out.push({ id: Number(m[1]), type: m[2]! });
  }
  return out;
}

function extractPlatformName(field: string | undefined): string | undefined {
  if (!field) return undefined;
  const m = /display_name:([^\s\]]+)/.exec(field);
  return m ? m[1] : undefined;
}

// ── readers ─────────────────────────────────────────────────────────────────

export function readFollowedShows(dir: string): FollowedShow[] {
  return readRaw(dir, "followed_tv_show.csv")
    .map((r) => ({
      tvShowName: r.tv_show_name ?? "",
      tvdbId: num(r.tv_show_id)!,
      createdAt: parseTimestamp(r.created_at),
      notificationType: num(r.notification_type),
      archived: bool(r.archived),
      diffusion: str(r.diffusion),
    }))
    .filter((r) => Number.isFinite(r.tvdbId));
}

/** Per-show `source` (e.g. "see-episode") keyed by tvdb id, from followed_tv_show_source.csv. */
export function readFollowSources(dir: string): Map<number, string> {
  const m = new Map<number, string>();
  for (const r of readRaw(dir, "followed_tv_show_source.csv")) {
    const id = num(r.tv_show_id);
    const s = str(r.source);
    if (id !== undefined && s) m.set(id, s);
  }
  return m;
}

export function readUserTvShowData(dir: string): UserTvShowData[] {
  return readRaw(dir, "user_tv_show_data.csv")
    .map((r) => ({
      tvdbId: num(r.tv_show_id)!,
      isFollowed: bool(r.is_followed),
      isFavorited: bool(r.is_favorited),
      nbEpisodesSeen: num(r.nb_episodes_seen) ?? 0,
      tvShowName: r.tv_show_name ?? "",
    }))
    .filter((r) => Number.isFinite(r.tvdbId));
}

export function readWatermarks(dir: string): Watermark[] {
  return readRaw(dir, "show_seen_episode_latest.csv")
    .map((r) => ({
      tvdbId: num(r.tv_show_id)!,
      episodeTvdbId: num(r.episode_id)!,
      createdAt: parseTimestamp(r.created_at),
      updatedAt: parseTimestamp(r.updated_at),
      tvShowName: r.tv_show_name ?? "",
    }))
    .filter((r) => Number.isFinite(r.tvdbId) && Number.isFinite(r.episodeTvdbId));
}

export function readSeenEpisodeSources(dir: string): SeenEpisodeSource[] {
  return readRaw(dir, "seen_episode_source.csv")
    .map((r) => ({
      source: str(r.source),
      createdAt: parseTimestamp(r.created_at),
      tvShowName: r.tv_show_name ?? "",
      seasonNumber: num(r.episode_season_number)!,
      episodeNumber: num(r.episode_number)!,
      episodeTvdbId: num(r.episode_id)!,
    }))
    .filter((r) => Number.isFinite(r.seasonNumber) && Number.isFinite(r.episodeNumber));
}

export function readRewatchedEpisodes(dir: string): RewatchedEpisode[] {
  return readRaw(dir, "rewatched_episode.csv")
    .map((r) => ({
      episodeTvdbId: num(r.episode_id)!,
      cpt: num(r.cpt) ?? 0,
      createdAt: parseTimestamp(r.created_at),
      tvShowName: r.tv_show_name ?? "",
      seasonNumber: num(r.episode_season_number)!,
      episodeNumber: num(r.episode_number)!,
    }))
    .filter((r) => Number.isFinite(r.seasonNumber) && Number.isFinite(r.episodeNumber));
}

/** Union of both ratings export variants (prod + v3), deduped by (episode, season, episode#). */
export function readEpisodeRatings(dir: string): EpisodeVote[] {
  const rows = [
    ...readRaw(dir, "ratings-prod-episode_votes.csv"),
    ...readRaw(dir, "ratings-3-prod-episode_votes.csv"),
  ];
  const seen = new Set<string>();
  const out: EpisodeVote[] = [];
  for (const r of rows) {
    const vote: EpisodeVote = {
      voteKey: str(r.vote_key),
      episodeTvdbId: num(r.episode_id)!,
      seriesName: str(r.series_name),
      seasonNumber: num(r.season_number),
      episodeNumber: num(r.episode_number),
      voteValue: voteKeyTail(str(r.vote_key)),
    };
    const key = `${vote.seriesName}|${vote.seasonNumber}|${vote.episodeNumber}`;
    if (!Number.isFinite(vote.episodeTvdbId) && vote.seasonNumber === undefined) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(vote);
  }
  return out;
}

/** Union of the two emotion sources: episode_emotion.csv (explicit emotion_id column)
 *  and emotions-3-prod (emotion id in vote_key tail). Different taxonomies → keep both. */
export function readEpisodeEmotions(dir: string): EpisodeEmotion[] {
  const out: EpisodeEmotion[] = [];
  for (const r of readRaw(dir, "episode_emotion.csv")) {
    const emotionId = num(r.emotion_id);
    if (emotionId === undefined) continue;
    out.push({
      tvShowName: str(r.tv_show_name),
      seasonNumber: num(r.episode_season_number),
      episodeNumber: num(r.episode_number),
      episodeTvdbId: num(r.episode_id)!,
      emotionId,
      createdAt: parseTimestamp(r.created_at),
    });
  }
  for (const r of readRaw(dir, "emotions-3-prod-episode_votes.csv")) {
    const emotionId = voteKeyTail(str(r.vote_key));
    if (emotionId === undefined) continue;
    out.push({
      tvShowName: str(r.series_name),
      seasonNumber: num(r.season_number),
      episodeNumber: num(r.episode_number),
      episodeTvdbId: num(r.episode_id)!,
      emotionId,
    });
  }
  return out;
}

export function readLists(dir: string): ListRow[] {
  const out: ListRow[] = [];
  for (const r of readRaw(dir, "lists-prod-lists.csv")) {
    const objects = extractListObjects(r.objects);
    const type = str(r.type);
    // Skip the top-level "collection" aggregate row (its data is duplicated in the concrete list rows).
    if (type === "collection" && objects.length === 0) continue;
    out.push({
      slug: str(r.s_key),
      name: str(r.name),
      type,
      isPublic: bool(r.is_public),
      objects,
    });
  }
  return out;
}

export function readWhereToWatch(dir: string): WhereToWatch[] {
  return readRaw(dir, "where-to-watch-prod-table.csv").map((r) => ({
    episodeTvdbId: num(r.episode_id),
    seriesName: str(r.series_name),
    seasonNumber: num(r.season_number),
    episodeNumber: num(r.episode_number),
    platform: extractPlatformName(r.network_platform),
    createdAt: parseTimestamp(r.created_at),
  }));
}

export function readComments(dir: string): CommentRow[] {
  return readRaw(dir, "comments-prod-comments.csv").map((r) => ({
    entityUuid: str(r.entity_uuid),
    seriesName: str(r.series_name),
    movieName: str(r.movie_name),
    seasonNumber: num(r.season_number),
    episodeNumber: num(r.episode_number),
    // The export has no free-text body column; `body`/`text`/`comment` are tried defensively.
    body: str(r.body) ?? str(r.text) ?? str(r.comment) ?? str(r.content),
    createdAt: parseTimestamp(r.created_at),
  }));
}

export function readUser(dir: string): UserRow | undefined {
  const rows = readRaw(dir, "user.csv");
  const r = rows[0];
  if (!r) return undefined;
  return {
    id: num(r.id)!,
    name: str(r.name),
    email: str(r.mail),
    passwordHash: str(r.password_new) ?? str(r.password),
    language: str(r.language),
    timezone: str(r.timezone),
    createdAt: parseTimestamp(r.created_at),
  };
}

export function readUserSettings(dir: string): UserSetting[] {
  return readRaw(dir, "user_setting.csv")
    .map((r) => ({ key: str(r.name) ?? "", value: str(r.value) }))
    .filter((s) => s.key.length > 0);
}

/** Normalise a show name for cross-file joins (auxiliary files key on name, not tvdb id). */
export function normName(name: string | undefined): string {
  return (name ?? "").trim().toLowerCase();
}

// ── tracking-prod-records-v2.csv (PRIMARY watch source, DynamoDB dump) ────────

export interface TrackingWatch {
  showTvdbId?: number; // s_id
  seriesName?: string;
  seasonNumber: number; // s_no
  episodeNumber: number; // ep_no
  episodeTvdbId?: number; // ep_id
  watchedAt?: Date; // created_at
  runtimeSec?: number; // runtime (SECONDS, often blank)
  rewatchCount: number; // rewatch_count
}

export interface TrackingStats {
  episodes?: number; // ep_watch_count (= 3601)
  movies?: number; // movie_watch_count (= 215)
  seriesRuntimeSec?: number; // total_series_runtime
  moviesRuntimeSec?: number; // total_movies_runtime
}

/**
 * Parse the `key = watch-episode-…` rows — the exhaustive per-episode watch history.
 *
 * The separate `rewatch-episode-*` rows (132 of them) are intentionally NOT read:
 * the rewatch signal is already carried by each watch-episode row's `rewatch_count`
 * (→ watch_count) and cross-checked against rewatched_episode.csv in step 4. Reading
 * them here would double-count.
 */
export function readTrackingWatches(dir: string): TrackingWatch[] {
  return readRaw(dir, "tracking-prod-records-v2.csv")
    .filter((r) => (r.key ?? "").startsWith("watch-episode"))
    .map((r) => ({
      showTvdbId: num(r.s_id),
      seriesName: str(r.series_name),
      // s_no/ep_no and season_number/episode_number are duplicated; prefer s_no/ep_no, fall back.
      seasonNumber: num(r.s_no) ?? num(r.season_number)!,
      episodeNumber: num(r.ep_no) ?? num(r.episode_number)!,
      episodeTvdbId: num(r.ep_id),
      watchedAt: parseTimestamp(r.created_at),
      runtimeSec: num(r.runtime),
      rewatchCount: num(r.rewatch_count) ?? 0,
    }))
    .filter((r) => Number.isFinite(r.seasonNumber) && Number.isFinite(r.episodeNumber));
}

/** The authoritative `key = tracking-stats` aggregate row (validation control values). */
export function readTrackingStats(dir: string): TrackingStats | undefined {
  const row = readRaw(dir, "tracking-prod-records-v2.csv").find((r) => r.key === "tracking-stats");
  if (!row) return undefined;
  return {
    episodes: num(row.ep_watch_count),
    movies: num(row.movie_watch_count),
    seriesRuntimeSec: num(row.total_series_runtime),
    moviesRuntimeSec: num(row.total_movies_runtime),
  };
}

// ── tracking-prod-count-by-timeframe.csv (pre-computed monthly stats) ──────────

export interface MonthlyStat {
  period: string; // normalised 'YYYY-MM'
  episodes: number;
  minutes: number;
}

/** Read `type = month-YYYY-M` rows → monthly stats (period zero-padded to YYYY-MM). */
export function readMonthlyStats(dir: string): MonthlyStat[] {
  const out: MonthlyStat[] = [];
  for (const r of readRaw(dir, "tracking-prod-count-by-timeframe.csv")) {
    const type = str(r.type);
    if (!type || !type.startsWith("month-")) continue;
    const m = /^month-(\d{4})-(\d{1,2})$/.exec(type);
    if (!m) continue;
    const period = `${m[1]}-${m[2]!.padStart(2, "0")}`;
    const runtimeSec = num(r.runtime) ?? 0;
    out.push({ period, episodes: num(r.count) ?? 0, minutes: Math.round(runtimeSec / 60) });
  }
  return out;
}

// ── tracking-prod-records.csv (v1) — per-title movie watches (best-effort) ────

export interface MovieWatch {
  title: string;
  runtimeSec?: number;
  watchedAt?: Date;
  year?: number;
}

/** v1 `type` values that denote an actual watch event (not a follow/watchlist entry). */
const MOVIE_WATCH_TYPES = new Set(["watch", "rewatch", "seen"]);

/**
 * Distinct WATCHED movies from the v1 dump, deduped by title.
 *
 * IMPORTANT: filter on the `type` column, not just `entity_type=movie`. The dump
 * mixes movie rows of type follow (221), towatch (7) and watch (215); including
 * follow/towatch would insert phantom "watched" movies with a bogus watched_at
 * (= the follow date). Only watch/rewatch/seen rows are real watch events.
 * The 215 watch rows collapse to ~210 distinct titles (some rewatched); the
 * per-title data cannot represent the ~5 extra rewatch instances counted in the
 * tracking-stats movie_watch_count (215) — the validation report notes this.
 */
export function readV1Movies(dir: string): MovieWatch[] {
  const byTitle = new Map<string, MovieWatch>();
  for (const r of readRaw(dir, "tracking-prod-records.csv")) {
    if (!MOVIE_WATCH_TYPES.has(str(r.type) ?? "")) continue;
    const title = str(r.movie_name);
    if (!title) continue;
    const release = str(r.release_date);
    const yearMatch = release ? /(\d{4})/.exec(release) : null;
    const existing = byTitle.get(normName(title));
    const candidate: MovieWatch = {
      title,
      runtimeSec: num(r.runtime),
      // watch_date is always empty in this export → fall back to created_at.
      watchedAt: parseTimestamp(r.watch_date) ?? parseTimestamp(r.created_at),
      year: yearMatch ? Number(yearMatch[1]) : undefined,
    };
    // Keep the richest record per title (prefer one with a runtime, then a date).
    if (!existing || (candidate.runtimeSec && !existing.runtimeSec) || (candidate.watchedAt && !existing.watchedAt)) {
      byTitle.set(normName(title), { ...existing, ...candidate });
    }
  }
  return [...byTitle.values()];
}
