<script lang="ts">
	/**
	 * Update-available toast for the installed PWA.
	 *
	 * `@vite-pwa/sveltekit` registers a service worker at build time,
	 * and whenever a newer bundle ships, the SW enters the "waiting"
	 * state. This component listens for that via the plugin's Svelte
	 * adapter (`virtual:pwa-register/svelte`) and surfaces a small
	 * toast with a Reload button so the user can apply the update
	 * at a moment that suits them — rather than skip-waiting silently
	 * while they might be mid-edit.
	 *
	 * The registration lives in `registerType: 'prompt'` mode so this
	 * toast is the only activation path. Autosave + snapshots mean
	 * data loss risk is near zero, but giving the user explicit
	 * control over reload timing is the friendlier default.
	 *
	 * The virtual module only resolves under the vite-pwa plugin, so
	 * dev mode (SW disabled) silently skips the registration — no
	 * runtime error, no toast.
	 */
	import { onMount } from 'svelte';
	import { fade } from 'svelte/transition';
	import RefreshCw from 'lucide-svelte/icons/refresh-cw';
	import X from 'lucide-svelte/icons/x';

	let needRefresh = $state(false);
	let updateFn: (() => Promise<void>) | null = null;

	onMount(async () => {
		// Dynamic import so dev-mode builds (where the virtual module
		// isn't available) don't fail at module-load time.
		try {
			const mod = await import('virtual:pwa-register/svelte');
			const state = mod.useRegisterSW({
				onNeedRefresh() {
					needRefresh = true;
				},
				onOfflineReady() {
					// no-op: the "installed and offline-capable" event
					// doesn't need a UI surface here; the user will
					// notice when they actually go offline.
				}
			});
			// The returned store-like object exposes needRefresh as a
			// Svelte store; our local `needRefresh` is already updated
			// via onNeedRefresh, so we just wire the activation fn.
			updateFn = () => state.updateServiceWorker(true);
		} catch {
			// No SW in dev or when PWA is disabled — nothing to do.
		}
	});

	async function applyUpdate() {
		if (!updateFn) return;
		await updateFn();
	}

	function dismiss() {
		needRefresh = false;
	}
</script>

{#if needRefresh}
	<div
		class="fixed bottom-4 right-4 z-50 flex max-w-sm items-start gap-3 rounded-lg border border-border bg-background/95 px-4 py-3 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/80 [&_svg]:pointer-events-none"
		role="status"
		aria-live="polite"
		transition:fade={{ duration: 150 }}
	>
		<RefreshCw class="mt-0.5 h-4 w-4 shrink-0 text-primary" />
		<div class="min-w-0 flex-1">
			<p class="text-sm font-medium text-foreground">A new version is available</p>
			<p class="mt-0.5 text-xs text-muted-foreground">Reload to apply. Your work is autosaved.</p>
			<div class="mt-2 flex items-center gap-2">
				<button
					onclick={applyUpdate}
					class="inline-flex items-center justify-center rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
				>
					Reload
				</button>
				<button
					onclick={dismiss}
					class="inline-flex items-center justify-center rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
				>
					Later
				</button>
			</div>
		</div>
		<button
			onclick={dismiss}
			class="rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
			aria-label="Dismiss update notification"
		>
			<X class="h-3.5 w-3.5" />
		</button>
	</div>
{/if}
