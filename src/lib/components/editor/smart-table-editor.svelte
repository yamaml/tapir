<script lang="ts">
	import type { Description, Flavor, Statement } from '$lib/types';
	import { getFlavorLabels, getEditorStrings } from '$lib/types';
	import { resolveSimpleDspConstraint } from '$lib/converters/simpledsp-generator';
	import {
		displayValueType,
		displayValueTypes,
		valueTypeSelectionUpdates,
		commitCellEdit,
		type DisplayValueType,
	} from '$lib/utils/editor-cells';
	import {
		buildSmartTableColumns,
		type SmartTableColumn,
	} from '$lib/utils/smart-table-columns';
	import { focusOnMount } from '$lib/utils/focus-on-mount';
	import { addStatement, removeStatement, updateStatement, duplicateStatement, assistanceEnabled, currentProject, simpleDspLang } from '$lib/stores';
	import PropertyAutocomplete from '$lib/components/vocab/property-autocomplete.svelte';
	import { Button } from '$lib/components/ui/button';
	import Plus from 'lucide-svelte/icons/plus';
	import Copy from 'lucide-svelte/icons/copy';
	import Trash2 from 'lucide-svelte/icons/trash-2';

	import * as Popover from '$lib/components/ui/popover';
	import ConstraintEditor from '$lib/components/editor/constraint-editor.svelte';
	import ShapeRefPicker from '$lib/components/editor/shape-ref-picker.svelte';
	import DatatypePicker from '$lib/components/editor/datatype-picker.svelte';
	import ValueTypePicker from '$lib/components/editor/value-type-picker.svelte';
	import Tip from '$lib/components/ui/tip.svelte';

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
	import { statementMatchesQuery } from '$lib/utils/search-match';

	import ToggleLeft from 'lucide-svelte/icons/toggle-left';
	import ToggleRight from 'lucide-svelte/icons/toggle-right';
	import HelpCircle from 'lucide-svelte/icons/circle-help';

	interface Props {
		description: Description;
		flavor: Flavor;
		/** Active search query from the toolbar; empty means no search. */
		searchQuery?: string;
	}

	let { description, flavor, searchQuery = '' }: Props = $props();

	// Scroll the first matching row into view when the query changes.
	// Mirrors customized-editor's behaviour for UX consistency across
	// the three editor modes.
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

	let labels = $derived(getFlavorLabels(flavor, $simpleDspLang));
	let ui = $derived(getEditorStrings(flavor, $simpleDspLang));

	/** Names of all description templates in the project (for shape ref dropdowns). */
	let descriptionNames = $derived(
		($currentProject?.descriptions ?? [])
			.map((d) => d.name)
			.filter((n) => n && n !== description.name)
	);

	/** Shape options with display labels for the ShapeRefPicker. */
	let descriptionOptions = $derived(
		($currentProject?.descriptions ?? [])
			.filter((d) => d.name && d.name !== description.name)
			.map((d) => ({ name: d.name, label: d.label || d.name }))
	);

	// Track which cell is being edited: `row-col` key
	let editingCell = $state<string | null>(null);
	let editValue = $state('');
	/** Cell text at edit start — commit is a no-op when unchanged. */
	let originalValue = $state('');
	// True while we programmatically move the edit to another cell (Tab/Enter
	// navigation). Tearing down the old input fires a trailing `onblur`; without
	// this flag that blur re-runs commitEdit() against the shared editValue that
	// startEdit() has already overwritten with the NEXT cell's value, corrupting
	// the cell we just left. Set during Tab navigation, cleared on a macrotask.
	let suppressBlurCommit = $state(false);

	// Track which row has the constraint popover open
	let constraintPopoverRow = $state<string | null>(null);

	// Column definitions based on flavor; the column model lives in
	// utils/smart-table-columns so it stays pure and unit-testable.
	let columns = $derived(buildSmartTableColumns(flavor, labels, ui));

	function getCellValue(stmt: Statement, col: SmartTableColumn): string {
		if (col.field === 'actions') return '';
		if (col.field === 'min') {
			if (flavor === 'dctap') {
				return stmt.min != null && stmt.min >= 1 ? 'TRUE' : stmt.min != null ? 'FALSE' : '';
			}
			return stmt.min != null ? String(stmt.min) : '';
		}
		if (col.field === 'max') {
			if (flavor === 'dctap') {
				// Tri-state: undefined = unset (empty cell), null =
				// explicitly unbounded (TRUE), number = explicit.
				if (stmt.max === undefined) return '';
				return stmt.max === null || stmt.max > 1 ? 'TRUE' : 'FALSE';
			}
			return stmt.max != null ? String(stmt.max) : '';
		}
		if (col.field === 'valueType') {
			if (flavor === 'dctap') {
				// DCTAP node kinds are space-joined (e.g. "IRI bnode"),
				// matching the native valueNodeType cell.
				const map: Record<string, string> = { literal: 'literal', iri: 'IRI', bnode: 'bnode' };
				return stmt.valueType.map((t) => map[t] ?? t).join(' ');
			}
			// SimpleDSP display value types ('structured' is derived from
			// shapeRefs/classConstraint presence — see utils/editor-cells).
			const labelFor: Record<string, string> = {
				structured: labels.valueTypes.structured,
				iri: labels.valueTypes.iri,
				literal: labels.valueTypes.literal,
				bnode: labels.valueTypes.bnode,
			};
			return displayValueTypes(stmt)
				.map((dv) => labelFor[dv] ?? '')
				.filter(Boolean)
				.join(' ');
		}
		if (col.field === 'constraint') {
			// SimpleDSP: smart-table mirrors the 7 native file columns, so
			// the Constraint cell shows the composed output value (shape
			// ref, class, datatype, inScheme, or picklist) — same as the
			// file format.
			if (flavor === 'simpledsp') {
				return resolveSimpleDspConstraint(stmt);
			}
			// DCTAP: valueDataType and valueShape have their own columns,
			// so the Constraint cell should NOT duplicate them. Only show
			// fields that live in the DCTAP valueConstraint column itself.
			if (stmt.values?.length) return stmt.values.join(',');
			if (stmt.inScheme?.length) return stmt.inScheme.join(',');
			if (stmt.pattern) return stmt.pattern;
			if (stmt.facets) {
				const f = stmt.facets;
				const v = f.MinInclusive ?? f.MaxInclusive ?? f.MinLength ?? f.MaxLength;
				if (v != null) return String(v);
			}
			return stmt.constraint || '';
		}
		if (col.field === 'shapeRefs') {
			return (stmt.shapeRefs ?? []).join(' ');
		}
		if (col.field === 'datatype') {
			return (stmt.datatype ?? []).join(' ');
		}
		const val = stmt[col.field as keyof Statement];
		if (val == null) return '';
		if (typeof val === 'string') return val;
		if (typeof val === 'number') return String(val);
		return '';
	}

	function getValueTypeColor(stmt: Statement): string {
		const dv = displayValueType(stmt, flavor);
		if (dv === 'structured') return 'text-[var(--tapir-structured)]';
		if (dv === 'literal') return 'text-[var(--tapir-literal)]';
		if (dv === 'iri') return 'text-[var(--tapir-iri)]';
		return '';
	}

	/**
	 * Applies a value-type selection from the cell's chip picker. When the
	 * user picks `structured` (SimpleDSP) but the statement has no shape
	 * refs or class constraints yet, the constraint popover opens so they
	 * can pick the target — the same affordance the inline select used.
	 */
	function setCellValueTypes(stmt: Statement, next: DisplayValueType[]) {
		updateStatement(description.id, stmt.id, valueTypeSelectionUpdates(next, flavor));
		const choseStructured = next.length === 1 && next[0] === 'structured';
		if (
			choseStructured &&
			flavor === 'simpledsp' &&
			!(stmt.shapeRefs?.length || stmt.classConstraint?.length)
		) {
			const rowIdx = description.statements.findIndex((s) => s.id === stmt.id);
			if (rowIdx >= 0) constraintPopoverRow = `${rowIdx}`;
		}
	}

	function startEdit(rowIndex: number, colIndex: number, stmt: Statement, col: SmartTableColumn) {
		if (col.field === 'actions') return;
		// In SimpleDSP + assistance, constraint opens a popover instead of inline edit
		if ($assistanceEnabled && col.field === 'constraint' && flavor === 'simpledsp') {
			constraintPopoverRow = constraintPopoverRow === `${rowIndex}` ? null : `${rowIndex}`;
			return;
		}
		const key = `${rowIndex}-${colIndex}`;
		editingCell = key;
		editValue = getCellValue(stmt, col);
		originalValue = editValue;
	}

	function commitEdit(stmt: Statement, col: SmartTableColumn) {
		if (!editingCell || col.field === 'actions') return;

		// All per-field parsing (cardinality flags, localized value
		// types, the composed constraint cells, the unchanged no-op)
		// lives in utils/editor-cells so it stays unit-testable.
		const { updates, openConstraintPopover } = commitCellEdit(
			stmt,
			col.field,
			editValue,
			originalValue,
			flavor
		);

		if (updates) {
			updateStatement(description.id, stmt.id, updates);
		}
		if (openConstraintPopover) {
			// 'structured' with no refs set yet: open the constraint
			// popover so the user can pick the target.
			const rowIdx = description.statements.findIndex((s) => s.id === stmt.id);
			if (rowIdx >= 0) constraintPopoverRow = `${rowIdx}`;
		}

		editingCell = null;
	}

	function handleKeydown(e: KeyboardEvent, stmt: Statement, col: SmartTableColumn, rowIndex: number, colIndex: number) {
		if (e.key === 'Enter' || e.key === 'Escape') {
			if (e.key === 'Enter') commitEdit(stmt, col);
			editingCell = null;
			e.preventDefault();
		} else if (e.key === 'Tab') {
			e.preventDefault();
			// Suppress the trailing blur fired when startEdit() below reassigns
			// editingCell and tears down this input — otherwise that blur
			// re-commits the now-overwritten editValue into this cell.
			suppressBlurCommit = true;
			commitEdit(stmt, col);
			// Move to next editable cell
			let nextCol = colIndex + (e.shiftKey ? -1 : 1);
			let nextRow = rowIndex;
			if (nextCol >= columns.length - 1) { // skip actions col
				nextCol = 0;
				nextRow++;
			} else if (nextCol < 0) {
				nextCol = columns.length - 2;
				nextRow--;
			}
			if (nextRow >= 0 && nextRow < description.statements.length) {
				const nextStmt = description.statements[nextRow];
				const nc = columns[nextCol];
				if (nc.field !== 'actions') {
					startEdit(nextRow, nextCol, nextStmt, nc);
				}
			}
			// Re-enable blur-commit after the focus move + DOM teardown settle.
			setTimeout(() => { suppressBlurCommit = false; }, 0);
		}
	}

	function toggleAssistance() {
		assistanceEnabled.update((v) => !v);
	}

	function handleAddStatement() {
		addStatement(description.id);
	}

	function hasErrors(stmt: Statement): boolean {
		// Only flag errors when the statement has some content but is incomplete
		const hasContent = stmt.propertyId || stmt.label || stmt.datatype.length > 0 || stmt.note;
		if (!hasContent) return false;
		// Property is required when other fields are filled
		return !!(!stmt.propertyId && hasContent);
	}
</script>

<div class="space-y-3" data-description-id={description.id}>
	<!-- Assistance toggle -->
	<div class="flex items-center gap-3 px-1 pb-1">
		<button
			type="button"
			class="flex shrink-0 items-center gap-1.5 text-sm transition-colors"
			onclick={toggleAssistance}
		>
			{#if $assistanceEnabled}
				<ToggleRight class="h-5 w-5 text-primary" />
			{:else}
				<ToggleLeft class="h-5 w-5 text-muted-foreground" />
			{/if}
			<span class="font-medium {$assistanceEnabled ? 'text-foreground' : 'text-muted-foreground'}">{ui.assistance}</span>
		</button>
		<span class="text-xs text-muted-foreground truncate">
			{ui.assistanceHint}
		</span>
	</div>

	<!-- Table -->
	<div class="overflow-x-auto rounded-md border border-border">
		<table class="w-full min-w-[600px] text-sm">
			<thead>
				<tr class="border-b border-border bg-muted/50">
					{#each columns as col}
						<!--
							DCTAP column names are camelCase per the spec
							(propertyID, valueNodeType, valueDataType, etc.),
							so we skip the uppercase transform in DCTAP mode
							and render them in a monospace face, visually
							signalling they're the verbatim spec names.
							SimpleDSP uses lowercase words that read better
							capitalised as table headers.
						-->
						<th class="px-2 py-1.5 text-left text-[10px] font-medium text-muted-foreground tracking-wider {col.width} {flavor === 'dctap' ? 'font-mono' : 'uppercase'}">
							<span class="inline-flex items-baseline gap-1">
								<span>{col.header}</span>
								{#if col.field === 'propertyId'}
									<span class="text-destructive">*</span>
								{:else if col.field === 'label' && flavor === 'simpledsp'}
									<span class="text-destructive">*</span>
								{/if}
								{#if col.help}
									<Tip text={col.help}>
										<button
											type="button"
											class="inline-flex items-center text-muted-foreground/50 hover:text-muted-foreground focus-visible:text-muted-foreground transition-colors [&_svg]:pointer-events-none"
											aria-label="Help"
										>
											<HelpCircle class="h-3 w-3" />
										</button>
									</Tip>
								{/if}
							</span>
						</th>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#each description.statements as stmt, rowIndex (stmt.id)}
					{@const isMatch = !!searchQuery && statementMatchesQuery(stmt, searchQuery)}
					{@const isDimmed = !!searchQuery && !isMatch}
					<tr
						data-search-match={isMatch ? 'true' : undefined}
						class="group border-b border-border last:border-b-0 transition-[background-color,opacity]
							{rowIndex % 2 === 0 ? 'bg-card' : 'bg-background'}
							{hasErrors(stmt) ? 'border-l-2 border-l-destructive' : ''}
							{isMatch ? '!bg-primary/10' : ''}
							{isDimmed ? 'opacity-40' : ''}"
					>
						{#each columns as col, colIndex}
							{#if col.field === 'actions'}
								<td class="px-1 py-1">
									<div class="flex items-center gap-0.5">
										<Tip text="Duplicate statement">
											<Button
												variant="ghost"
												size="icon"
												class="h-6 w-6 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground transition-opacity"
												onclick={() => duplicateStatement(description.id, stmt.id)}
												aria-label="Duplicate statement"
											>
												<Copy class="h-3 w-3" />
											</Button>
										</Tip>
										<Tip text="Delete statement">
											<Button
												variant="ghost"
												size="icon"
												class="h-6 w-6 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive transition-opacity"
												onclick={() => removeStatement(description.id, stmt.id)}
												aria-label="Delete statement"
											>
												<Trash2 class="h-3 w-3" />
											</Button>
										</Tip>
									</div>
								</td>
							{:else if col.field === 'shapeRefs'}
								<!--
									Shape-refs cell is always the chip picker — there's no
									inline text-edit mode because the picker already lets
									the user add/remove refs directly. Same UX as the
									Customized editor.
								-->
								<td class="px-1 py-0.5 align-middle">
									{#if descriptionOptions.length > 0}
										<ShapeRefPicker
											selected={stmt.shapeRefs ?? []}
											options={descriptionOptions}
											onchange={(next) => updateStatement(description.id, stmt.id, { shapeRefs: next })}
										/>
									{:else}
										<span class="text-[10px] text-muted-foreground italic">(add another shape)</span>
									{/if}
								</td>
							{:else if $assistanceEnabled && col.field === 'datatype'}
								<!--
									Datatype cell with assistance on is always the chip picker.
									Mirrors the shapeRefs cell above — same affordance for a
									multi-valued field, with a free-text fallback for custom
									datatypes (edtf:EDTF and similar).
								-->
								<td class="px-1 py-0.5 align-middle">
									<DatatypePicker
										selected={stmt.datatype ?? []}
										options={DATATYPE_OPTIONS}
										onchange={(next) => updateStatement(description.id, stmt.id, { datatype: next })}
									/>
								</td>
							{:else if $assistanceEnabled && col.field === 'valueType'}
								<!--
									Value-type cell with assistance on is always the
									multi-select chip picker — a value may be more than one
									node kind (e.g. DCTAP "IRI BNODE"). Same always-a-picker
									affordance as the shapeRefs/datatype cells.
								-->
								<td class="px-1 py-0.5 align-middle">
									<ValueTypePicker
										dense
										selected={displayValueTypes(stmt, flavor)}
										{flavor}
										lang={$simpleDspLang}
										onchange={(next) => setCellValueTypes(stmt, next)}
									/>
								</td>
							{:else if editingCell === `${rowIndex}-${colIndex}`}
								<td class="px-0.5 py-0.5">
									{#if $assistanceEnabled && col.field === 'propertyId'}
										<!-- Smart: PropertyAutocomplete -->
										<PropertyAutocomplete
											value={editValue}
											placeholder="e.g. dcterms:title"
											type="P"
											class="w-full"
											onchange={(v) => { editValue = v; }}
											onselect={(result) => {
												editValue = result.prefixed;
												commitEdit(stmt, col);
											}}
										/>
									{:else if $assistanceEnabled && col.field === 'min' && flavor === 'dctap'}
										<!-- Smart: mandatory TRUE/FALSE dropdown -->
										<select
											class="w-full h-7 px-1 text-xs bg-background border border-ring rounded focus:outline-none focus:ring-1 focus:ring-ring"
											value={editValue}
											onchange={(e) => {
												editValue = (e.target as HTMLSelectElement).value;
												commitEdit(stmt, col);
											}}
											onblur={() => { if (!suppressBlurCommit) commitEdit(stmt, col); }}
											use:focusOnMount
										>
											<option value="">(empty)</option>
											<option value="TRUE">TRUE</option>
											<option value="FALSE">FALSE</option>
										</select>
									{:else if $assistanceEnabled && col.field === 'max' && flavor === 'dctap'}
										<!-- Smart: repeatable TRUE/FALSE dropdown -->
										<select
											class="w-full h-7 px-1 text-xs bg-background border border-ring rounded focus:outline-none focus:ring-1 focus:ring-ring"
											value={editValue}
											onchange={(e) => {
												editValue = (e.target as HTMLSelectElement).value;
												commitEdit(stmt, col);
											}}
											onblur={() => { if (!suppressBlurCommit) commitEdit(stmt, col); }}
											use:focusOnMount
										>
											<option value="">(empty)</option>
											<option value="TRUE">TRUE</option>
											<option value="FALSE">FALSE</option>
										</select>
									{:else if $assistanceEnabled && col.field === 'constraintType'}
										<!-- Smart: valueConstraintType dropdown (DCTAP) -->
										<select
											class="w-full h-7 px-1 text-xs bg-background border border-ring rounded focus:outline-none focus:ring-1 focus:ring-ring"
											value={editValue}
											onchange={(e) => {
												editValue = (e.target as HTMLSelectElement).value;
												commitEdit(stmt, col);
											}}
											onblur={() => { if (!suppressBlurCommit) commitEdit(stmt, col); }}
											use:focusOnMount
										>
											<option value="">(none)</option>
											<option value="picklist">picklist</option>
											<option value="IRIstem">IRIstem</option>
											<option value="pattern">pattern</option>
											<option value="languageTag">languageTag</option>
											<option value="minLength">minLength</option>
											<option value="maxLength">maxLength</option>
											<option value="minInclusive">minInclusive</option>
											<option value="maxInclusive">maxInclusive</option>
										</select>
									{:else}
										<!-- Default: plain text input -->
										<input
											type="text"
											bind:value={editValue}
											onblur={() => { if (!suppressBlurCommit) commitEdit(stmt, col); }}
											onkeydown={(e: KeyboardEvent) => handleKeydown(e, stmt, col, rowIndex, colIndex)}
											class="w-full h-7 px-1.5 text-xs bg-background border border-ring rounded focus:outline-none focus:ring-1 focus:ring-ring {col.mono ? 'font-mono' : ''}"
											use:focusOnMount
										/>
									{/if}
								</td>
						{:else if $assistanceEnabled && col.field === 'constraint' && flavor === 'simpledsp'}
							<td class="px-0 py-0 relative">
								<Popover.Root
									open={constraintPopoverRow === `${rowIndex}`}
									onOpenChange={(open) => { constraintPopoverRow = open ? `${rowIndex}` : null; }}
								>
									<Popover.Trigger
										class="w-full h-full px-2 py-1.5 text-left text-xs font-mono cursor-pointer hover:bg-muted/50 truncate"
									>
										{getCellValue(stmt, col) || '\u00A0'}
									</Popover.Trigger>
									<Popover.Content side="bottom" align="start" class="w-72 p-3">
										<ConstraintEditor
											{stmt}
											{description}
											{flavor}
											onclose={() => { constraintPopoverRow = null; }}
										/>
									</Popover.Content>
								</Popover.Root>
							</td>
							{:else}
								<td
									class="px-2 py-1.5 cursor-text truncate
										{col.mono ? 'font-mono' : ''}
										{col.field === 'valueType' ? getValueTypeColor(stmt) : ''}
										{col.field === 'propertyId' && !stmt.propertyId ? 'bg-destructive/5 border-l-2 border-l-destructive/40' : ''}
										{col.field === 'label' && flavor === 'simpledsp' && !stmt.label ? 'bg-destructive/5 border-l-2 border-l-destructive/40' : ''}"
									onclick={() => startEdit(rowIndex, colIndex, stmt, col)}
									role="gridcell"
									tabindex="0"
									onkeydown={(e: KeyboardEvent) => {
										if (e.key === 'Enter' || e.key === 'F2') {
											startEdit(rowIndex, colIndex, stmt, col);
											e.preventDefault();
										}
									}}
								>
									<span class="text-xs">{getCellValue(stmt, col) || '\u00A0'}</span>
								</td>
							{/if}
						{/each}
					</tr>
				{/each}
				<!-- Add row -->
				<tr class="border-t border-dashed border-border">
					<td colspan={columns.length} class="px-2 py-1">
						<button
							type="button"
							class="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors w-full py-1"
							onclick={handleAddStatement}
						>
							<Plus class="h-3 w-3" />
							{labels.addStatement}
						</button>
					</td>
				</tr>
			</tbody>
		</table>
	</div>

	{#if description.statements.length === 0}
		<div class="flex items-center justify-center py-8">
			<p class="text-sm text-muted-foreground">
				{ui.noStatementsYet}
			</p>
		</div>
	{/if}
</div>
