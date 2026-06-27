<script lang="ts">
	/**
	 * Cross-browser update notifier for the deployed app.
	 *
	 * Keeping a long-lived browser tab (or a Safari session restored from
	 * the page cache) on a stale build is the failure this guards against.
	 * It listens on two independent channels so a new version is caught no
	 * matter which one the browser honours:
	 *
	 *  1. SvelteKit's native version poll (`updated` from `$app/state`).
	 *     SvelteKit fetches `_app/version.json` with `cache: 'no-cache'`,
	 *     which bypasses BOTH the service worker and Safari's HTTP cache.
	 *     This is the channel that actually fires in Safari, where a stale
	 *     service worker can otherwise pin the old shell indefinitely.
	 *     `version.pollInterval` is set in `svelte.config.js`.
	 *
	 *  2. The PWA service-worker waiting state (`virtual:pwa-register`).
	 *     When a new precache ships, the SW enters "waiting"; this surfaces
	 *     it and lets the user activate it for offline use. We also poll
	 *     `registration.update()` ourselves (the plugin does not), and on
	 *     tab focus / visibility, because browsers — Safari especially —
	 *     do not re-check on their own for an open tab.
	 *
	 * Reloading is made Safari-proof: clicking "Reload" triggers the SW
	 * skip-waiting AND a hard `location.reload()`, with a `controllerchange`
	 * listener and a timeout fallback, because Safari frequently does not
	 * auto-reload after the controller changes.
	 *
	 * The virtual PWA module only resolves under the vite-pwa plugin, so
	 * dev mode (SW disabled) silently skips channel 2 — no runtime error.
	 */
	import { onMount } from 'svelte';
	import { fade } from 'svelte/transition';
	import { browser } from '$app/environment';
	import { updated } from '$app/state';
	import RefreshCw from 'lucide-svelte/icons/refresh-cw';
	import X from 'lucide-svelte/icons/x';

	/** How often to actively re-check for a new version, in ms. */
	const POLL_MS = 60_000;
	/** How long to wait for `controllerchange` before forcing a reload. */
	const RELOAD_FALLBACK_MS = 3_000;

	let swNeedRefresh = $state(false);
	let dismissed = $state(false);
	let reloading = $state(false);
	let updateServiceWorker: ((reload?: boolean) => Promise<void>) | null = null;

	// Channel 1: SvelteKit's version poll. `updated.current` flips true on
	// a new deploy. This is the forced-update detector and the Safari
	// lifeline (it never depends on the service worker).
	const versionChanged = $derived(updated.current);

	// Show the toast when either channel reports a new version (until the
	// user dismisses it).
	const show = $derived((swNeedRefresh || versionChanged) && !dismissed);

	onMount(() => {
		let registration: ServiceWorkerRegistration | undefined;
		let pollTimer: ReturnType<typeof setInterval> | undefined;
		let disposed = false;

		// Re-check on tab focus / when the page becomes visible again —
		// the moment a user is most likely to act on an update, and the
		// case browsers skip for a backgrounded tab.
		const recheck = () => {
			// SvelteKit's own check (channel 1) — cheap, no-store fetch.
			updated.check().catch(() => {});
			// Service-worker check (channel 2).
			registration?.update().catch(() => {});
		};
		const onVisible = () => {
			if (document.visibilityState === 'visible') recheck();
		};

		(async () => {
			if (browser) {
				document.addEventListener('visibilitychange', onVisible);
				window.addEventListener('focus', recheck);
				pollTimer = setInterval(recheck, POLL_MS);
			}

			// Channel 2: register the SW update hook. Dynamic import so
			// dev-mode builds (no virtual module) don't fail to load.
			try {
				const mod = await import('virtual:pwa-register/svelte');
				if (disposed) return;
				// Register ONCE; the returned object carries both the
				// activation fn and the reactive stores.
				const adapter = mod.useRegisterSW({
					onNeedRefresh() {
						swNeedRefresh = true;
					},
					onRegisteredSW(_swUrl, reg) {
						registration = reg;
						// Force the browser to fetch the SW script fresh on
						// every update check — Safari otherwise reuses a
						// cached SW script and never sees the new one.
						if (reg) {
							try {
								reg.update();
							} catch {
								/* update() may throw if the reg is gone */
							}
						}
					},
					onOfflineReady() {
						/* offline-capable; no UI needed */
					}
				});
				updateServiceWorker = adapter.updateServiceWorker;
			} catch {
				// No SW (dev or PWA disabled): channel 1 still covers us.
			}
		})();

		return () => {
			disposed = true;
			if (pollTimer) clearInterval(pollTimer);
			if (browser) {
				document.removeEventListener('visibilitychange', onVisible);
				window.removeEventListener('focus', recheck);
			}
		};
	});

	/**
	 * Applies the update and reloads, robust to Safari. The service worker
	 * (if any) is told to skip waiting; once it takes control —
	 * `controllerchange` — we hard-reload. A timeout reload covers the
	 * case where the event never fires (Safari, or no SW at all).
	 */
	async function applyUpdate() {
		if (reloading) return;
		reloading = true;

		const hardReload = () => {
			// Bust any intermediary cache on the navigation itself.
			window.location.reload();
		};

		// Reload as soon as the new SW takes control.
		if (browser && 'serviceWorker' in navigator) {
			navigator.serviceWorker.addEventListener('controllerchange', hardReload, {
				once: true
			});
		}
		// Fallback: Safari may not fire controllerchange (or there may be
		// no SW), so force a reload after a short grace period regardless.
		setTimeout(hardReload, RELOAD_FALLBACK_MS);

		try {
			if (updateServiceWorker) {
				// skip-waiting + claim; the plugin may also reload, but our
				// controllerchange/timeout handlers guarantee it everywhere.
				await updateServiceWorker(true);
			} else {
				// No SW channel (version-only update): reload immediately.
				hardReload();
			}
		} catch {
			hardReload();
		}
	}

	function dismiss() {
		dismissed = true;
	}
</script>

{#if show}
	<div
		class="fixed bottom-4 right-4 z-50 flex max-w-sm items-start gap-3 rounded-lg border border-border bg-background/95 px-4 py-3 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/80 [&_svg]:pointer-events-none"
		role="status"
		aria-live="polite"
		transition:fade={{ duration: 150 }}
	>
		<RefreshCw
			class="mt-0.5 h-4 w-4 shrink-0 text-primary {reloading ? 'animate-spin' : ''}"
		/>
		<div class="min-w-0 flex-1">
			<p class="text-sm font-medium text-foreground">A new version is available</p>
			<p class="mt-0.5 text-xs text-muted-foreground">
				{reloading ? 'Updating…' : 'Reload to apply. Your work is autosaved.'}
			</p>
			<div class="mt-2 flex items-center gap-2">
				<button
					onclick={applyUpdate}
					disabled={reloading}
					class="inline-flex items-center justify-center rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
				>
					{reloading ? 'Reloading…' : 'Reload'}
				</button>
				<button
					onclick={dismiss}
					disabled={reloading}
					class="inline-flex items-center justify-center rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-60"
				>
					Later
				</button>
			</div>
		</div>
		<button
			onclick={dismiss}
			disabled={reloading}
			class="rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-60"
			aria-label="Dismiss update notification"
		>
			<X class="h-3.5 w-3.5" />
		</button>
	</div>
{/if}
