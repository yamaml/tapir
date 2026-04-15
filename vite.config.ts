/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit(),
		// Service worker + install manifest (PWA).
		//
		// Target: Chromium-class desktop install (Chrome, Edge, Brave,
		// Arc). Mobile works as a fallback via the same manifest but
		// is not the primary use case.
		//
		// Caching strategy: precache everything. Tapir is a fully
		// client-side tool and the full bundle — app shell, all 75
		// vocabulary JSON chunks, the PDF-export dependencies — is
		// still under ~5 MB, so the simpler "precache all" model
		// beats a runtime-cache policy that would make offline vocab
		// search unreliable for vocabs the user hasn't touched yet.
		//
		// `registerType: 'prompt'` means the service worker waits for
		// the user to click "Reload" in the update toast rather than
		// skip-waiting silently. Autosave and snapshots mean data loss
		// risk is near zero, but the explicit opt-in is friendlier for
		// users who might be mid-edit when a new version ships.
		SvelteKitPWA({
			strategies: 'generateSW',
			registerType: 'prompt',
			injectRegister: 'auto',
			scope: '/tapir/',
			base: '/tapir/',
			manifest: false,
			workbox: {
				// Everything in the build output plus the vocabularies
				// that the build step copies into `static/vocabs/`.
				// `globPatterns` is evaluated against the build
				// directory, so vocab JSONs count here.
				globPatterns: [
					'**/*.{js,css,html,svg,png,webmanifest,ttf,woff2,json}'
				],
				// 10 MB file cap: the PDF-export chunk (jspdf +
				// svg2pdf) is large enough to exceed the Workbox
				// default of 2 MB. Bumping the ceiling keeps the
				// PDF path usable offline.
				maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
				// SPA fallback so deep links like /tapir/editor/:id
				// resolve to the static app shell when offline. Points
				// at the root route (`/tapir/`) because that's what
				// the plugin precaches by default, and the SvelteKit
				// client-side router takes over from there. The
				// static adapter's 404.html serves the same shell on
				// GitHub Pages when the SW isn't yet installed — so
				// both online and offline deep-link paths converge.
				navigateFallback: '/tapir/',
				navigateFallbackDenylist: [/^\/api\//],
				cleanupOutdatedCaches: true
			},
			devOptions: {
				// Dev mode keeps the SW off to avoid cache confusion
				// while iterating. Testing the PWA still requires
				// `npm run build && npm run preview`.
				enabled: false,
				type: 'module'
			}
		})
	],
	server: {
		port: 8081,
		host: '0.0.0.0'
	},
	test: {
		include: ['tests/**/*.test.ts'],
		environment: 'jsdom',
		alias: {
			$lib: new URL('./src/lib', import.meta.url).pathname
		}
	}
});
