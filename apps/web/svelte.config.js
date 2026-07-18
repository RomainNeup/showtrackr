import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter(),
		// Service worker is registered manually in app shell; SvelteKit's own
		// SW registration is disabled so we control caching strategy.
		serviceWorker: {
			register: false
		}
	}
};

export default config;
