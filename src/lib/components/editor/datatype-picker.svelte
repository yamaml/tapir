<!--
	Multi-select datatype picker.

	Two layers of affordance, deliberately kept separate:

	1. Quick-pick chips for the curated 14 common XSD + RDF datatypes —
	   one-click, no typing required, no UI mode-switch.
	2. Typeahead input for the long tail and project-specific datatypes.
	   As the user types, suggestions are filtered live from a hardcoded
	   pool of XSD/RDF datatypes that aren't already in the quick-pick.
	   Free-text commit still works for anything outside the pool
	   (`edtf:EDTF`, `geo:wktLiteral`, etc.).

	The internal Statement model carries `datatype: string[]` to express
	the union semantics endorsed by SimpleDSP (§4.6 Table 16) and used by
	the DCMI SRAP profile (e.g. `xsd:gYear xsd:gYearMonth xsd:date`).
-->
<script lang="ts">
	import * as Popover from '$lib/components/ui/popover';
	import X from 'lucide-svelte/icons/x';
	import Plus from 'lucide-svelte/icons/plus';

	interface Props {
		/** Currently selected datatype CURIEs (e.g. `['xsd:string']`). */
		selected: string[];
		/** Canonical quick-pick option list. Custom datatypes are added via
		 *  the typeahead — this list is just the curated shortcut. */
		options: string[];
		/** Called with the new selection whenever the user adds or removes. */
		onchange: (next: string[]) => void;
		/** Placeholder when no datatype is selected. */
		placeholder?: string;
	}

	let { selected, options, onchange, placeholder = '(none)' }: Props = $props();

	let open = $state(false);
	let customInput = $state('');
	let suggestionIndex = $state(-1);

	let available = $derived(options.filter((o) => !selected.includes(o)));

	/**
	 * Long-tail XSD + RDF datatypes, surfaced through the typeahead input.
	 * Curated from the W3C XSD spec (built-in datatypes) plus the RDF/RDFS
	 * literal types in active use. Quick-pick entries are intentionally
	 * not duplicated here — the typeahead pool is purely the "extras".
	 *
	 * Update this list when the W3C ratifies new types (rare — `rdf:JSON`
	 * was added in 2024, prior to that the set was effectively stable).
	 */
	const TYPEAHEAD_POOL: readonly string[] = [
		// XSD date/time variants (gYear already in quick-pick)
		'xsd:gYearMonth',
		'xsd:gMonth',
		'xsd:gMonthDay',
		'xsd:gDay',
		'xsd:duration',
		'xsd:dayTimeDuration',
		'xsd:yearMonthDuration',
		// XSD sized integers
		'xsd:byte',
		'xsd:short',
		'xsd:long',
		'xsd:positiveInteger',
		'xsd:negativeInteger',
		'xsd:nonPositiveInteger',
		// XSD unsigned integers (less common but spec-correct)
		'xsd:unsignedByte',
		'xsd:unsignedShort',
		'xsd:unsignedInt',
		'xsd:unsignedLong',
		// XSD string variants
		'xsd:normalizedString',
		'xsd:token',
		'xsd:language',
		// XSD XML name types
		'xsd:Name',
		'xsd:NCName',
		'xsd:NMTOKEN',
		'xsd:ID',
		'xsd:IDREF',
		// XSD binary
		'xsd:hexBinary',
		'xsd:base64Binary',
		// RDF concrete literal types (langString is in quick-pick)
		'rdf:HTML',
		'rdf:XMLLiteral',
		'rdf:JSON',
	];

	/** The complete searchable pool: the caller's quick-pick options
	 *  plus the long-tail pool, de-duplicated. Quick-pick entries
	 *  surface in typeahead too so users who remember a datatype name
	 *  (e.g. "xsd:float") don't have to mentally check whether it's
	 *  a chip above or a long-tail entry — they just type. */
	let searchPool = $derived(
		Array.from(new Set([...options, ...TYPEAHEAD_POOL])),
	);

	/** Filtered suggestions: case-insensitive substring match, capped at
	 *  10 entries so the floater never grows unreasonably tall inside the
	 *  popover. Excludes already-selected items. */
	let suggestions = $derived.by((): string[] => {
		const q = customInput.trim().toLowerCase();
		if (!q) return [];
		return searchPool
			.filter((dt) => !selected.includes(dt) && dt.toLowerCase().includes(q))
			.slice(0, 10);
	});

	/** True when the typed value exactly matches a pool entry — used to
	 *  suppress the "Use as custom" line so we don't show the same
	 *  suggestion twice. */
	let exactMatch = $derived(
		searchPool.some((dt) => dt === customInput.trim()),
	);

	function add(name: string) {
		const trimmed = name.trim();
		if (!trimmed || selected.includes(trimmed)) return;
		onchange([...selected, trimmed]);
	}

	function remove(name: string) {
		onchange(selected.filter((r) => r !== name));
	}

	function commitCustom(value?: string) {
		const val = (value ?? customInput).trim();
		if (!val) return;
		add(val);
		customInput = '';
		suggestionIndex = -1;
		open = false;
	}

	function onCustomKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			if (suggestionIndex >= 0 && suggestionIndex < suggestions.length) {
				commitCustom(suggestions[suggestionIndex]);
			} else {
				commitCustom();
			}
		} else if (e.key === 'ArrowDown') {
			e.preventDefault();
			if (suggestions.length === 0) return;
			suggestionIndex = (suggestionIndex + 1) % suggestions.length;
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			if (suggestions.length === 0) return;
			suggestionIndex =
				suggestionIndex <= 0 ? suggestions.length - 1 : suggestionIndex - 1;
		} else if (e.key === 'Escape') {
			if (customInput) {
				e.preventDefault();
				customInput = '';
				suggestionIndex = -1;
			}
		}
	}
</script>

<style>
	.chip-scroll {
		scrollbar-width: thin;
		scrollbar-color: var(--muted-foreground) transparent;
	}
	.chip-scroll::-webkit-scrollbar {
		height: 4px;
	}
	.chip-scroll::-webkit-scrollbar-thumb {
		background-color: color-mix(in oklch, currentColor 25%, transparent);
		border-radius: 2px;
	}
</style>

<div
	class="group flex items-center gap-1 rounded-md border border-input bg-background px-1.5 h-7 overflow-hidden"
>
	<div class="chip-scroll flex items-center gap-1 flex-1 min-w-0 overflow-x-auto">
		{#if selected.length === 0}
			<span class="text-[10px] text-muted-foreground italic px-1 shrink-0">
				{placeholder}
			</span>
		{/if}

		{#each selected as name}
			<span
				class="inline-flex items-center gap-0.5 rounded bg-primary/90 px-1.5 py-0.5 font-mono text-[11px] text-primary-foreground shrink-0"
			>
				{name}
				<button
					type="button"
					onclick={() => remove(name)}
					class="ml-0.5 rounded text-primary-foreground/80 hover:bg-primary-foreground/20 hover:text-primary-foreground [&_svg]:pointer-events-none"
					aria-label={`Remove ${name}`}
				>
					<X class="h-3 w-3" />
				</button>
			</span>
		{/each}
	</div>

	<Popover.Root bind:open>
		{#if selected.length === 0}
			<Popover.Trigger
				class="inline-flex shrink-0 items-center gap-0.5 rounded border border-dashed border-border px-1.5 py-0.5 text-[11px] font-mono text-muted-foreground transition-colors hover:bg-muted hover:text-foreground [&_svg]:pointer-events-none"
			>
				<Plus class="h-3 w-3" />
				Add datatype
			</Popover.Trigger>
		{:else}
			<Popover.Trigger
				class="inline-flex shrink-0 items-center justify-center rounded h-5 w-5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors [&_svg]:pointer-events-none"
				title="Add another datatype"
				aria-label="Add another datatype"
			>
				<Plus class="h-3.5 w-3.5" />
			</Popover.Trigger>
		{/if}
		<Popover.Content side="bottom" align="start" class="w-64 p-1">
			<div class="flex flex-col">
				{#each available as opt}
					<button
						type="button"
						onclick={() => add(opt)}
						class="flex items-baseline gap-2 rounded px-2 py-1 text-left text-xs hover:bg-accent hover:text-accent-foreground"
					>
						<span class="font-mono">{opt}</span>
					</button>
				{/each}
				<div class="mt-1 border-t border-border pt-1.5 px-1 pb-0.5">
					<label class="text-[10px] text-muted-foreground" for="datatype-picker-custom">
						Or type a datatype
					</label>
					<div class="flex items-center gap-1 mt-0.5 relative">
						<input
							id="datatype-picker-custom"
							type="text"
							bind:value={customInput}
							onkeydown={onCustomKeydown}
							oninput={() => (suggestionIndex = -1)}
							placeholder="e.g. xsd:gYearMonth, edtf:EDTF"
							autocomplete="off"
							class="flex-1 min-w-0 h-6 px-1.5 text-xs font-mono bg-background border border-input rounded focus:outline-none focus:ring-1 focus:ring-ring"
						/>
						<button
							type="button"
							onclick={() => commitCustom()}
							disabled={!customInput.trim()}
							class="shrink-0 inline-flex items-center justify-center rounded h-6 w-6 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground [&_svg]:pointer-events-none"
							aria-label="Add custom datatype"
							title="Add custom datatype"
						>
							<Plus class="h-3.5 w-3.5" />
						</button>
					</div>
					<!--
						Typeahead suggestion list. Renders inline (not as a
						floater) so it stays inside the popover's bounds and
						bits-ui's collision detection doesn't need to know
						about a second floating layer. Capped at 10 entries
						to keep the popover height manageable.
					-->
					{#if customInput.trim() && suggestions.length > 0}
						<ul class="mt-1 max-h-40 overflow-y-auto rounded border border-border bg-card" role="listbox">
							{#each suggestions as sug, i}
								<li>
									<button
										type="button"
										onmousedown={(e) => { e.preventDefault(); commitCustom(sug); }}
										onmouseenter={() => (suggestionIndex = i)}
										class="block w-full text-left px-2 py-1 text-xs font-mono transition-colors {i === suggestionIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'}"
										role="option"
										aria-selected={i === suggestionIndex}
									>
										{sug}
									</button>
								</li>
							{/each}
						</ul>
					{:else if customInput.trim() && !exactMatch}
						<!--
							No matches in the curated pool — surface a
							single "Use ‹what-you-typed› as custom"
							affordance so the user knows Enter will commit
							the literal value. Hidden when the typed value
							already exactly matches a pool entry (would
							duplicate the highlighted suggestion).
						-->
						<p class="mt-1 px-2 py-1 text-[10px] text-muted-foreground italic">
							Press Enter to add <span class="font-mono not-italic text-foreground">{customInput.trim()}</span> as a custom datatype
						</p>
					{/if}
				</div>
			</div>
		</Popover.Content>
	</Popover.Root>
</div>
