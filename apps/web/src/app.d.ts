// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
	namespace App {
		interface Locals {
			/** The authenticated user, or null when the request is unauthenticated. */
			user: import('$lib/server/auth').SessionUser | null;
		}
		interface PageData {
			user?: import('$lib/server/auth').SessionUser | null;
		}
		// interface Error {}
		// interface Platform {}
	}
}

export {};
