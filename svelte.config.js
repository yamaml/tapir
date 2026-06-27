import { readFileSync } from 'node:fs';
import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

// Use the app's own version string as the SvelteKit version name, so
// the deterministic `_app/version.json` SvelteKit emits changes on every
// release. This drives the native `updated` store (polled below), which
// detects new versions independently of the service worker — the part
// that actually works in Safari, where a stale SW can otherwise pin the
// old bundle indefinitely.
const versionSource = readFileSync('./src/lib/version.ts', 'utf-8');
const versionName = versionSource.match(/VERSION\s*=\s*['"]([^'"]+)['"]/)?.[1]
	?? Date.now().toString();

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
		version: {
			// Deterministic name tied to the app version (not a build
			// timestamp), so the value is stable across rebuilds of the
			// same release and only changes when the version bumps.
			name: versionName,
			// Poll `_app/version.json` every 60s. SvelteKit fetches it
			// with `cache: 'no-cache'`, which bypasses the service worker
			// and Safari's HTTP cache — so a new deploy is detected even
			// when the SW is still serving the old shell. Flips the
			// `updated` store, which the update toast watches.
			pollInterval: 60_000
		},
		alias: {
			$lib: 'src/lib'
		}
	}
};

export default config;
