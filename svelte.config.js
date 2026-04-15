import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter({
			pages: 'build',
			assets: 'build',
			fallback: '404.html',
			precompress: false,
			strict: true
		}),
		paths: {
			base: '/tapir',
			// Use absolute asset URLs (default since SvelteKit 2) so
			// the SPA fallback HTML works when served from a different
			// URL than its original path — critical for PWA offline
			// deep-link support.
			relative: false
		},
		alias: {
			$lib: 'src/lib'
		}
	}
};

export default config;
