/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

// App-shell service worker: precache build assets + static files, serve them
// cache-first (they are content-hashed), and fall back to a network-first
// strategy for navigations so the PWA opens offline.
import { build, files, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;

const CACHE = `mytvtime-cache-${version}`;
const APP_SHELL = [...build, ...files];

sw.addEventListener('install', (event) => {
	event.waitUntil(
		(async () => {
			const cache = await caches.open(CACHE);
			await cache.addAll(APP_SHELL);
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
	if (request.method !== 'GET') return;

	const url = new URL(request.url);
	// Only handle same-origin requests; let TMDB images / cross-origin pass through.
	if (url.origin !== location.origin) return;

	// Content-hashed build assets & static files: cache-first.
	if (APP_SHELL.includes(url.pathname)) {
		event.respondWith(cacheFirst(request));
		return;
	}

	// Everything else (page navigations, data) goes to the network and is NEVER
	// cached: these responses are per-user/authenticated, so caching them could
	// leak one session's HTML to another or survive a logout. The cached app
	// shell (JS/CSS above) is enough to make the PWA installable.
	// (Falls through to the browser's default fetch — we don't call respondWith.)
});

async function cacheFirst(request: Request): Promise<Response> {
	const cache = await caches.open(CACHE);
	const cached = await cache.match(request);
	if (cached) return cached;
	const response = await fetch(request);
	if (response.ok) cache.put(request, response.clone());
	return response;
}
