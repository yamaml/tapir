<script lang="ts">
	import type { Description, Flavor, Statement } from '$lib/types';
	import { getFlavorLabels } from '$lib/types';
	import { updateStatement, currentProject, simpleDspLang } from '$lib/stores';
	import { ScrollArea } from '$lib/components/ui/scroll-area';

	interface Props {
		stmt: Statement;
		description: Description;
		flavor: Flavor;
		onclose: () => void;
	}

	let { stmt, description, flavor, onclose }: Props = $props();

	let labels = $derived(getFlavorLabels(flavor, $simpleDspLang));

	/** Other description names for shape ref options. */
	let descriptionNames = $derived(
		($currentProject?.descriptions ?? [])
			.map((d) => d.name)
			.filter((n) => n && n !== description.name)
	);

	/** Project namespace prefixes (for IRI vocab stem options). */
	let projectPrefixes = $derived(
		Object.keys($currentProject?.namespaces ?? {})
	);

	/** Detect which constraint "mode" is active. */
	let constraintMode = $derived.by((): string => {
		if (stmt.shapeRefs && stmt.shapeRefs.length > 0) return 'shape';
		if (stmt.classConstraint?.length > 0) return 'class';
		if (stmt.values?.length > 0) return 'picklist';
		if (stmt.inScheme?.length > 0) return 'vocab';
		if (stmt.datatype) return 'datatype';
		if (stmt.constraint) return 'other';
		return 'none';
	});

	// ── Common XSD datatypes ────────────────────────────────────────
	const COMMON_DATATYPES = [
		'xsd:string',
		'xsd:integer',
		'xsd:decimal',
		'xsd:boolean',
		'xsd:date',
		'xsd:dateTime',
		'xsd:time',
		'xsd:gYear',
		'xsd:anyURI',
		'xsd:float',
		'xsd:double',
		'xsd:nonNegativeInteger',
		'rdf:langString',
	];

	// ── Free-text input for direct editing ──────────────────────────
	let freeText = $state('');

	function initFreeText() {
		if (stmt.shapeRefs && stmt.shapeRefs.length > 0) {
			freeText = stmt.shapeRefs.map((r) => `#${r}`).join(' ');
		} else if (stmt.datatype && flavor === 'simpledsp') freeText = stmt.datatype;
		else if (stmt.values?.length > 0) freeText = stmt.values.map((v) => `"${v}"`).join(' ');
		else if (stmt.inScheme?.length > 0) freeText = stmt.inScheme.join(' ');
		else freeText = stmt.constraint || '';
	}

	// ── Actions ─────────────────────────────────────────────────────

	function selectDatatype(dt: string) {
		updateStatement(description.id, stmt.id, {
			datatype: dt,
			constraint: '',
			values: [],
			shapeRefs: [],
		});
		onclose();
	}

	function toggleShapeRef(name: string) {
		const current = stmt.shapeRefs ?? [];
		const next = current.includes(name)
			? current.filter((r) => r !== name)
			: [...current, name];
		updateStatement(description.id, stmt.id, {
			shapeRefs: next,
			constraint: '',
			datatype: '',
			classConstraint: [],
		});
	}

	function selectVocabStem(prefix: string) {
		const current = stmt.inScheme || [];
		const stem = `${prefix}:`;
		if (current.includes(stem)) return;
		updateStatement(description.id, stmt.id, {
			inScheme: [...current, stem],
			constraint: '',
		});
	}

	function removeVocabStem(stem: string) {
		const updated = (stmt.inScheme || []).filter((s) => s !== stem);
		updateStatement(description.id, stmt.id, { inScheme: updated });
	}

	function commitFreeText() {
		const val = freeText.trim();
		if (stmt.valueType === 'literal') {
			const quoted = val.match(/"([^"]*)"/g);
			if (quoted) {
				updateStatement(description.id, stmt.id, {
					values: quoted.map((q) => q.slice(1, -1)),
					datatype: '',
					constraint: '',
				});
			} else if (val) {
				updateStatement(description.id, stmt.id, {
					datatype: val,
					values: [],
					constraint: '',
				});
			} else {
				updateStatement(description.id, stmt.id, {
					datatype: '',
					values: [],
					constraint: '',
				});
			}
		} else if (val.startsWith('#')) {
			// Allow multi-shape in free-text too: "#A #B" → ['A', 'B'].
			const refs = val
				.split(/\s+/)
				.filter((s) => s.startsWith('#'))
				.map((s) => s.slice(1))
				.filter(Boolean);
			updateStatement(description.id, stmt.id, {
				shapeRefs: refs,
				constraint: '',
			});
		} else {
			updateStatement(description.id, stmt.id, { constraint: val });
		}
		onclose();
	}

	function clearConstraint() {
		updateStatement(description.id, stmt.id, {
			datatype: '',
			constraint: '',
			values: [],
			shapeRefs: [],
			inScheme: [],
			classConstraint: [],
			pattern: '',
			facets: {},
			constraintType: '',
		});
		onclose();
	}

	// ── DCTAP valueConstraint editor state ──────────────────────────

	/** Comma-separated value for picklist / languageTag / IRIstem edits. */
	let dctapText = $state('');
	/** Numeric facet value for minLength/maxLength/minInclusive/maxInclusive. */
	let dctapFacet = $state('');

	function initDctapFields() {
		const t = (stmt.constraintType || '').toLowerCase();
		if (t === 'picklist' || t === 'languagetag') {
			dctapText = (stmt.values ?? []).join(',');
		} else if (t === 'iristem') {
			dctapText = (stmt.inScheme?.length ? stmt.inScheme : stmt.values ?? []).join(',');
		} else if (t === 'pattern') {
			dctapText = stmt.pattern || '';
		} else if (t === 'mininclusive') {
			dctapFacet = stmt.facets?.MinInclusive != null ? String(stmt.facets.MinInclusive) : '';
		} else if (t === 'maxinclusive') {
			dctapFacet = stmt.facets?.MaxInclusive != null ? String(stmt.facets.MaxInclusive) : '';
		} else if (t === 'minlength') {
			dctapFacet = stmt.facets?.MinLength != null ? String(stmt.facets.MinLength) : '';
		} else if (t === 'maxlength') {
			dctapFacet = stmt.facets?.MaxLength != null ? String(stmt.facets.MaxLength) : '';
		} else {
			dctapText = stmt.constraint || '';
		}
	}

	$effect(() => {
		// Re-sync local inputs whenever the statement or type changes.
		if (flavor === 'dctap') initDctapFields();
	});

	function commitDctapText() {
		const parts = dctapText.split(',').map((s) => s.trim()).filter(Boolean);
		const t = (stmt.constraintType || '').toLowerCase();
		if (t === 'picklist') {
			updateStatement(description.id, stmt.id, {
				values: parts,
				inScheme: [],
				pattern: '',
				facets: {},
				constraintType: 'picklist',
			});
		} else if (t === 'languagetag') {
			updateStatement(description.id, stmt.id, {
				values: parts,
				inScheme: [],
				pattern: '',
				facets: {},
				constraintType: 'languageTag',
			});
		} else if (t === 'iristem') {
			updateStatement(description.id, stmt.id, {
				inScheme: parts,
				values: [],
				pattern: '',
				facets: {},
				constraintType: 'IRIstem',
			});
		} else if (t === 'pattern') {
			updateStatement(description.id, stmt.id, {
				pattern: dctapText.trim(),
				values: [],
				inScheme: [],
				facets: {},
				constraintType: 'pattern',
			});
		} else {
			updateStatement(description.id, stmt.id, { constraint: dctapText.trim() });
		}
		onclose();
	}

	function commitDctapFacet() {
		const n = Number(dctapFacet);
		if (Number.isNaN(n)) return;
		const t = (stmt.constraintType || '').toLowerCase();
		const facetKey = t === 'mininclusive' ? 'MinInclusive'
			: t === 'maxinclusive' ? 'MaxInclusive'
			: t === 'minlength' ? 'MinLength'
			: t === 'maxlength' ? 'MaxLength'
			: null;
		if (!facetKey) return;
		const camel = t === 'mininclusive' ? 'minInclusive'
			: t === 'maxinclusive' ? 'maxInclusive'
			: t === 'minlength' ? 'minLength'
			: 'maxLength';
		updateStatement(description.id, stmt.id, {
			facets: { [facetKey]: n },
			values: [],
			inScheme: [],
			pattern: '',
			constraintType: camel,
		});
		onclose();
	}
</script>

<div class="space-y-2 text-xs">
	{#if flavor === 'dctap'}
		{@const t = (stmt.constraintType || '').toLowerCase()}
		{#if !t}
			<p class="text-muted-foreground italic py-2">
				Pick a <span class="font-mono">valueConstraintType</span> first, then enter the constraint here.
			</p>
		{:else if t === 'picklist' || t === 'languagetag'}
			<div class="space-y-1.5">
				<p class="font-medium text-muted-foreground uppercase tracking-wider text-[10px]">
					{t === 'picklist' ? 'Picklist values' : 'Language tags'}
				</p>
				<p class="text-[10px] text-muted-foreground">
					{t === 'picklist'
						? 'Comma-separated list of allowed values (e.g. History,Science,Art).'
						: 'Comma-separated BCP 47 tags (e.g. en,fr,zh-Hans).'}
				</p>
				<div class="flex gap-1">
					<input
						type="text"
						bind:value={dctapText}
						onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter') commitDctapText(); }}
						placeholder={t === 'picklist' ? 'red,green,blue' : 'en,fr,ja'}
						class="flex-1 h-6 px-1.5 text-[11px] font-mono bg-background border border-input rounded focus:outline-none focus:ring-1 focus:ring-ring"
					/>
					<button
						type="button"
						class="px-2 h-6 text-[11px] rounded bg-primary text-primary-foreground hover:bg-primary/90"
						onclick={commitDctapText}
					>Set</button>
				</div>
			</div>
		{:else if t === 'iristem'}
			<div class="space-y-1.5">
				<p class="font-medium text-muted-foreground uppercase tracking-wider text-[10px]">IRI stems</p>
				<p class="text-[10px] text-muted-foreground">
					Comma-separated base IRIs; values must start with one of them.
				</p>
				<div class="flex gap-1">
					<input
						type="text"
						bind:value={dctapText}
						onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter') commitDctapText(); }}
						placeholder="https://id.loc.gov/authorities/subjects/"
						class="flex-1 h-6 px-1.5 text-[11px] font-mono bg-background border border-input rounded focus:outline-none focus:ring-1 focus:ring-ring"
					/>
					<button
						type="button"
						class="px-2 h-6 text-[11px] rounded bg-primary text-primary-foreground hover:bg-primary/90"
						onclick={commitDctapText}
					>Set</button>
				</div>
			</div>
		{:else if t === 'pattern'}
			<div class="space-y-1.5">
				<p class="font-medium text-muted-foreground uppercase tracking-wider text-[10px]">Pattern</p>
				<p class="text-[10px] text-muted-foreground">
					XML-style regular expression.
				</p>
				<div class="flex gap-1">
					<input
						type="text"
						bind:value={dctapText}
						onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter') commitDctapText(); }}
						placeholder="^[0-9]{4}$"
						class="flex-1 h-6 px-1.5 text-[11px] font-mono bg-background border border-input rounded focus:outline-none focus:ring-1 focus:ring-ring"
					/>
					<button
						type="button"
						class="px-2 h-6 text-[11px] rounded bg-primary text-primary-foreground hover:bg-primary/90"
						onclick={commitDctapText}
					>Set</button>
				</div>
			</div>
		{:else if t === 'mininclusive' || t === 'maxinclusive' || t === 'minlength' || t === 'maxlength'}
			<div class="space-y-1.5">
				<p class="font-medium text-muted-foreground uppercase tracking-wider text-[10px]">
					{stmt.constraintType}
				</p>
				<p class="text-[10px] text-muted-foreground">
					{t.startsWith('min') || t.startsWith('max') && t.endsWith('length')
						? 'Non-negative integer.'
						: 'Numeric bound (inclusive).'}
				</p>
				<div class="flex gap-1">
					<input
						type="number"
						bind:value={dctapFacet}
						onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter') commitDctapFacet(); }}
						class="flex-1 h-6 px-1.5 text-[11px] font-mono bg-background border border-input rounded focus:outline-none focus:ring-1 focus:ring-ring"
					/>
					<button
						type="button"
						class="px-2 h-6 text-[11px] rounded bg-primary text-primary-foreground hover:bg-primary/90"
						onclick={commitDctapFacet}
					>Set</button>
				</div>
			</div>
		{:else}
			<!-- DCTAP extension type (open vocabulary) — free text. -->
			<div class="space-y-1.5">
				<p class="font-medium text-muted-foreground uppercase tracking-wider text-[10px]">
					{stmt.constraintType}
				</p>
				<p class="text-[10px] text-muted-foreground">
					Custom DCTAP constraint type — value is passed through verbatim.
				</p>
				<div class="flex gap-1">
					<input
						type="text"
						bind:value={dctapText}
						onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter') commitDctapText(); }}
						class="flex-1 h-6 px-1.5 text-[11px] font-mono bg-background border border-input rounded focus:outline-none focus:ring-1 focus:ring-ring"
					/>
					<button
						type="button"
						class="px-2 h-6 text-[11px] rounded bg-primary text-primary-foreground hover:bg-primary/90"
						onclick={commitDctapText}
					>Set</button>
				</div>
			</div>
		{/if}
	{:else if !stmt.valueType && (!stmt.shapeRefs || stmt.shapeRefs.length === 0) && stmt.classConstraint?.length === 0}
		<p class="text-muted-foreground italic py-2">Set a ValueType first to configure constraints.</p>

	{:else if stmt.valueType === 'literal'}
		<!-- Literal constraints: datatype picker + picklist input -->
		<div class="space-y-1.5">
			<p class="font-medium text-muted-foreground uppercase tracking-wider text-[10px]">Datatype</p>
			<ScrollArea class="max-h-[140px]">
				<div class="grid grid-cols-2 gap-0.5">
					{#each COMMON_DATATYPES as dt}
						<button
							type="button"
							class="px-2 py-1 text-left rounded font-mono text-[11px] transition-colors
								{stmt.datatype === dt
									? 'bg-primary text-primary-foreground'
									: 'hover:bg-muted'}"
							onclick={() => selectDatatype(dt)}
						>
							{dt}
						</button>
					{/each}
				</div>
			</ScrollArea>

			<div class="border-t border-border pt-1.5">
				<p class="font-medium text-muted-foreground uppercase tracking-wider text-[10px] mb-1">
					Picklist / custom datatype
				</p>
				<div class="flex gap-1">
					<input
						type="text"
						bind:value={freeText}
						onfocus={initFreeText}
						onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter') commitFreeText(); }}
						placeholder={'"val1" "val2" or xsd:type'}
						class="flex-1 h-6 px-1.5 text-[11px] font-mono bg-background border border-input rounded focus:outline-none focus:ring-1 focus:ring-ring"
					/>
					<button
						type="button"
						class="px-2 h-6 text-[11px] rounded bg-primary text-primary-foreground hover:bg-primary/90"
						onclick={commitFreeText}
					>Set</button>
				</div>
			</div>
		</div>

	{:else if stmt.valueType === 'iri' || (stmt.valueType as string) === 'structured' || (stmt.shapeRefs && stmt.shapeRefs.length > 0) || stmt.classConstraint?.length > 0}
		<!-- IRI / Structured constraints: shape refs (multi-select), vocab stems, URI list -->
		<div class="space-y-1.5">
			{#if descriptionNames.length > 0}
				<div>
					<p class="font-medium text-muted-foreground uppercase tracking-wider text-[10px] mb-1">Shape references (click to toggle)</p>
					<ScrollArea class="max-h-[90px]">
						<div class="space-y-0.5">
							{#each descriptionNames as name}
								<button
									type="button"
									class="w-full px-2 py-1 text-left rounded text-[11px] transition-colors
										{(stmt.shapeRefs ?? []).includes(name)
											? 'bg-primary text-primary-foreground'
											: 'hover:bg-muted'}"
									onclick={() => toggleShapeRef(name)}
								>
									#{name}
								</button>
							{/each}
						</div>
					</ScrollArea>
				</div>
			{/if}

			{#if stmt.valueType === 'iri'}
				<div class="border-t border-border pt-1.5">
					<p class="font-medium text-muted-foreground uppercase tracking-wider text-[10px] mb-1">Vocabulary stem</p>
					{#if (stmt.inScheme?.length ?? 0) > 0}
						<div class="flex flex-wrap gap-1 mb-1.5">
							{#each stmt.inScheme as stem}
								<span class="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-muted font-mono text-[11px]">
									{stem}
									<button
										type="button"
										class="text-muted-foreground hover:text-destructive ml-0.5"
										onclick={() => removeVocabStem(stem)}
									>&times;</button>
								</span>
							{/each}
						</div>
					{/if}
					{#if projectPrefixes.length > 0}
						<div class="flex flex-wrap gap-0.5">
							{#each projectPrefixes as prefix}
								{@const stem = `${prefix}:`}
								{#if !(stmt.inScheme ?? []).includes(stem)}
									<button
										type="button"
										class="px-1.5 py-0.5 rounded text-[11px] font-mono hover:bg-muted transition-colors"
										onclick={() => selectVocabStem(prefix)}
									>
										+{prefix}:
									</button>
								{/if}
							{/each}
						</div>
					{/if}
				</div>

				<div class="border-t border-border pt-1.5">
					<p class="font-medium text-muted-foreground uppercase tracking-wider text-[10px] mb-1">URI list</p>
					<div class="flex gap-1">
						<input
							type="text"
							bind:value={freeText}
							onfocus={initFreeText}
							onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter') commitFreeText(); }}
							placeholder="prefix:term prefix:term"
							class="flex-1 h-6 px-1.5 text-[11px] font-mono bg-background border border-input rounded focus:outline-none focus:ring-1 focus:ring-ring"
						/>
						<button
							type="button"
							class="px-2 h-6 text-[11px] rounded bg-primary text-primary-foreground hover:bg-primary/90"
							onclick={commitFreeText}
						>Set</button>
					</div>
				</div>
			{/if}
		</div>

	{:else}
		<!-- Fallback: free text -->
		<div class="flex gap-1">
			<input
				type="text"
				bind:value={freeText}
				onfocus={initFreeText}
				onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter') commitFreeText(); }}
				placeholder="constraint"
				class="flex-1 h-6 px-1.5 text-[11px] font-mono bg-background border border-input rounded focus:outline-none focus:ring-1 focus:ring-ring"
			/>
			<button
				type="button"
				class="px-2 h-6 text-[11px] rounded bg-primary text-primary-foreground hover:bg-primary/90"
				onclick={commitFreeText}
			>Set</button>
		</div>
	{/if}

	{#if constraintMode !== 'none'}
		<div class="border-t border-border pt-1">
			<button
				type="button"
				class="text-[10px] text-muted-foreground hover:text-destructive transition-colors"
				onclick={clearConstraint}
			>
				Clear constraint
			</button>
		</div>
	{/if}
</div>
