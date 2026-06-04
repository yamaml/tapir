/// <reference types="@vite-pwa/sveltekit/client" />
/// <reference types="vite-plugin-pwa/svelte" />

declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};

// ── Vite ?raw imports ───────────────────────────────────────────
// Importing a file with the `?raw` suffix yields its text content as
// a string, resolved at build time. Used for bundled example profiles.
declare module '*?raw' {
	const content: string;
	export default content;
}
