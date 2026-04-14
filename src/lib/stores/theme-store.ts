/**
 * @fileoverview Theme store for light/dark mode.
 *
 * Persists the user's theme preference in localStorage.
 * Defaults to light theme. Applies the `dark` class to
 * `document.documentElement` when dark mode is active.
 *
 * @module stores/theme-store
 */

import { writable } from 'svelte/store';

// ── Types ───────────────────────────────────────────────────────

export type Theme = 'light' | 'dark';

// ── Store ───────────────────────────────────────────────────────

function createThemeStore() {
	const STORAGE_KEY = 'tapir:theme';

	// Read initial value from localStorage (default: light)
	let initial: Theme = 'light';
	if (typeof window !== 'undefined') {
		const stored = localStorage.getItem(STORAGE_KEY);
		if (stored === 'dark' || stored === 'light') {
			initial = stored;
		}
	}

	const { subscribe, set, update } = writable<Theme>(initial);

	return {
		subscribe,

		/** Set the theme and persist to localStorage. */
		setTheme(theme: Theme) {
			set(theme);
			if (typeof window !== 'undefined') {
				localStorage.setItem(STORAGE_KEY, theme);
				applyTheme(theme);
			}
		},

		/** Toggle between light and dark. */
		toggle() {
			update((current) => {
				const next: Theme = current === 'light' ? 'dark' : 'light';
				if (typeof window !== 'undefined') {
					localStorage.setItem(STORAGE_KEY, next);
					applyTheme(next);
				}
				return next;
			});
		},

		/** Initialize theme on mount (call from +layout.svelte). */
		init() {
			if (typeof window !== 'undefined') {
				const stored = localStorage.getItem(STORAGE_KEY);
				const theme: Theme = stored === 'dark' ? 'dark' : 'light';
				set(theme);
				applyTheme(theme);
			}
		},
	};
}

/** Apply the theme class to the document root. */
function applyTheme(theme: Theme): void {
	const root = document.documentElement;
	if (theme === 'dark') {
		root.classList.add('dark');
	} else {
		root.classList.remove('dark');
	}
}

export const theme = createThemeStore();
