/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

// App-shell service worker.
//
// Strategy:
//   * Content-hashed build output, static files and any prerendered pages are
//     precached on install and served cache-first (they are immutable).
//   * Page navigations are network-first. Authenticated page HTML is per-user,
//     so it is NEVER cached (caching it could leak one session to another or
//     survive a logout). When a navigation happens with no network we serve a
//     small branded offline shell instead of the browser's error page, so the
//     installed PWA always "opens" — the real app returns the moment the
//     network is back.
//   * Everything else (API/data/auth endpoints, cross-origin, non-GET) is left
//     to the network and never cached.
import { build, files, prerendered, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;

const CACHE = `showtrackr-cache-${version}`;

// Immutable, safe-to-cache assets.
const PRECACHE = [...build, ...files, ...prerendered];
const PRECACHE_SET = new Set(PRECACHE);

// Branded offline fallback for navigations with no network and no cached page.
const OFFLINE_HTML = `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
		<title>ShowTrackr — Offline</title>
		<style>
			:root { color-scheme: dark; }
			html, body { height: 100%; margin: 0; }
			body {
				display: flex; flex-direction: column; align-items: center; justify-content: center;
				gap: 16px; padding: 24px; text-align: center;
				background: #0b0b0f; color: #f2f2f7;
				font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
			}
			.badge {
				width: 88px; height: 88px; border-radius: 20px; background: #6c4cf1;
				display: flex; align-items: center; justify-content: center;
			}
			h1 { font-size: 1.25rem; margin: 8px 0 0; }
			p { color: #9c9caa; margin: 0; max-width: 28ch; }
			button {
				margin-top: 8px; min-height: 44px; padding: 0 20px; border: 0; border-radius: 8px;
				background: #6c4cf1; color: #fff; font: inherit; font-weight: 600; cursor: pointer;
			}
		</style>
	</head>
	<body>
		<div class="badge" aria-hidden="true">
			<svg width="52" height="52" viewBox="0 0 512 512" fill="none">
				<rect x="120" y="176" width="272" height="192" rx="28" stroke="#fff" stroke-width="24" />
				<path d="M256 176 L200 108" stroke="#fff" stroke-width="24" stroke-linecap="round" />
				<path d="M256 176 L312 108" stroke="#fff" stroke-width="24" stroke-linecap="round" />
				<path d="M232 232 L232 312 L300 272 Z" fill="#fff" />
			</svg>
		</div>
		<h1>You're offline</h1>
		<p>ShowTrackr needs a connection to load your shows. It'll pick up right where you left off once you're back online.</p>
		<button onclick="location.reload()">Try again</button>
	</body>
</html>`;

const offlineResponse = () =>
	new Response(OFFLINE_HTML, {
		status: 503,
		headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
	});

sw.addEventListener('install', (event) => {
	event.waitUntil(
		(async () => {
			const cache = await caches.open(CACHE);
			await cache.addAll(PRECACHE);
			await sw.skipWaiting();
		})()
	);
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			for (const key of await caches.keys()) {
				if (key !== CACHE) await caches.delete(key);
			}
			await sw.clients.claim();
		})()
	);
});

sw.addEventListener('fetch', (event) => {
	const { request } = event;

	// Only ever handle same-origin GET; everything else (POST/auth, TMDB images,
	// other cross-origin) falls through to the network untouched.
	if (request.method !== 'GET') return;

	const url = new URL(request.url);
	if (url.origin !== location.origin) return;

	// Immutable precached assets: cache-first.
	if (PRECACHE_SET.has(url.pathname)) {
		event.respondWith(cacheFirst(request));
		return;
	}

	// Page navigations: network-first with an offline shell fallback. Never
	// cache the response (authenticated, per-user HTML).
	if (request.mode === 'navigate') {
		event.respondWith(networkThenOffline(request));
		return;
	}

	// Everything else (data/API/auth): straight to the network, never cached.
});

async function cacheFirst(request: Request): Promise<Response> {
	const cache = await caches.open(CACHE);
	const cached = await cache.match(request);
	if (cached) return cached;
	const response = await fetch(request);
	if (response.ok) cache.put(request, response.clone());
	return response;
}

async function networkThenOffline(request: Request): Promise<Response> {
	try {
		return await fetch(request);
	} catch {
		return offlineResponse();
	}
}
