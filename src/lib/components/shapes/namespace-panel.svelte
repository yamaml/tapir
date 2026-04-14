<script lang="ts">
	import type { NamespaceMap } from '$lib/types';
	import { setNamespaces, setBase, renamePrefix } from '$lib/stores';
	import { currentProject } from '$lib/stores';
	import zazukoPrefixes from '@zazuko/prefixes';
	import Globe from 'lucide-svelte/icons/globe';
	import Plus from 'lucide-svelte/icons/plus';
	import Pencil from 'lucide-svelte/icons/pencil';
	import Trash2 from 'lucide-svelte/icons/trash-2';
	import X from 'lucide-svelte/icons/x';
	import Check from 'lucide-svelte/icons/check';

	interface Props {
		namespaces: NamespaceMap;
	}

	let { namespaces }: Props = $props();

	let entries = $derived(Object.entries(namespaces));
	let showAddForm = $state(false);
	let newPrefix = $state('');
	let newUri = $state('');
	let editingBase = $state(false);
	let baseValue = $state('');

	// ── Inline namespace edit ───────────────────────────────────────
	/** Prefix currently being edited (null when none). */
	let editingPrefix = $state<string | null>(null);
	/** Edit-time copies of the prefix label and URI. */
	let editPrefix = $state('');
	let editUri = $state('');
	/** Last error from a save attempt — shown inline. */
	let editError = $state<string | null>(null);

	// ── Well-known prefixes for quick add ────────────────────────

	const COMMON_PREFIXES = [
		{ prefix: 'schema', uri: 'http://schema.org/' },
		{ prefix: 'foaf', uri: 'http://xmlns.com/foaf/0.1/' },
		{ prefix: 'dcterms', uri: 'http://purl.org/dc/terms/' },
		{ prefix: 'dc', uri: 'http://purl.org/dc/elements/1.1/' },
		{ prefix: 'skos', uri: 'http://www.w3.org/2004/02/skos/core#' },
		{ prefix: 'dcat', uri: 'http://www.w3.org/ns/dcat#' },
		{ prefix: 'prov', uri: 'http://www.w3.org/ns/prov#' },
		{ prefix: 'org', uri: 'http://www.w3.org/ns/org#' },
		{ prefix: 'vcard', uri: 'http://www.w3.org/2006/vcard/ns#' },
	];

	/** Prefixes not already added. */
	let availablePrefixes = $derived(
		COMMON_PREFIXES.filter((p) => !(p.prefix in namespaces))
	);

	/**
	 * Prefixes the user has typed somewhere in the profile but never
	 * declared in `namespaces`. We surface these in the add form so the
	 * user can declare them with one click instead of retyping the label.
	 * The URI isn't known, so quick-add only fills the prefix field.
	 */
	let undeclaredInProfilePrefixes = $derived.by((): string[] => {
		const proj = $currentProject;
		if (!proj) return [];
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
		for (const desc of proj.descriptions) {
			collect(desc.targetClass);
			for (const stmt of desc.statements) {
				collect(stmt.propertyId);
				collect(stmt.datatype);
				collectList(stmt.classConstraint);
				collectList(stmt.inScheme);
			}
		}
		// Drop those already declared.
		return [...found].filter((p) => !(p in namespaces)).sort();
	});

	function quickFillPrefix(prefix: string) {
		newPrefix = prefix;
		newUri = '';
	}

	function truncateUri(uri: string, maxLen = 28): string {
		if (uri.length <= maxLen) return uri;
		return uri.slice(0, maxLen - 1) + '\u2026';
	}

	function handleAddNamespace() {
		const prefix = newPrefix.trim();
		const uri = newUri.trim();
		if (!prefix || !uri) return;

		const updated = { ...namespaces, [prefix]: uri };
		setNamespaces(updated);
		newPrefix = '';
		newUri = '';
		showAddForm = false;
	}

	function handleQuickAdd(prefix: string, uri: string) {
		const updated = { ...namespaces, [prefix]: uri };
		setNamespaces(updated);
	}

	function handleRemoveNamespace(prefix: string) {
		const updated = { ...namespaces };
		delete updated[prefix];
		setNamespaces(updated);
	}

	function startEditNamespace(prefix: string, uri: string) {
		editingPrefix = prefix;
		editPrefix = prefix;
		editUri = uri;
		editError = null;
	}

	function cancelEditNamespace() {
		editingPrefix = null;
		editError = null;
	}

	function saveEditNamespace() {
		if (editingPrefix == null) return;
		const oldPrefix = editingPrefix;
		const nextPrefix = editPrefix.trim();
		const nextUri = editUri.trim();

		if (!nextPrefix || !nextUri) {
			editError = 'Both prefix and URI are required';
			return;
		}
		if (nextPrefix !== oldPrefix && nextPrefix in namespaces) {
			editError = `Prefix "${nextPrefix}" already exists`;
			return;
		}

		// Apply prefix rename first (it rewrites references in the project),
		// then update the URI on the renamed key.
		if (nextPrefix !== oldPrefix) {
			const ok = renamePrefix(oldPrefix, nextPrefix);
			if (!ok) {
				editError = 'Rename failed — pick a different prefix';
				return;
			}
		}

		// Apply the URI change (which may also be a no-op if unchanged).
		const proj = $currentProject;
		const current = proj?.namespaces ?? {};
		if (current[nextPrefix] !== nextUri) {
			setNamespaces({ ...current, [nextPrefix]: nextUri });
		}

		cancelEditNamespace();
	}

	function handleEditKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') saveEditNamespace();
		if (e.key === 'Escape') cancelEditNamespace();
	}

	function handlePrefixInput() {
		// Intentionally no auto-fill: per the YAMA namespace resolution rule,
		// any prefix a user declares binds to the URI they specify — even if
		// the label matches a standard one. The suggestion popover below is
		// different — it shows candidates, the user still has to pick one,
		// which is an explicit action rather than a silent rewrite.
		prefixHighlight = 0;
	}

	// ── Prefix suggestion popover ───────────────────────────────────
	let prefixFocused = $state(false);
	let prefixHighlight = $state(0);

	type PrefixSuggestion = { prefix: string; uri: string };

	/**
	 * Full catalogue of known prefixes the user might be referring to.
	 * Union of the curated COMMON list and @zazuko/prefixes (~116
	 * well-known RDF vocabularies, all bundled locally — no network).
	 * Entries already declared in the profile are filtered out.
	 */
	let allKnownPrefixes = $derived.by<PrefixSuggestion[]>(() => {
		const map = new Map<string, PrefixSuggestion>();
		for (const [prefix, uri] of Object.entries(zazukoPrefixes)) {
			map.set(prefix, { prefix, uri });
		}
		for (const c of COMMON_PREFIXES) {
			map.set(c.prefix, { prefix: c.prefix, uri: c.uri });
		}
		return [...map.values()]
			.filter((s) => !(s.prefix in namespaces))
			.sort((a, b) => a.prefix.localeCompare(b.prefix));
	});

	let prefixSuggestions = $derived.by(() => {
		const q = newPrefix.trim().toLowerCase();
		if (!q) return [] as PrefixSuggestion[];
		return allKnownPrefixes.filter((s) => s.prefix.toLowerCase().startsWith(q));
	});
	let showPrefixSuggestions = $derived(
		prefixFocused && prefixSuggestions.length > 0
	);

	function acceptPrefixSuggestion(s: PrefixSuggestion) {
		newPrefix = s.prefix;
		newUri = s.uri;
		prefixFocused = false;
	}

	function handlePrefixFocus() {
		prefixFocused = true;
	}

	function handlePrefixBlur() {
		// Delay close so a click on a suggestion fires first.
		setTimeout(() => {
			prefixFocused = false;
		}, 150);
	}

	function handlePrefixKeydown(e: KeyboardEvent) {
		if (showPrefixSuggestions) {
			if (e.key === 'ArrowDown') {
				e.preventDefault();
				prefixHighlight = Math.min(prefixHighlight + 1, prefixSuggestions.length - 1);
				return;
			}
			if (e.key === 'ArrowUp') {
				e.preventDefault();
				prefixHighlight = Math.max(prefixHighlight - 1, 0);
				return;
			}
			if (e.key === 'Enter') {
				e.preventDefault();
				const picked = prefixSuggestions[prefixHighlight];
				if (picked) acceptPrefixSuggestion(picked);
				return;
			}
			if (e.key === 'Escape') {
				e.preventDefault();
				prefixFocused = false;
				return;
			}
			if (e.key === 'Tab') {
				const picked = prefixSuggestions[prefixHighlight];
				if (picked) {
					e.preventDefault();
					acceptPrefixSuggestion(picked);
				}
				return;
			}
		}
		if (e.key === 'Enter') handleAddNamespace();
		if (e.key === 'Escape') { showAddForm = false; }
	}

	function startEditBase() {
		const proj = $currentProject;
		baseValue = proj?.base || '';
		editingBase = true;
	}

	function saveBase() {
		setBase(baseValue.trim());
		editingBase = false;
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') handleAddNamespace();
		if (e.key === 'Escape') { showAddForm = false; }
	}

	function handleBaseKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') saveBase();
		if (e.key === 'Escape') { editingBase = false; }
	}
</script>

<div class="px-3 py-2">
	<div class="flex items-center justify-between mb-1.5">
		<div class="flex items-center gap-1.5">
			<Globe class="h-3 w-3 text-muted-foreground" />
			<span class="text-xs font-medium text-muted-foreground uppercase tracking-wider">Namespaces</span>
		</div>
		<button
			type="button"
			class="flex items-center text-[10px] text-primary hover:text-primary/80 transition-colors [&_svg]:pointer-events-none"
			onclick={() => { showAddForm = !showAddForm; }}
		>
			<Plus class="inline h-3 w-3 mr-0.5" />Add
		</button>
	</div>

	<!--
		Base IRI — only relevant for SimpleDSP / YAMA profiles, where it
		seeds the @base for record URIs and shape IRIs. DCTAP profiles
		are tabular and identifier-free at the profile level (shapes are
		referenced by `shapeID` only), so we hide this control for DCTAP.
	-->
	{#if $currentProject?.flavor !== 'dctap'}
		<div class="mb-1.5">
			{#if editingBase}
				<div class="flex gap-1">
					<input
						type="text"
						bind:value={baseValue}
						onkeydown={handleBaseKeydown}
						placeholder="http://example.org/"
						class="w-full h-6 px-1.5 text-[10px] font-mono bg-background border border-ring rounded focus:outline-none focus:ring-1 focus:ring-ring"
						autofocus
					/>
					<button type="button" onclick={saveBase} class="text-primary hover:text-primary/80 [&_svg]:pointer-events-none">
						<Check class="h-3 w-3" />
					</button>
					<button type="button" onclick={() => (editingBase = false)} class="text-muted-foreground hover:text-foreground [&_svg]:pointer-events-none">
						<X class="h-3 w-3" />
					</button>
				</div>
			{:else}
				<button
					type="button"
					class="text-[10px] text-muted-foreground hover:text-foreground transition-colors w-full text-left"
					onclick={startEditBase}
				>
					{#if $currentProject?.base}
						<span class="font-mono">@base: {truncateUri($currentProject.base)}</span>
					{:else}
						<span class="italic">+ Set base IRI</span>
					{/if}
				</button>
			{/if}
		</div>
	{/if}

	<!-- Namespace list -->
	{#if entries.length === 0}
		<p class="text-[11px] text-muted-foreground py-1">No namespaces defined</p>
	{:else}
		<div class="space-y-0.5 max-h-[160px] overflow-y-auto">
			{#each entries as [prefix, uri]}
				{#if editingPrefix === prefix}
					<!--
						Vertical layout: each field on its own labelled row so
						they fit in the 220 px sidebar without horizontal
						scroll. Mirrors the add-namespace form below for
						visual consistency.
					-->
					<div class="rounded border border-ring bg-card p-2 space-y-1.5">
						<div class="space-y-0.5">
							<label class="text-[9px] font-medium uppercase tracking-wider text-muted-foreground">Prefix</label>
							<input
								type="text"
								bind:value={editPrefix}
								onkeydown={handleEditKeydown}
								placeholder="prefix"
								class="block w-full h-6 px-1.5 text-[11px] font-mono bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-ring"
								autofocus
							/>
						</div>
						<div class="space-y-0.5">
							<label class="text-[9px] font-medium uppercase tracking-wider text-muted-foreground">Namespace URI</label>
							<input
								type="text"
								bind:value={editUri}
								onkeydown={handleEditKeydown}
								placeholder="http://example.org/ns#"
								class="block w-full h-6 px-1.5 text-[11px] font-mono bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-ring"
							/>
						</div>
						{#if editError}
							<p class="text-[10px] text-destructive">{editError}</p>
						{/if}
						<div class="flex items-center justify-end gap-1 pt-0.5">
							<button
								type="button"
								onclick={cancelEditNamespace}
								class="h-6 px-2 text-[10px] rounded border border-border text-muted-foreground hover:text-foreground transition-colors"
							>
								Cancel
							</button>
							<button
								type="button"
								onclick={saveEditNamespace}
								class="h-6 px-2 text-[10px] rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
							>
								Save
							</button>
						</div>
					</div>
				{:else}
					<div class="group flex items-baseline gap-1.5 text-[11px]">
						<span class="font-mono font-medium text-foreground shrink-0">{prefix}:</span>
						<span class="text-muted-foreground font-mono truncate flex-1" title={uri}>{truncateUri(uri)}</span>
						<button
							type="button"
							class="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-opacity shrink-0 [&_svg]:pointer-events-none"
							onclick={() => startEditNamespace(prefix, uri)}
							title="Edit namespace"
						>
							<Pencil class="h-2.5 w-2.5" />
						</button>
						<button
							type="button"
							class="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity shrink-0 [&_svg]:pointer-events-none"
							onclick={() => handleRemoveNamespace(prefix)}
							title="Remove namespace"
						>
							<Trash2 class="h-2.5 w-2.5" />
						</button>
					</div>
				{/if}
			{/each}
		</div>
	{/if}

	<!-- Add form -->
	{#if showAddForm}
		<div class="mt-2 space-y-1.5 rounded border border-border p-2 bg-card">
			<!--
				Two rows of suggestions:
				1. Prefixes used in this profile but not declared yet —
				   one click fills the prefix label, user adds the URI.
				2. Well-known vocabularies — one click fills both.
			-->
			{#if undeclaredInProfilePrefixes.length > 0}
				<div class="space-y-0.5">
					<p class="text-[9px] uppercase tracking-wider text-amber-600 dark:text-amber-400 font-semibold">Used in profile, undeclared</p>
					<div class="flex flex-wrap gap-1">
						{#each undeclaredInProfilePrefixes as p}
							<button
								type="button"
								class="px-1.5 py-0.5 rounded border border-amber-600/60 bg-amber-500 text-white text-[10px] font-mono font-medium shadow-sm hover:bg-amber-600 transition-colors"
								onclick={() => quickFillPrefix(p)}
								title="Click to use this prefix; type the namespace URI below"
							>
								{p}:
							</button>
						{/each}
					</div>
				</div>
			{/if}

			{#if availablePrefixes.length > 0}
				<div class="space-y-0.5">
					<p class="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">Common vocabularies</p>
					<div class="flex flex-wrap gap-1 mb-2">
						{#each availablePrefixes.slice(0, 6) as p}
							<button
								type="button"
								class="px-1.5 py-0.5 rounded bg-accent text-accent-foreground text-[10px] font-mono font-medium hover:bg-primary hover:text-primary-foreground transition-colors"
								onclick={() => handleQuickAdd(p.prefix, p.uri)}
								title="Add {p.prefix}: {p.uri}"
							>
								{p.prefix}:
							</button>
						{/each}
					</div>
				</div>
			{/if}

			<!-- Custom prefix/URI inputs -->
			<div class="relative">
				<input
					type="text"
					bind:value={newPrefix}
					oninput={handlePrefixInput}
					onkeydown={handlePrefixKeydown}
					onfocus={handlePrefixFocus}
					onblur={handlePrefixBlur}
					placeholder="prefix"
					autocomplete="off"
					role="combobox"
					aria-expanded={showPrefixSuggestions}
					aria-autocomplete="list"
					class="w-full h-6 px-1.5 text-[10px] font-mono bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-ring"
				/>
				{#if showPrefixSuggestions}
					<ul
						role="listbox"
						class="absolute left-0 top-full z-50 mt-1 max-h-48 w-full overflow-y-auto rounded-md border border-border bg-popover shadow-md py-1 text-[10px]"
					>
						{#each prefixSuggestions as s, i (s.prefix)}
							<!-- svelte-ignore a11y_click_events_have_key_events -->
							<li
								role="option"
								aria-selected={i === prefixHighlight}
								onmousedown={(e) => { e.preventDefault(); acceptPrefixSuggestion(s); }}
								onmouseenter={() => (prefixHighlight = i)}
								class="flex items-baseline gap-1.5 px-1.5 py-0.5 cursor-pointer {i === prefixHighlight ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'}"
							>
								<span class="font-mono font-semibold shrink-0">{s.prefix}</span>
								<span class="font-mono text-muted-foreground truncate" title={s.uri}>{s.uri}</span>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
			<input
				type="text"
				bind:value={newUri}
				onkeydown={handleKeydown}
				placeholder="http://example.org/ns#"
				class="w-full h-6 px-1.5 text-[10px] font-mono bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-ring"
			/>
			<div class="flex gap-1">
				<button
					type="button"
					class="flex-1 h-6 text-[10px] rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
					disabled={!newPrefix.trim() || !newUri.trim()}
					onclick={handleAddNamespace}
				>
					Add namespace
				</button>
				<button
					type="button"
					class="h-6 px-2 text-[10px] rounded border border-border text-muted-foreground hover:text-foreground transition-colors"
					onclick={() => { showAddForm = false; newPrefix = ''; newUri = ''; }}
				>
					Cancel
				</button>
			</div>
		</div>
	{/if}
</div>
