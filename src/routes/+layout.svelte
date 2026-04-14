<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { VERSION } from '$lib/version';
	import { base } from '$app/paths';
	import { theme } from '$lib/stores/theme-store';
	import Home from 'lucide-svelte/icons/home';
	import Sun from 'lucide-svelte/icons/sun';
	import Moon from 'lucide-svelte/icons/moon';
	import { Separator } from '$lib/components/ui/separator';

	let { children } = $props();

	onMount(() => {
		theme.init();
	});
</script>

<div class="flex min-h-screen flex-col bg-background text-foreground transition-colors">
	<!-- Header -->
	<header class="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
		<div class="mx-auto flex h-14 max-w-screen-2xl items-center gap-4 px-4 sm:px-6">
			<a href="{base}/" class="flex items-center gap-2.5 text-foreground hover:text-primary transition-colors">
				<img
					src="{base}/tapir-logo.svg"
					alt="Tapir logo"
					class="h-7 w-7 {$theme === 'dark' ? 'invert' : ''}"
				/>
				<span class="text-lg font-semibold tracking-tight">Tapir</span>
			</a>
			<span class="text-xs text-muted-foreground">v{VERSION}</span>
			<div class="flex-1"></div>
			<nav class="flex items-center gap-1">
				<!-- Theme toggle -->
				<button
					onclick={() => theme.toggle()}
					class="inline-flex items-center justify-center rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors [&_svg]:pointer-events-none"
					title="Toggle {$theme === 'light' ? 'dark' : 'light'} mode"
				>
					{#if $theme === 'light'}
						<Moon class="h-4 w-4" />
					{:else}
						<Sun class="h-4 w-4" />
					{/if}
				</button>
				<a
					href="{base}/"
					class="inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
				>
					<Home class="h-4 w-4" />
					<span class="hidden sm:inline">Dashboard</span>
				</a>
			</nav>
		</div>
	</header>

	<!-- Main content -->
	<main class="flex-1">
		{@render children()}
	</main>

	<!-- Footer -->
	<footer class="border-t border-border bg-background">
		<div class="mx-auto flex max-w-screen-2xl flex-wrap items-center justify-center gap-x-4 gap-y-1 px-4 py-3 sm:px-6">
			<span class="text-xs text-muted-foreground">v{VERSION}</span>
			<Separator orientation="vertical" class="!h-3" />
			<span class="text-xs text-muted-foreground">Privacy-first: all data stays in your browser</span>
			<Separator orientation="vertical" class="!h-3" />
			<a
				href="https://docs.yamaml.org/specs/simpledsp/spec/"
				target="_blank"
				rel="noopener noreferrer"
				class="text-xs text-muted-foreground hover:text-primary transition-colors"
			>
				SimpleDSP
			</a>
			<Separator orientation="vertical" class="!h-3" />
			<a
				href="https://www.dublincore.org/specifications/dctap/"
				target="_blank"
				rel="noopener noreferrer"
				class="text-xs text-muted-foreground hover:text-primary transition-colors"
			>
				DCTAP
			</a>
			<Separator orientation="vertical" class="!h-3" />
			<a
				href="https://github.com/yamaml/tapir"
				target="_blank"
				rel="noopener noreferrer"
				class="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors [&_svg]:pointer-events-none"
				title="Tapir source on GitHub"
				aria-label="Tapir on GitHub"
			>
				<!--
					Inline GitHub mark SVG — the official octocat glyph.
					Brand marks aren't in Lucide (which is strictly UI
					icons), so we inline a compact copy here. `currentColor`
					lets it inherit the link colour and follow hover/dark
					states without extra CSS.
				-->
				<svg
					viewBox="0 0 16 16"
					aria-hidden="true"
					class="h-3.5 w-3.5"
					fill="currentColor"
				>
					<path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
				</svg>
				GitHub
			</a>
		</div>
	</footer>
</div>
