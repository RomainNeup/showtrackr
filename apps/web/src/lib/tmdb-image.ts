/**
 * Client-safe TMDB image URL builder. Contains NO secrets (image CDN needs no
 * API key), so it lives outside `$lib/server` and can be imported by components.
 */
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';

export function tmdbImage(path: string | null | undefined, size = 'w342'): string | null {
	if (!path) return null;
	return `${TMDB_IMAGE_BASE}/${size}${path}`;
}
