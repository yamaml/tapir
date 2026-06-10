<script lang="ts">
	import type { Description, Flavor, Statement } from '$lib/types';
	import { getFlavorLabels, getEditorStrings } from '$lib/types';
	import {
		displayValueType,
		valueTypeSelectionUpdates,
		type DisplayValueType,
	} from '$lib/utils/editor-cells';
	import { currentProject, simpleDspLang, updateDescription, addStatement, removeStatement, updateStatement, duplicateStatement } from '$lib/stores';
	import { Card, CardContent, CardHeader } from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Select, SelectContent, SelectItem, SelectTrigger } from '$lib/components/ui/select';
	import PropertyAutocomplete from '$lib/components/vocab/property-autocomplete.svelte';
	import * as Popover from '$lib/components/ui/popover';
	import ConstraintEditor from '$lib/components/editor/constraint-editor.svelte';
	import ShapeRefPicker from '$lib/components/editor/shape-ref-picker.svelte';
	import DatatypePicker from '$lib/components/editor/datatype-picker.svelte';
	import Tip from '$lib/components/ui/tip.svelte';
	import FieldLabel from '$lib/components/ui/field-label.svelte';
	import { validateField } from '$lib/utils/validation';
	import type { FieldValidationContext, ValidatableField } from '$lib/utils/validation';
	import FieldError from '$lib/components/editor/field-error.svelte';
	import { reorderStatements } from '$lib/stores';
	import { createDragHandlers } from '$lib/utils/drag-reorder';
	import { statementMatchesQuery } from '$lib/utils/search-match';
	import Copy from 'lucide-svelte/icons/copy';
	import Trash2 from 'lucide-svelte/icons/trash-2';
	import Plus from 'lucide-svelte/icons/plus';
	import GripVertical from 'lucide-svelte/icons/grip-vertical';

	interface Props {
		description: Description;
		flavor: Flavor;
		isFirst?: boolean;
		/** Active search query from the toolbar; empty means no search. */
		searchQuery?: string;
	}

	let { description, flavor, isFirst = false, searchQuery = '' }: Props = $props();

	/** MAIN is a fixed block ID in SimpleDSP — cannot be renamed. */
	let nameReadonly = $derived(isFirst && flavor === 'simpledsp');

	let labels = $derived(getFlavorLabels(flavor, $simpleDspLang));
	let ui = $derived(getEditorStrings(flavor, $simpleDspLang));

	/**
	 * Shared Tailwind class for form field labels. DCTAP column names
	 * are camelCase per the spec (propertyID, valueNodeType, etc.), so
	 * we skip the uppercase transform and render them verbatim. SimpleDSP
	 * uses lowercase words that read better as all-caps headers.
	 */
	let labelClass = $derived(
		flavor === 'dctap'
			? 'text-[10px] font-mono font-medium text-muted-foreground tracking-wider'
			: 'text-[10px] font-medium text-muted-foreground uppercase tracking-wider'
	);

	// ── Drag and drop for statement reorder ──────────────────────
	const drag = createDragHandlers((from, to) => {
		reorderStatements(description.id, from, to);
	});
	let dragOverIndex = $state(-1);

	// Scroll the first statement that matches the active search query
	// into view. Runs whenever the query or the description changes —
	// debounced to microtasks so it doesn't fire mid-keystroke before
	// the DOM has rendered the `data-search-match` attributes.
	$effect(() => {
		const q = searchQuery;
		const descId = description.id;
		if (!q) return;
		queueMicrotask(() => {
			const first = document.querySelector<HTMLElement>(
				`[data-description-id="${descId}"] [data-search-match="true"]`
			);
			if (first) first.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
		});
	});

	/** Track which statement has the constraint popover open. */
	let constraintPopoverStmt = $state<string | null>(null);

	// Description header fields. Declared empty and populated by the
	// $effect below — it runs on mount and whenever the description
	// prop changes, so reading the prop here at init time would only
	// capture a stale initial value (svelte: state_referenced_locally).
	let descName = $state('');
	let descLabel = $state('');
	let descTargetClass = $state('');
	let descIdPrefix = $state('');
	let descNote = $state('');

	// Sync local state when description prop changes
	$effect(() => {
		descName = description.name;
		descLabel = description.label;
		descTargetClass = description.targetClass;
		descIdPrefix = description.idPrefix;
		descNote = description.note;
	});

	/** Get available namespace prefixes for the ID prefix selector. */
	function getAvailablePrefixes(): Array<{ value: string; label: string }> {
		const proj = $currentProject;
		if (!proj?.namespaces) return [];
		return Object.entries(proj.namespaces).map(([pfx, uri]) => ({
			value: pfx,
			label: `${pfx}: (${uri})`,
		}));
	}

	function handleDescUpdate() {
		updateDescription(description.id, {
			name: descName,
			label: descLabel,
			targetClass: descTargetClass,
			idPrefix: descIdPrefix,
			note: descNote,
		});
	}

	// ── Field validation state ───────────────────────────────────
	// Keyed by "fieldName" or "stmtId-fieldName"
	let fieldErrors = $state<Record<string, string | null>>({});

	function buildValidationContext(peerValue?: string): FieldValidationContext {
		const proj = $currentProject;
		return {
			namespaces: proj?.namespaces || {},
			descriptionNames: proj?.descriptions.map(d => d.name) || [],
			peerValue,
			flavor: proj?.flavor ?? 'simpledsp',
		};
	}

	function handleFieldValidation(key: string, field: ValidatableField, value: string, peerValue?: string) {
		const ctx = buildValidationContext(peerValue);
		fieldErrors = { ...fieldErrors, [key]: validateField(field, value, ctx) };
	}

	function isRequired(stmt: Statement): boolean {
		return stmt.min != null && stmt.min >= 1;
	}

	function getCardinalityRange(stmt: Statement): string {
		const min = stmt.min != null ? String(stmt.min) : '0';
		const max = stmt.max != null ? String(stmt.max) : '*';
		return `${min}..${max}`;
	}

	function getValueTypeOptions(): Array<{ value: string; label: string }> {
		const vt = labels.valueTypes;
		const options: Array<{ value: string; label: string }> = [
			{ value: '', label: vt.empty || '(none)' },
			{ value: 'literal', label: vt.literal },
			{ value: 'iri', label: vt.iri },
		];
		if (flavor === 'simpledsp') {
			options.push({ value: 'structured', label: vt.structured });
		}
		if (flavor === 'dctap') {
			options.push({ value: 'bnode', label: vt.bnode });
		}
		return options;
	}

	/** Get all other descriptions for shape reference dropdown. */
	function getAvailableShapeRefs(): Array<{ name: string; label: string }> {
		const proj = $currentProject;
		if (!proj) return [];
		return proj.descriptions
			.filter((d) => d.id !== description.id)
			.map((d) => ({ name: d.name, label: d.label || d.name }));
	}

	/**
	 * Statements where the user picked "structured" but hasn't added a
	 * reference or class constraint yet. `'structured'` is a derived
	 * display type (types/profile.ts) — it is never written into
	 * `valueType` — so this transient flag keeps the selector showing
	 * "structured" and the reference picker visible until the choice
	 * materialises as `shapeRefs`/`classConstraint`.
	 */
	let structuredIntent = $state<Record<string, boolean>>({});

	/** Display value type for the selector (includes derived 'structured'). */
	function displayVT(stmt: Statement): string {
		const dv = displayValueType(stmt);
		if (dv === 'structured') return 'structured';
		return structuredIntent[stmt.id] ? 'structured' : dv;
	}

	/** Whether the statement should show a shape reference selector. */
	function isStructured(stmt: Statement): boolean {
		return displayVT(stmt) === 'structured';
	}

	const DATATYPE_OPTIONS = [
		'xsd:string',
		'xsd:integer',
		'xsd:decimal',
		'xsd:boolean',
		'xsd:date',
		'xsd:dateTime',
		'xsd:time',
		'xsd:gYear',
		'xsd:gYearMonth',
		'xsd:anyURI',
		'xsd:float',
		'xsd:double',
		'xsd:nonNegativeInteger',
		'rdf:langString',
	];

	const CONSTRAINT_TYPES = [
		{ value: "", label: "(none)" },
		{ value: "picklist", label: "picklist" },
		{ value: "IRIstem", label: "IRIstem" },
		{ value: "pattern", label: "pattern" },
		{ value: "languageTag", label: "languageTag" },
		{ value: "minLength", label: "minLength" },
		{ value: "maxLength", label: "maxLength" },
		{ value: "minInclusive", label: "minInclusive" },
		{ value: "maxInclusive", label: "maxInclusive" },
	];

	function handleStmtField(stmtId: string, field: keyof Statement, value: string) {
		if (field === 'valueType') {
			// 'structured' is never stored in valueType — the selection
			// reveals the reference/class inputs (tracked via
			// structuredIntent until a ref exists) and the display is
			// derived from shapeRefs/classConstraint presence.
			const sel = value as DisplayValueType;
			if (sel === 'structured') {
				structuredIntent = { ...structuredIntent, [stmtId]: true };
			} else if (structuredIntent[stmtId]) {
				const next = { ...structuredIntent };
				delete next[stmtId];
				structuredIntent = next;
			}
			updateStatement(description.id, stmtId, valueTypeSelectionUpdates(sel));
		} else {
			updateStatement(description.id, stmtId, { [field]: value });
		}
	}

	function handleAddStatement() {
		addStatement(description.id);
	}

	function handleRemoveStatement(stmtId: string) {
		removeStatement(description.id, stmtId);
	}
</script>

<div class="space-y-4" data-description-id={description.id}>
	<!-- Description header section -->
	<Card>
		<CardHeader class="pb-3 pt-4 px-4">
			<div class="grid gap-3">
				<div class="grid gap-1.5">
					<FieldLabel
						class="text-xs font-medium text-muted-foreground font-mono"
						for="desc-name"
						help={flavor === 'dctap'
							? 'Identifier for this shape — referenced by valueShape on other statements. Must be unique within the profile.'
							: 'Identifier for this description template — referenced by #blockId on other statements. Must be unique within the file.'}
					>
						{flavor === 'dctap' ? 'shapeID' : 'Name'}
						{#if nameReadonly}
							<span class="text-[10px] text-muted-foreground ml-1 font-sans">(fixed per SimpleDSP spec)</span>
						{/if}
					</FieldLabel>
					<Input
						id="desc-name"
						bind:value={descName}
						onblur={handleDescUpdate}
						class="h-8 text-sm {nameReadonly ? 'opacity-60' : ''}"
						placeholder={flavor === 'dctap' ? 'e.g. PersonShape' : 'e.g. Person'}
						readonly={nameReadonly}
					/>
				</div>
				{#if flavor === 'simpledsp'}
					<!-- Target Class and ID Prefix are SimpleDSP concepts from OWL-DSP.
						 DCTAP shapes don't have these: shapeID + shapeLabel are the
						 only identifiers. -->
					<div class="grid gap-1.5">
						<FieldLabel
							class="text-xs font-medium text-muted-foreground"
							help="The RDF class that records of this template instantiate (e.g. foaf:Person). Used by OWL-DSP as dsp:resourceClass."
						>
							Target Class
						</FieldLabel>
						<PropertyAutocomplete
							value={descTargetClass}
							type="C"
							placeholder="e.g. foaf:Person"
							onchange={(val) => { descTargetClass = val; handleDescUpdate(); handleFieldValidation('targetClass', 'targetClass', val); }}
						/>
						<FieldError message={fieldErrors.targetClass} />
					</div>
					<div class="grid gap-1.5">
						<FieldLabel
							class="text-xs font-medium text-muted-foreground"
							help="Prefix used to build record URIs for this template (e.g. ex: makes records ex:person-001). Optional — leave empty to keep records as blank nodes."
						>
							ID Prefix
							<span class="text-[10px] text-muted-foreground ml-1">(record URI namespace)</span>
						</FieldLabel>
						{#if getAvailablePrefixes().length > 0}
							<Select
								type="single"
								value={descIdPrefix}
								onValueChange={(v) => { descIdPrefix = v; handleDescUpdate(); }}
							>
								<SelectTrigger class="h-8 text-sm font-mono">
									{#snippet children()}
										{#if descIdPrefix}
											<span>{descIdPrefix}:</span>
										{:else}
											<span class="text-muted-foreground">None</span>
										{/if}
									{/snippet}
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="" label="None" class="text-xs" />
									{#each getAvailablePrefixes() as pfx}
										<SelectItem value={pfx.value} label={pfx.label} class="text-xs font-mono" />
									{/each}
								</SelectContent>
							</Select>
						{:else}
							<p class="text-[10px] text-muted-foreground italic py-1">
								Add namespaces first
							</p>
						{/if}
					</div>
				{/if}
				{#if flavor === 'dctap'}
					<div class="grid gap-1.5">
						<FieldLabel
							class="text-xs font-medium text-muted-foreground font-mono"
							for="desc-label"
							help="Human-readable label for the shape. Used in generated documentation; not required by the DCTAP spec."
						>
							shapeLabel
						</FieldLabel>
						<Input
							id="desc-label"
							bind:value={descLabel}
							onblur={handleDescUpdate}
							class="h-8 text-sm"
							placeholder="Human-readable label for this shape"
						/>
					</div>
				{/if}
				<div class="grid gap-1.5">
					<FieldLabel
						class="text-xs font-medium text-muted-foreground {flavor === 'dctap' ? 'font-mono' : ''}"
						for="desc-note"
						help="Free-text comment about the shape. Not used by validators; surfaces in generated documentation."
					>
						{flavor === 'dctap' ? 'note' : 'Note'}
					</FieldLabel>
					<textarea
						id="desc-note"
						bind:value={descNote}
						onblur={handleDescUpdate}
						class="flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none"
						placeholder="Description note..."
						rows="2"
					></textarea>
				</div>
			</div>
		</CardHeader>
	</Card>

	<!-- Statement cards -->
	{#each description.statements as stmt, i (stmt.id)}
		{@const isMatch = !!searchQuery && statementMatchesQuery(stmt, searchQuery)}
		{@const isDimmed = !!searchQuery && !isMatch}
		<div
			role="listitem"
			draggable="true"
			ondragstart={(e) => drag.handleDragStart(e, i)}
			ondragover={(e) => { drag.handleDragOver(e, i); dragOverIndex = i; }}
			ondragleave={() => { dragOverIndex = -1; }}
			ondrop={(e) => { drag.handleDrop(e); dragOverIndex = -1; }}
			ondragend={(e) => { drag.handleDragEnd(e); dragOverIndex = -1; }}
			data-search-match={isMatch ? 'true' : undefined}
			class="transition-all {dragOverIndex === i && drag.getDragIndex() !== i
				? 'border-t-2 border-t-primary pt-1'
				: 'border-t-2 border-t-transparent'}"
		>
		<Card class="group relative transition-opacity {isMatch ? 'ring-2 ring-primary/50 ring-offset-1 ring-offset-background' : ''} {isDimmed ? 'opacity-40' : ''}">
			<CardHeader class="pb-2 pt-3 px-4">
				<div class="flex items-start justify-between gap-2">
					<div class="flex items-center gap-2 min-w-0">
						<GripVertical class="h-4 w-4 shrink-0 text-muted-foreground/40 cursor-grab [&]:pointer-events-none" />
						<div class="min-w-0">
							<span class="text-sm font-bold text-foreground block">
								{stmt.label || stmt.propertyId || `${labels.statementSingular} ${i + 1}`}
							</span>
							{#if stmt.propertyId}
								<span class="text-xs text-primary font-mono">{stmt.propertyId}</span>
							{/if}
						</div>
					</div>
					<div class="flex items-center gap-1.5 shrink-0">
						<Badge
							variant={isRequired(stmt) ? 'default' : 'secondary'}
							class="text-[10px] px-1.5 py-0 h-5"
						>
							{isRequired(stmt) ? ui.required : ui.optional}
						</Badge>
						<Badge variant="outline" class="text-[10px] px-1.5 py-0 h-5 font-mono">
							{getCardinalityRange(stmt)}
						</Badge>
						<Tip text="Duplicate statement">
							<Button
								variant="ghost"
								size="icon"
								class="h-6 w-6 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground transition-opacity"
								onclick={() => duplicateStatement(description.id, stmt.id)}
								aria-label="Duplicate statement"
							>
								<Copy class="h-3.5 w-3.5" />
							</Button>
						</Tip>
						<Tip text="Delete statement">
							<Button
								variant="ghost"
								size="icon"
								class="h-6 w-6 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive transition-opacity"
								onclick={() => handleRemoveStatement(stmt.id)}
								aria-label="Delete statement"
							>
								<Trash2 class="h-3.5 w-3.5" />
							</Button>
						</Tip>
					</div>
				</div>
			</CardHeader>
			<CardContent class="px-4 pb-3 pt-0">
				<div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
					<!-- Label/Name — required for SimpleDSP (used for URI), optional for DCTAP -->
					<div class="grid gap-1">
						<FieldLabel
							class={labelClass}
							help={flavor === 'dctap'
								? 'Human-readable label for this statement. Not validated; surfaces in generated documentation.'
								: 'Name for this statement. Required — used to build the statement URI.'}
						>
							{labels.columns.name}
							{#if flavor === 'simpledsp'}
								<span class="text-destructive ml-0.5">*</span>
							{/if}
						</FieldLabel>
						<Input
							value={stmt.label}
							oninput={(e: Event) => handleStmtField(stmt.id, 'label', (e.target as HTMLInputElement).value)}
							onblur={(e: Event) => handleStmtField(stmt.id, 'label', (e.target as HTMLInputElement).value)}
							class="h-7 text-xs"
							placeholder={flavor === 'simpledsp' ? 'e.g. Title (required)' : 'e.g. Title'}
						/>
						{#if flavor === 'simpledsp' && !stmt.label}
							<FieldError message="Name is required (used to build the statement URI)" />
						{/if}
					</div>
					<!-- Property (with autocomplete) — required for both SimpleDSP and DCTAP -->
					<div class="grid gap-1">
						<FieldLabel
							class={labelClass}
							help="The RDF property this statement constrains, written as a prefixed term (e.g. dcterms:title). Type a prefix to auto-suggest from declared vocabularies."
						>
							{labels.columns.property}
							<span class="text-destructive ml-0.5">*</span>
						</FieldLabel>
						<PropertyAutocomplete
							value={stmt.propertyId}
							type="P"
							placeholder={flavor === 'dctap' ? 'e.g. dcterms:title (required)' : 'e.g. dcterms:title (required)'}
							onchange={(val) => { handleStmtField(stmt.id, 'propertyId', val); handleFieldValidation(`${stmt.id}-property`, 'property', val); }}
						/>
						{#if !stmt.propertyId}
							<FieldError message={flavor === 'dctap' ? 'propertyID is required' : 'Property is required'} />
						{:else}
							<FieldError message={fieldErrors[`${stmt.id}-property`]} />
						{/if}
					</div>
					<!-- Value Type -->
					<div class="grid gap-1">
						<FieldLabel
							class={labelClass}
							help={flavor === 'dctap'
								? 'Is the value an IRI, a literal (text/number/date), or a blank node? Determines which constraint fields are valid.'
								: 'Is the value a literal (text/number/date), a reference (IRI), or a structured record? Determines how the Constraint cell is interpreted.'}
						>
							{labels.columns.valueType}
						</FieldLabel>
						<Select
							type="single"
							value={displayVT(stmt)}
							onValueChange={(v: string) => handleStmtField(stmt.id, 'valueType', v)}
						>
							<SelectTrigger class="h-7 text-xs">
								{#snippet children()}
									<span>{getValueTypeOptions().find(o => o.value === displayVT(stmt))?.label || '(none)'}</span>
								{/snippet}
							</SelectTrigger>
							<SelectContent>
								{#each getValueTypeOptions() as opt}
									<SelectItem value={opt.value} label={opt.label} />
								{/each}
							</SelectContent>
						</Select>
					</div>
					<!--
						Datatype (shown when literal). Multi-valued via chip
						picker: SimpleDSP spec §4.6 Table 16 endorses a
						space-separated union of datatypes; the DCMI SRAP
						profile uses the same convention for DCTAP. Custom
						datatypes (e.g. `edtf:EDTF`) are added through the
						picker's free-text affordance.
					-->
					{#if stmt.valueType === 'literal'}
						<div class="grid gap-1">
							<FieldLabel
								class={labelClass}
								help="XSD datatype the literal value must satisfy (e.g. xsd:string, xsd:date). Multiple chips express alternatives — any of them is acceptable."
							>
								{flavor === 'dctap' ? 'valueDataType' : 'Datatype'}
							</FieldLabel>
							<DatatypePicker
								wrap
								selected={stmt.datatype ?? []}
								options={DATATYPE_OPTIONS}
								onchange={(next) => {
									updateStatement(description.id, stmt.id, { datatype: next });
									handleFieldValidation(`${stmt.id}-datatype`, 'datatype', next.join(' '));
								}}
							/>
							<FieldError message={fieldErrors[`${stmt.id}-datatype`]} />
						</div>
					{/if}
					<!-- valueConstraintType — DCTAP shows this BEFORE valueConstraint
						 because the type determines what goes in the constraint cell
						 (DCTAP Primer: "The valueConstraintType defines all of the
						 values in the valueConstraint cell"). -->
					{#if flavor === 'dctap'}
						<div class="grid gap-1">
							<FieldLabel
								class={labelClass}
								help="How to interpret the valueConstraint cell. picklist = pick from a list; pattern = match a regex; IRIstem = URI prefix; languageTag = language tag list; minLength/maxLength/minInclusive/maxInclusive = numeric facets."
							>
								valueConstraintType
							</FieldLabel>
							<Select
								type="single"
								value={stmt.constraintType}
								onValueChange={(v) => updateStatement(description.id, stmt.id, { constraintType: v })}
							>
								<SelectTrigger class="h-7 text-xs">
									{#snippet children()}
										<span>{stmt.constraintType || '(none)'}</span>
									{/snippet}
								</SelectTrigger>
								<SelectContent>
									{#each CONSTRAINT_TYPES as ct}
										<SelectItem value={ct.value} label={ct.label} class="text-xs" />
									{/each}
								</SelectContent>
							</Select>
						</div>
					{/if}
					<!-- Reference picker for SimpleDSP `structured` ValueType.
						 Mirrors the DCTAP valueShape field so users don't have
						 to open the Constraint popover to pick a target.
						 `structured` is a derived display type — never stored
						 in valueType (see utils/editor-cells). -->
					{#if flavor === 'simpledsp' && isStructured(stmt)}
						<div class="grid gap-1">
							<FieldLabel
								class={labelClass}
								help="Reference to another description template in this file (rendered as #blockId). Multiple chips express a union — yama-cli extension over the published spec."
							>
								{ui.shapeReferenceLabel}
							</FieldLabel>
							{#if getAvailableShapeRefs().length > 0}
								<ShapeRefPicker
									wrap
									selected={stmt.shapeRefs ?? []}
									options={getAvailableShapeRefs()}
									onchange={(next) => updateStatement(description.id, stmt.id, { shapeRefs: next })}
									chipPrefix="#"
									placeholder="(none — or use a class constraint below)"
								/>
							{:else}
								<p class="text-[10px] text-muted-foreground italic py-1">Add another description template first, or use the Constraint field below for a class constraint.</p>
							{/if}
						</div>
					{/if}
					<!-- Constraint -->
					<div class="grid gap-1">
						<FieldLabel
							class={labelClass}
							help={flavor === 'dctap'
								? 'Additional restriction on the value, interpreted per valueConstraintType (picklist values, regex pattern, IRI stem, etc.). Empty if no extra constraint applies.'
								: 'Additional restriction on the value. Interpretation depends on the ValueType: datatype for literal, #blockId or class for structured, vocabulary prefix or URI list for reference.'}
						>
							{labels.columns.constraint}
						</FieldLabel>
						<Popover.Root
							open={constraintPopoverStmt === stmt.id}
							onOpenChange={(open) => { constraintPopoverStmt = open ? stmt.id : null; }}
						>
							<Popover.Trigger
								class="flex h-7 w-full items-center rounded-md border border-input bg-background px-2 text-xs font-mono text-left hover:bg-muted/50 transition-colors truncate"
							>
								<!--
									Constraint preview shows what would land in the file's
									Constraint column *that isn't already visible elsewhere
									on the card*. Datatype has its own field above, and for
									SimpleDSP `structured` (derived from refs) the shape
									refs are shown in a dedicated field above, so neither
									is mirrored here — class constraints and the raw
									constraint fallback surface instead.
								-->
								{#if stmt.values?.length > 0}
									{#if flavor === 'dctap'}
										{stmt.values.join(',')}
									{:else}
										{stmt.values.map((v) => `"${v}"`).join(' ')}
									{/if}
								{:else if stmt.inScheme?.length > 0}
									{stmt.inScheme.join(flavor === 'dctap' ? ',' : ' ')}
								{:else if stmt.classConstraint?.length > 0 && flavor === 'simpledsp'}
									{stmt.classConstraint.join(' ')}
								{:else if stmt.pattern}
									/{stmt.pattern}/
								{:else if stmt.constraint}
									{stmt.constraint}
								{:else if flavor === 'dctap' && stmt.facets && (stmt.facets.MinInclusive != null || stmt.facets.MaxInclusive != null || stmt.facets.MinLength != null || stmt.facets.MaxLength != null)}
									{stmt.facets.MinInclusive ?? stmt.facets.MaxInclusive ?? stmt.facets.MinLength ?? stmt.facets.MaxLength}
								{:else}
									<span class="text-muted-foreground">Set constraint…</span>
								{/if}
							</Popover.Trigger>
							<Popover.Content side="bottom" align="start" class="w-72 p-3">
								<ConstraintEditor
									{stmt}
									{description}
									{flavor}
									onclose={() => { constraintPopoverStmt = null; }}
								/>
							</Popover.Content>
						</Popover.Root>
					</div>
					{#if flavor === 'dctap'}
						<!-- valueShape (DCTAP): only valid when valueNodeType is IRI or bnode,
							 per the DCTAP spec (Primer §valueShape). Multi-shape is serialised
							 space-separated, following the DCMI SRAP convention. -->
						{#if stmt.valueType === 'iri' || stmt.valueType === 'bnode'}
							<div class="grid gap-1">
								<FieldLabel
									class={labelClass}
									help="When the value is an IRI or blank node, the shape it must conform to. Multiple chips express alternatives (Person OR Organization) — DCMI SRAP convention."
								>
									valueShape
								</FieldLabel>
								{#if getAvailableShapeRefs().length > 0}
									<ShapeRefPicker
										wrap
										selected={stmt.shapeRefs ?? []}
										options={getAvailableShapeRefs()}
										onchange={(next) => updateStatement(description.id, stmt.id, { shapeRefs: next })}
									/>
								{:else}
									<p class="text-[10px] text-muted-foreground italic py-1">Add another shape first</p>
								{/if}
							</div>
						{/if}
					{/if}
					<!-- Min / mandatory -->
					<div class="grid gap-1">
						<FieldLabel
							class={labelClass}
							help={flavor === 'dctap'
								? 'TRUE if the statement is required (min cardinality ≥ 1); FALSE if optional.'
								: 'Minimum cardinality. 0 = optional, 1 = required, n = at least n values.'}
						>
							{labels.columns.min}
						</FieldLabel>
						{#if flavor === 'dctap'}
							<select
								value={stmt.min != null && stmt.min >= 1 ? 'TRUE' : stmt.min != null ? 'FALSE' : ''}
								onchange={(e: Event) => {
									const v = (e.target as HTMLSelectElement).value;
									if (v === 'TRUE') updateStatement(description.id, stmt.id, { min: 1 });
									else if (v === 'FALSE') updateStatement(description.id, stmt.id, { min: 0 });
									else updateStatement(description.id, stmt.id, { min: undefined }); // cleared → unset
								}}
								class="h-7 text-xs rounded-md border border-input bg-background px-2"
							>
								<option value=""></option>
								<option value="TRUE">TRUE</option>
								<option value="FALSE">FALSE</option>
							</select>
						{:else}
							<Input
								value={stmt.min != null ? String(stmt.min) : ''}
								oninput={(e: Event) => {
									const val = (e.target as HTMLInputElement).value;
									const n = val === '' ? undefined : parseInt(val, 10);
									updateStatement(description.id, stmt.id, { min: n != null && Number.isNaN(n) ? undefined : n });
								}}
								class="h-7 text-xs"
								placeholder="0"
							/>
						{/if}
					</div>
					<!-- Max / repeatable -->
					<div class="grid gap-1">
						<FieldLabel
							class={labelClass}
							help={flavor === 'dctap'
								? 'TRUE if the value can appear multiple times; FALSE if at most one.'
								: 'Maximum cardinality. 1 = at most one, n = up to n, dash (-) = unbounded.'}
						>
							{labels.columns.max}
						</FieldLabel>
						{#if flavor === 'dctap'}
							<!-- Tri-state max: undefined = unset (empty option),
								 null = explicitly unbounded (TRUE), number = explicit.
								 Legacy stored null keeps meaning "unbounded". -->
							<select
								value={stmt.max === undefined ? '' : stmt.max === null || stmt.max > 1 ? 'TRUE' : 'FALSE'}
								onchange={(e: Event) => {
									const v = (e.target as HTMLSelectElement).value;
									if (v === 'TRUE') updateStatement(description.id, stmt.id, { max: null });
									else if (v === 'FALSE') updateStatement(description.id, stmt.id, { max: 1 });
									else updateStatement(description.id, stmt.id, { max: undefined }); // cleared → unset
								}}
								class="h-7 text-xs rounded-md border border-input bg-background px-2"
							>
								<option value=""></option>
								<option value="TRUE">TRUE</option>
								<option value="FALSE">FALSE</option>
							</select>
						{:else}
							<Input
								value={stmt.max != null ? String(stmt.max) : ''}
								oninput={(e: Event) => {
									const val = (e.target as HTMLInputElement).value;
									const n = val === '' ? undefined : parseInt(val, 10);
									updateStatement(description.id, stmt.id, { max: n != null && Number.isNaN(n) ? undefined : n });
								}}
								class="h-7 text-xs"
								placeholder="*"
							/>
						{/if}
					</div>
					<!-- Note -->
					<div class="grid gap-1 col-span-2 sm:col-span-1">
						<FieldLabel
							class={labelClass}
							help="Free-text comment about this statement. Not validated; surfaces in generated documentation and the SimpleDSP Comment column."
						>
							{labels.columns.note}
						</FieldLabel>
						<Input
							value={stmt.note}
							oninput={(e: Event) => handleStmtField(stmt.id, 'note', (e.target as HTMLInputElement).value)}
							onblur={(e: Event) => handleStmtField(stmt.id, 'note', (e.target as HTMLInputElement).value)}
							class="h-7 text-xs"
							placeholder="Optional comment"
						/>
					</div>
				</div>
			</CardContent>
		</Card>
		</div>
	{/each}

	<!-- Add statement button -->
	<Button
		variant="outline"
		class="w-full border-dashed text-sm text-muted-foreground hover:text-foreground"
		onclick={handleAddStatement}
	>
		<Plus class="mr-1.5 h-4 w-4" />
		{labels.addStatement}
	</Button>
</div>
