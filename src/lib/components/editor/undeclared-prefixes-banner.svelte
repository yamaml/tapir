<!--
	Non-modal banner that surfaces prefixes used in the profile but not
	declared in the namespace map. Each undeclared prefix is rendered as
	an amber chip; clicking a chip opens an inline URI input. If the
	prefix matches a vocabulary in the shipped manifest, the URI is
	pre-filled — the user can confirm with one tap.

	Dismissible per session via local component state. The banner
	re-appears on next mount whenever undeclared prefixes still exist.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { currentProject, setNamespaces } from '$lib/stores';
	import type { TapirProject, VocabManifestEntry } from '$lib/types';
	import zazukoPrefixes from '@zazuko/prefixes';
	import AlertTriangle from 'lucide-svelte/icons/triangle-alert';
	import X from 'lucide-svelte/icons/x';
	import Check from 'lucide-svelte/icons/check';

	interface Props {
		project: TapirProject;
	}

	let { project }: Props = $props();

	let dismissed = $state(false);
	let manifest = $state<VocabManifestEntry[]>([]);

	onMount(async () => {
		try {
			const res = await fetch(`${base}/vocabs/_manifest.json`);
			if (res.ok) manifest = await res.json();
		} catch {
			// silent — manifest is a hint, not a requirement
		}
	});

	// Two-tier known-prefix lookup: the shipped vocab manifest takes
	// precedence (it's the one with chunked term data), with the
	// @zazuko/prefixes bundle filling the long tail (sioc, wgs, bibo,
	// etc.). Both are local — no network at runtime.
	let manifestByPrefix = $derived.by(() => {
		const map = new Map<string, string>();
		for (const [prefix, uri] of Object.entries(zazukoPrefixes)) {
			map.set(prefix, uri);
		}
		for (const m of manifest) map.set(m.prefix, m.namespace);
		return map;
	});

	/**
	 * Set of prefixes referenced anywhere in the profile that are
	 * neither declared in `namespaces` nor a built-in standard prefix.
	 * Standard prefixes are the ones the converters auto-recognise
	 * (rdf, rdfs, owl, xsd, etc.) — see STANDARD_PREFIXES in
	 * simpledsp-generator.
	 */
	const STANDARD = new Set([
		'rdf', 'rdfs', 'owl', 'xsd', 'dc', 'dcterms', 'foaf', 'skos', 'xl', 'schema',
	]);

	let undeclaredPrefixes = $derived.by((): string[] => {
		const found = new Set<string>();
		const collect = (s: string | undefined | null) => {
			if (!s) return;
			if (/^https?:/.test(s) || s.startsWith('urn:')) return;
			const colon = s.indexOf(':');
			if (colon <= 0) return;
			const p = s.slice(0, colon);
			if (/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(p)) found.add(p);
		};
		const collectList = (xs: string[] | undefined | null) => {
			if (!xs) return;
			for (const x of xs) collect(x);
		};
		for (const desc of project.descriptions) {
			collect(desc.targetClass);
			for (const stmt of desc.statements) {
				collect(stmt.propertyId);
				collect(stmt.datatype);
				collectList(stmt.classConstraint);
				collectList(stmt.inScheme);
			}
		}
		const ns = project.namespaces ?? {};
		return [...found]
			.filter((p) => !(p in ns) && !STANDARD.has(p))
			.sort();
	});

	// ── Inline declare ───────────────────────────────────────────────
	let editingPrefix = $state<string | null>(null);
	let editUri = $state('');

	function startDeclare(prefix: string) {
		editingPrefix = prefix;
		editUri = manifestByPrefix.get(prefix) ?? '';
	}

	function cancelDeclare() {
		editingPrefix = null;
		editUri = '';
	}

	function confirmDeclare() {
		if (!editingPrefix) return;
		const uri = editUri.trim();
		if (!uri) return;
		const proj = $currentProject;
		setNamespaces({ ...(proj?.namespaces ?? {}), [editingPrefix]: uri });
		cancelDeclare();
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') confirmDeclare();
		if (e.key === 'Escape') cancelDeclare();
	}
</script>

{#if undeclaredPrefixes.length > 0 && !dismissed}
	<div
		class="flex items-start gap-3 border-b border-amber-500/30 bg-amber-500/5 px-4 py-2"
		role="region"
		aria-label="Undeclared prefixes"
	>
		<AlertTriangle class="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />

		<div class="min-w-0 flex-1 space-y-1.5">
			<p class="text-xs text-foreground">
				<span class="font-medium">{undeclaredPrefixes.length}</span>
				{undeclaredPrefixes.length === 1 ? 'prefix is' : 'prefixes are'}
				used in this profile but not declared in namespaces.
				<span class="text-muted-foreground">Click a prefix below to add its namespace.</span>
			</p>

			<div class="flex flex-wrap items-center gap-1.5">
				{#each undeclaredPrefixes as prefix}
					{#if editingPrefix === prefix}
						<div class="inline-flex items-center gap-1 rounded border border-amber-500/40 bg-card px-1.5 py-1">
							<span class="font-mono text-[11px] text-foreground">{prefix}:</span>
							<input
								type="text"
								bind:value={editUri}
								onkeydown={handleKeydown}
								placeholder="http://example.org/ns#"
								class="h-5 w-56 px-1 text-[11px] font-mono bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-ring"
								autofocus
							/>
							<button
								type="button"
								onclick={confirmDeclare}
								class="rounded p-0.5 text-primary hover:bg-primary/10 [&_svg]:pointer-events-none"
								aria-label="Confirm declare"
								disabled={!editUri.trim()}
							>
								<Check class="h-3 w-3" />
							</button>
							<button
								type="button"
								onclick={cancelDeclare}
								class="rounded p-0.5 text-muted-foreground hover:bg-muted [&_svg]:pointer-events-none"
								aria-label="Cancel"
							>
								<X class="h-3 w-3" />
							</button>
						</div>
					{:else}
						<button
							type="button"
							onclick={() => startDeclare(prefix)}
							class="inline-flex items-center gap-1 rounded border border-amber-600/60 bg-amber-500 px-2 py-0.5 font-mono text-[11px] font-medium text-white shadow-sm hover:bg-amber-600 transition-colors"
							title={manifestByPrefix.has(prefix)
								? `Click to add ${prefix}: — URI will be pre-filled from the known vocabulary`
								: `Click to add a namespace for ${prefix}:`}
						>
							<span>{prefix}:</span>
							{#if manifestByPrefix.has(prefix)}
								<span class="rounded bg-white/25 px-1 text-[9px] uppercase tracking-wider">known</span>
							{/if}
						</button>
					{/if}
				{/each}
			</div>
		</div>

		<button
			type="button"
			class="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors [&_svg]:pointer-events-none"
			onclick={() => (dismissed = true)}
			aria-label="Dismiss"
			title="Dismiss for this session"
		>
			<X class="h-3.5 w-3.5" />
		</button>
	</div>
{/if}
