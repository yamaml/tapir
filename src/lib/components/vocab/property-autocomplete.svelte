<script lang="ts">
	import type { VocabSearchResult, VocabManifestEntry, NamespaceMap } from '$lib/types';
	import { searchVocab, loadVocab, loadedPrefixes } from '$lib/stores/vocab-store';
	import { currentProject } from '$lib/stores/project-store';
	import { setNamespaces } from '$lib/stores/project-store';
	import { base } from '$app/paths';
	import Plus from 'lucide-svelte/icons/plus';
	import Check from 'lucide-svelte/icons/check';

	interface Props {
		value: string;
		placeholder?: string;
		onselect?: (result: VocabSearchResult) => void;
		onchange?: (value: string) => void;
		type?: 'C' | 'P';
		class?: string;
	}

	let {
		value = $bindable(),
		placeholder = 'prefix:term',
		onselect,
		onchange,
		type,
		class: className = '',
	}: Props = $props();

	// ── State ───────────────────────────────────────────────────

	type DropdownItem =
		| { kind: 'prefix-suggestion'; prefix: string; uri: string; inProject: boolean }
		| { kind: 'in-profile-prefix'; prefix: string }
		| { kind: 'term-result'; result: VocabSearchResult }
		| { kind: 'loading'; prefix: string }
		| { kind: 'unknown-prefix'; prefix: string };

	let items = $state<DropdownItem[]>([]);
	let showDropdown = $state(false);
	let selectedIndex = $state(-1);
	let debounceTimer: ReturnType<typeof setTimeout> | undefined;

	/** The project's current namespace map. */
	let projectNs = $derived($currentProject?.namespaces ?? {});

	/** Known prefixes from the vocabulary manifest. */
	let manifestPrefixes = $state<VocabManifestEntry[]>([]);
	let manifestLoaded = $state(false);

	/**
	 * Prefixes that the user has *typed* somewhere in the profile but
	 * hasn't declared in `namespaces` and that aren't in our shipped
	 * vocab manifest either. Surfacing these in autocomplete lets users
	 * pick a prefix they're already using when typing into another field
	 * — useful when the profile imports a custom vocabulary the user
	 * hasn't formally declared yet.
	 */
	let inProfilePrefixes = $derived.by((): string[] => {
		const proj = $currentProject;
		if (!proj) return [];
		const found = new Set<string>();
		const collect = (s: string | undefined | null) => {
			if (!s) return;
			// CURIE-like: prefix:localname (skip absolute IRIs)
			if (/^https?:/.test(s) || s.startsWith('urn:')) return;
			const colon = s.indexOf(':');
			if (colon <= 0) return;
			const p = s.slice(0, colon);
			// Prefix must look like an XML NCName start: letter/underscore + alnum/_-/.
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
		return [...found];
	});

	// Load manifest on first use
	async function ensureManifest(): Promise<void> {
		if (manifestLoaded) return;
		try {
			const res = await fetch(`${base}/vocabs/_manifest.json`);
			if (res.ok) manifestPrefixes = await res.json();
		} catch { /* silent */ }
		manifestLoaded = true;
	}

	// ── Two-phase search ────────────────────────────────────────

	function parseInput(input: string): { prefix: string; local: string; hasColon: boolean } {
		const colonIdx = input.indexOf(':');
		if (colonIdx >= 0) {
			return { prefix: input.slice(0, colonIdx), local: input.slice(colonIdx + 1), hasColon: true };
		}
		return { prefix: input, local: '', hasColon: false };
	}

	async function doSearch(query: string): Promise<void> {
		if (query.length === 0) {
			items = [];
			showDropdown = false;
			return;
		}

		const { prefix, local, hasColon } = parseInput(query);

		if (!hasColon) {
			// Phase 1: suggest prefixes — three sources, in priority order:
			//   1. Project namespaces (declared by the user)
			//   2. Prefixes the user has already typed in the profile but
			//      not declared and not in our manifest (likely a custom
			//      vocab they're using ad-hoc)
			//   3. Manifest vocabs not yet in the project
			await ensureManifest();
			const matching: DropdownItem[] = [];
			const lowerPrefix = prefix.toLowerCase();
			const manifestPrefixSet = new Set(manifestPrefixes.map((m) => m.prefix));

			// 1. Project namespaces
			for (const [p, uri] of Object.entries(projectNs)) {
				if (p.toLowerCase().startsWith(lowerPrefix)) {
					matching.push({ kind: 'prefix-suggestion', prefix: p, uri, inProject: true });
				}
			}

			// 2. In-profile but undeclared prefixes (and not in manifest)
			for (const p of inProfilePrefixes) {
				if (!p.toLowerCase().startsWith(lowerPrefix)) continue;
				if (p in projectNs) continue;
				if (manifestPrefixSet.has(p)) continue;
				matching.push({ kind: 'in-profile-prefix', prefix: p });
			}

			// 3. Manifest vocabs not yet in the project
			for (const entry of manifestPrefixes) {
				if (entry.prefix.toLowerCase().startsWith(lowerPrefix) && !(entry.prefix in projectNs)) {
					matching.push({
						kind: 'prefix-suggestion',
						prefix: entry.prefix,
						uri: entry.namespace,
						inProject: false,
					});
				}
			}

			items = matching.slice(0, 15);
			showDropdown = items.length > 0;
			selectedIndex = -1;
			return;
		}

		// Phase 2: prefix is known, filter terms
		// Resolve the user's prefix to the canonical vocab (one we have
		// a chunk for). A user may have declared their own alias, such as
		// `sdo: http://schema.org/`; in that case we still autocomplete
		// against the schema.org vocab but display results under `sdo:`.
		await ensureManifest();
		const { canonical, userUri } = resolveCanonical(prefix);

		if (!canonical) {
			// Not in the project namespaces and not in the manifest.
			const manifestMatch = manifestPrefixes.find((m) => m.prefix === prefix);
			if (manifestMatch) {
				items = [{ kind: 'unknown-prefix', prefix }];
			} else {
				items = [];
			}
			showDropdown = items.length > 0;
			selectedIndex = -1;
			return;
		}

		// Ensure the canonical vocab chunk is loaded
		if (!$loadedPrefixes.has(canonical)) {
			items = [{ kind: 'loading', prefix }];
			showDropdown = true;
			selectedIndex = -1;
			try {
				await loadVocab(canonical, base);
			} catch {
				items = [];
				showDropdown = false;
				return;
			}
		}

		// Search terms within the canonical vocab, then re-prefix the
		// results with the user's alias. This keeps the dropdown and the
		// inserted value consistent with what the user typed.
		const searchQuery = local ? `${canonical}:${local}` : `${canonical}:`;
		const results = searchVocab(searchQuery, { type, limit: 20 });
		const displayResults = canonical === prefix
			? results
			: results.map((r) => ({
					...r,
					prefix,
					prefixed: `${prefix}:${r.localName}`,
				}));
		items = displayResults.map((r) => ({ kind: 'term-result' as const, result: r }));
		// Note: userUri is tracked for future diagnostics (e.g. warn when
		// the user's URI differs from the canonical vocab's namespace)
		// but we don't block autocomplete on the mismatch today.
		void userUri;
		showDropdown = items.length > 0;
		selectedIndex = -1;
	}

	/**
	 * Resolves a user-declared prefix to a canonical vocab prefix we
	 * have a chunk for. Returns both the canonical prefix (or null if
	 * the URI is unknown) and the user's declared URI (for diagnostics).
	 */
	function resolveCanonical(
		userPrefix: string
	): { canonical: string | null; userUri: string | null } {
		const userUri = projectNs[userPrefix] ?? null;

		// Case 1: user declared the same prefix the manifest uses.
		if (userPrefix in projectNs && manifestPrefixes.some((m) => m.prefix === userPrefix)) {
			return { canonical: userPrefix, userUri };
		}

		// Case 2: user declared a prefix not in the manifest — look up
		// by the URI to find a canonical vocab chunk with matching ns.
		if (userUri) {
			const byUri = manifestPrefixes.find((m) => m.namespace === userUri);
			if (byUri) return { canonical: byUri.prefix, userUri };
			// URI is declared but unknown to us — can't autocomplete.
			return { canonical: null, userUri };
		}

		// Case 3: user hasn't declared this prefix. If it happens to
		// match a manifest entry directly, use that.
		const byPrefix = manifestPrefixes.find((m) => m.prefix === userPrefix);
		if (byPrefix) return { canonical: byPrefix.prefix, userUri: null };

		return { canonical: null, userUri: null };
	}

	// ── Event Handlers ──────────────────────────────────────────

	function handleInput(e: Event): void {
		const target = e.target as HTMLInputElement;
		value = target.value;
		onchange?.(value);

		if (debounceTimer) clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => doSearch(value), 100);
	}

	function handleKeydown(e: KeyboardEvent): void {
		if (!showDropdown || items.length === 0) return;

		switch (e.key) {
			case 'ArrowDown':
				e.preventDefault();
				selectedIndex = Math.min(selectedIndex + 1, items.length - 1);
				break;
			case 'ArrowUp':
				e.preventDefault();
				selectedIndex = Math.max(selectedIndex - 1, -1);
				break;
			case 'Enter':
				e.preventDefault();
				if (selectedIndex >= 0 && selectedIndex < items.length) {
					selectItem(items[selectedIndex]);
				}
				break;
			case 'Escape':
				e.preventDefault();
				showDropdown = false;
				selectedIndex = -1;
				break;
		}
	}

	function selectItem(item: DropdownItem): void {
		if (item.kind === 'prefix-suggestion') {
			// Only add the prefix if the user has not already bound it to
			// something. Per the YAMA namespace resolution rule, user
			// declarations are authoritative and must never be overwritten
			// by auto-suggestions — the user's local binding wins, even if
			// their URI differs from the vocabulary's canonical one.
			if (!(item.prefix in projectNs)) {
				setNamespaces({ ...projectNs, [item.prefix]: item.uri });
			}
			// Set value to prefix: and trigger term search
			value = `${item.prefix}:`;
			onchange?.(value);
			showDropdown = false;
			// After a tick, trigger term search
			setTimeout(() => doSearch(value), 50);
		} else if (item.kind === 'in-profile-prefix') {
			// User has already typed this prefix elsewhere in the profile
			// but never declared it. Selecting just inserts the prefix —
			// we don't add a namespace declaration because we don't know
			// the URI; the user will set it via the namespace panel.
			value = `${item.prefix}:`;
			onchange?.(value);
			showDropdown = false;
			setTimeout(() => doSearch(value), 50);
		} else if (item.kind === 'term-result') {
			value = item.result.prefixed;
			showDropdown = false;
			selectedIndex = -1;
			onselect?.(item.result);
			onchange?.(value);
		} else if (item.kind === 'unknown-prefix') {
			// Add the prefix from the manifest only if the user has not
			// declared it already. A user binding — even to a different
			// URI — is authoritative and must not be overwritten.
			const entry = manifestPrefixes.find((m) => m.prefix === item.prefix);
			if (entry && !(entry.prefix in projectNs)) {
				setNamespaces({ ...projectNs, [entry.prefix]: entry.namespace });
				value = `${item.prefix}:`;
				onchange?.(value);
				showDropdown = false;
				setTimeout(() => doSearch(value), 50);
			} else if (entry) {
				// User already has this prefix bound; just use it and search.
				value = `${item.prefix}:`;
				onchange?.(value);
				showDropdown = false;
				setTimeout(() => doSearch(value), 50);
			}
		}
	}

	function handleFocus(): void {
		if (value.length > 0 && items.length > 0) {
			showDropdown = true;
		}
	}

	function handleBlur(): void {
		setTimeout(() => {
			showDropdown = false;
			selectedIndex = -1;
		}, 200);
	}

	function typeBadge(t: 'C' | 'P'): string {
		return t === 'C' ? 'Class' : 'Prop';
	}

	function typeBadgeClass(t: 'C' | 'P'): string {
		return t === 'C'
			? 'bg-blue-500/15 text-blue-400'
			: 'bg-green-500/15 text-green-400';
	}
</script>

<div class="relative {className}">
	<input
		type="text"
		{value}
		{placeholder}
		oninput={handleInput}
		onkeydown={handleKeydown}
		onfocus={handleFocus}
		onblur={handleBlur}
		autocomplete="off"
		class="w-full h-7 rounded-md border border-border bg-background px-2 py-1 text-xs font-mono outline-none focus:border-ring focus:ring-1 focus:ring-ring"
	/>

	{#if showDropdown && items.length > 0}
		<div
			class="absolute z-50 mt-1 max-h-60 w-full min-w-[240px] overflow-auto rounded-md border border-border bg-popover shadow-lg"
			role="listbox"
		>
			{#each items as item, i}
				{#if item.kind === 'prefix-suggestion'}
					<button
						role="option"
						aria-selected={i === selectedIndex}
						class="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs transition [&_svg]:pointer-events-none
							{i === selectedIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'}"
						onmousedown={(e) => { e.preventDefault(); selectItem(item); }}
					>
						<span class="font-mono font-medium text-foreground">{item.prefix}:</span>
						<span class="truncate text-muted-foreground text-[10px]">{item.uri}</span>
						{#if item.inProject}
							<span class="ml-auto shrink-0">
								<Check class="h-3 w-3 text-green-400" />
							</span>
						{:else}
							<span class="ml-auto shrink-0 flex items-center gap-0.5 text-[10px] text-primary">
								<Plus class="h-2.5 w-2.5" />add
							</span>
						{/if}
					</button>
				{:else if item.kind === 'in-profile-prefix'}
					<button
						role="option"
						aria-selected={i === selectedIndex}
						class="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs transition [&_svg]:pointer-events-none
							{i === selectedIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'}"
						onmousedown={(e) => { e.preventDefault(); selectItem(item); }}
						title="Used in this profile but not declared in namespaces"
					>
						<span class="font-mono font-medium text-foreground">{item.prefix}:</span>
						<span class="truncate text-muted-foreground text-[10px] italic">used in profile (not declared)</span>
						<span class="ml-auto shrink-0 text-[10px] text-amber-500">undeclared</span>
					</button>
				{:else if item.kind === 'term-result'}
					<button
						role="option"
						aria-selected={i === selectedIndex}
						class="flex w-full items-center gap-2 px-2 py-1 text-left text-xs transition [&_svg]:pointer-events-none
							{i === selectedIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'}"
						onmousedown={(e) => { e.preventDefault(); selectItem(item); }}
					>
						<span class="font-mono font-medium text-foreground">
							{item.result.prefixed}
						</span>
						{#if item.result.term.l && item.result.term.l !== item.result.localName}
							<span class="truncate text-muted-foreground">
								{item.result.term.l}
							</span>
						{/if}
						<span
							class="ml-auto shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium {typeBadgeClass(item.result.term.t)}"
						>
							{typeBadge(item.result.term.t)}
						</span>
					</button>
				{:else if item.kind === 'loading'}
					<div class="px-2 py-2 text-xs text-muted-foreground text-center">
						Loading {item.prefix} vocabulary...
					</div>
				{:else if item.kind === 'unknown-prefix'}
					<button
						role="option"
						aria-selected={i === selectedIndex}
						class="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs transition [&_svg]:pointer-events-none
							{i === selectedIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'}"
						onmousedown={(e) => { e.preventDefault(); selectItem(item); }}
					>
						<span class="font-mono text-foreground">{item.prefix}:</span>
						<span class="text-muted-foreground">Click to add this prefix</span>
						<span class="ml-auto shrink-0 flex items-center gap-0.5 text-[10px] text-primary">
							<Plus class="h-2.5 w-2.5" />add
						</span>
					</button>
				{/if}
			{/each}
		</div>
	{/if}
</div>
