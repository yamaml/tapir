<script lang="ts">
	import type { Description, Flavor, Statement, ValueType } from '$lib/types';
	import { getFlavorLabels } from '$lib/types';
	import { resolveSimpleDspConstraint } from '$lib/converters/simpledsp-generator';
	import { addStatement, removeStatement, updateStatement, duplicateStatement, assistanceEnabled, currentProject, simpleDspLang } from '$lib/stores';
	import PropertyAutocomplete from '$lib/components/vocab/property-autocomplete.svelte';
	import { Button } from '$lib/components/ui/button';
	import Plus from 'lucide-svelte/icons/plus';
	import Copy from 'lucide-svelte/icons/copy';
	import Trash2 from 'lucide-svelte/icons/trash-2';

	import * as Popover from '$lib/components/ui/popover';
	import ConstraintEditor from '$lib/components/editor/constraint-editor.svelte';
	import ShapeRefPicker from '$lib/components/editor/shape-ref-picker.svelte';

	import ToggleLeft from 'lucide-svelte/icons/toggle-left';
	import ToggleRight from 'lucide-svelte/icons/toggle-right';

	interface Props {
		description: Description;
		flavor: Flavor;
	}

	let { description, flavor }: Props = $props();

	let labels = $derived(getFlavorLabels(flavor, $simpleDspLang));

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

	// Track which row has the constraint popover open
	let constraintPopoverRow = $state<string | null>(null);

	// Column definitions based on flavor
	interface ColumnDef {
		key: string;
		header: string;
		/**
		 * The Statement property this column reads/writes. `shapeRefs` is
		 * displayed as space-separated in the cell and parsed back the
		 * same way. `actions` is the row's delete/duplicate buttons.
		 */
		field: keyof Statement | 'actions';
		width: string;
		mono?: boolean;
	}

	let columns = $derived.by((): ColumnDef[] => {
		if (flavor === 'dctap') {
			return [
				{ key: 'propertyID', header: labels.columns.property, field: 'propertyId', width: 'w-[120px]', mono: true },
				{ key: 'propertyLabel', header: labels.columns.name, field: 'label', width: 'w-[110px]' },
				{ key: 'mandatory', header: labels.columns.min, field: 'min', width: 'w-[70px]' },
				{ key: 'repeatable', header: labels.columns.max, field: 'max', width: 'w-[70px]' },
				{ key: 'valueNodeType', header: labels.columns.valueType, field: 'valueType', width: 'w-[90px]' },
				{ key: 'valueDataType', header: 'valueDataType', field: 'datatype', width: 'w-[100px]', mono: true },
				{ key: 'constraintType', header: 'valueConstraintType', field: 'constraintType', width: 'w-[110px]' },
				{ key: 'valueConstraint', header: labels.columns.constraint, field: 'constraint', width: 'w-[110px]' },
				{ key: 'valueShape', header: 'valueShape', field: 'shapeRefs', width: 'w-[100px]' },
				{ key: 'note', header: labels.columns.note, field: 'note', width: 'w-[120px]' },
				{ key: 'actions', header: '', field: 'actions', width: 'w-[40px]' },
			];
		}
		// SimpleDSP
		return [
			{ key: 'name', header: labels.columns.name, field: 'label', width: 'w-[120px]' },
			{ key: 'property', header: labels.columns.property, field: 'propertyId', width: 'w-[130px]', mono: true },
			{ key: 'min', header: labels.columns.min, field: 'min', width: 'w-[55px]' },
			{ key: 'max', header: labels.columns.max, field: 'max', width: 'w-[55px]' },
			{ key: 'valueType', header: labels.columns.valueType, field: 'valueType', width: 'w-[90px]' },
			{ key: 'constraint', header: labels.columns.constraint, field: 'constraint', width: 'w-[130px]', mono: true },
			{ key: 'note', header: labels.columns.note, field: 'note', width: 'w-[140px]' },
			{ key: 'actions', header: '', field: 'actions', width: 'w-[40px]' },
		];
	});

	function getCellValue(stmt: Statement, col: ColumnDef): string {
		if (col.field === 'actions') return '';
		if (col.field === 'min') {
			if (flavor === 'dctap') {
				return stmt.min != null && stmt.min >= 1 ? 'TRUE' : stmt.min != null ? 'FALSE' : '';
			}
			return stmt.min != null ? String(stmt.min) : '';
		}
		if (col.field === 'max') {
			if (flavor === 'dctap') {
				if (stmt.min == null && stmt.max == null) return '';
				return stmt.max == null ? 'TRUE' : stmt.max > 1 ? 'TRUE' : 'FALSE';
			}
			return stmt.max != null ? String(stmt.max) : '';
		}
		if (col.field === 'valueType') {
			if (flavor === 'dctap') {
				const map: Record<string, string> = { literal: 'literal', iri: 'IRI', bnode: 'bnode' };
				return map[stmt.valueType] || '';
			}
			// SimpleDSP display value types
			if (stmt.shapeRefs && stmt.shapeRefs.length > 0) return labels.valueTypes.structured;
			if (stmt.classConstraint.length > 0) return labels.valueTypes.structured;
			if (stmt.valueType === 'iri') return labels.valueTypes.iri;
			if (stmt.valueType === 'literal') return labels.valueTypes.literal;
			return '';
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
		const val = stmt[col.field as keyof Statement];
		if (val == null) return '';
		if (typeof val === 'string') return val;
		if (typeof val === 'number') return String(val);
		return '';
	}

	function getValueTypeColor(stmt: Statement): string {
		if ((stmt.shapeRefs && stmt.shapeRefs.length > 0) || stmt.classConstraint.length > 0) return 'text-[var(--tapir-structured)]';
		if (stmt.valueType === 'literal') return 'text-[var(--tapir-literal)]';
		if (stmt.valueType === 'iri') return 'text-[var(--tapir-iri)]';
		return '';
	}

	function startEdit(rowIndex: number, colIndex: number, stmt: Statement, col: ColumnDef) {
		if (col.field === 'actions') return;
		// In SimpleDSP + assistance, constraint opens a popover instead of inline edit
		if ($assistanceEnabled && col.field === 'constraint' && flavor === 'simpledsp') {
			constraintPopoverRow = constraintPopoverRow === `${rowIndex}` ? null : `${rowIndex}`;
			return;
		}
		const key = `${rowIndex}-${colIndex}`;
		editingCell = key;
		editValue = getCellValue(stmt, col);
	}

	function commitEdit(stmt: Statement, col: ColumnDef) {
		if (!editingCell || col.field === 'actions') return;

		const val = editValue;

		if (col.field === 'min') {
			if (flavor === 'dctap') {
				const upper = val.toUpperCase();
				if (upper === 'TRUE') {
					updateStatement(description.id, stmt.id, { min: 1 });
				} else if (upper === 'FALSE') {
					updateStatement(description.id, stmt.id, { min: 0 });
				} else {
					updateStatement(description.id, stmt.id, { min: null });
				}
			} else {
				const n = val === '' ? null : parseInt(val, 10);
				updateStatement(description.id, stmt.id, { min: Number.isNaN(n) ? null : n });
			}
		} else if (col.field === 'max') {
			if (flavor === 'dctap') {
				const upper = val.toUpperCase();
				if (upper === 'TRUE') {
					updateStatement(description.id, stmt.id, { max: null });
				} else if (upper === 'FALSE') {
					updateStatement(description.id, stmt.id, { max: 1 });
				} else {
					updateStatement(description.id, stmt.id, { max: null });
				}
			} else {
				const n = val === '' ? null : parseInt(val, 10);
				updateStatement(description.id, stmt.id, { max: Number.isNaN(n) ? null : n });
			}
		} else if (col.field === 'valueType') {
			// Map display strings back to internal values
			const reverseMap: Record<string, ValueType> = {
				literal: 'literal',
				iri: 'iri',
				IRI: 'iri',
				bnode: 'bnode',
			};
			// Also check flavor labels
			const revFlavorMap: Record<string, ValueType> = {};
			revFlavorMap[labels.valueTypes.literal] = 'literal';
			revFlavorMap[labels.valueTypes.iri] = 'iri';
			revFlavorMap[labels.valueTypes.bnode] = 'bnode';
			const mapped = reverseMap[val] || revFlavorMap[val] || ('' as ValueType);
			updateStatement(description.id, stmt.id, { valueType: mapped });
		} else if (col.field === 'constraint') {
			if (val.startsWith('#')) {
				// Support single or space-separated multi-ref: "#A #B"
				const refs = val
					.split(/\s+/)
					.filter((s) => s.startsWith('#'))
					.map((s) => s.slice(1))
					.filter(Boolean);
				updateStatement(description.id, stmt.id, { shapeRefs: refs, constraint: '' });
			} else {
				if (flavor === 'simpledsp' && !val.startsWith('#') && stmt.valueType === 'literal') {
					updateStatement(description.id, stmt.id, { datatype: val, constraint: '' });
				} else {
					updateStatement(description.id, stmt.id, { constraint: val });
				}
			}
		} else {
			updateStatement(description.id, stmt.id, { [col.field]: val });
		}

		editingCell = null;
	}

	function handleKeydown(e: KeyboardEvent, stmt: Statement, col: ColumnDef, rowIndex: number, colIndex: number) {
		if (e.key === 'Enter' || e.key === 'Escape') {
			if (e.key === 'Enter') commitEdit(stmt, col);
			editingCell = null;
			e.preventDefault();
		} else if (e.key === 'Tab') {
			commitEdit(stmt, col);
			e.preventDefault();
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
		const hasContent = stmt.propertyId || stmt.label || stmt.datatype || stmt.note;
		if (!hasContent) return false;
		// Property is required when other fields are filled
		return !!(!stmt.propertyId && hasContent);
	}
</script>

<div class="space-y-3">
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
			<span class="font-medium {$assistanceEnabled ? 'text-foreground' : 'text-muted-foreground'}">Assistance</span>
		</button>
		<span class="text-xs text-muted-foreground truncate">
			Auto-suggestions &middot; vocabulary lookup &middot; constraint validation
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
							{col.header}
							{#if col.field === 'propertyId'}
								<span class="text-destructive">*</span>
							{:else if col.field === 'label' && flavor === 'simpledsp'}
								<span class="text-destructive">*</span>
							{/if}
						</th>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#each description.statements as stmt, rowIndex (stmt.id)}
					<tr
						class="group border-b border-border last:border-b-0 transition-colors
							{rowIndex % 2 === 0 ? 'bg-card' : 'bg-background'}
							{hasErrors(stmt) ? 'border-l-2 border-l-destructive' : ''}"
					>
						{#each columns as col, colIndex}
							{#if col.field === 'actions'}
								<td class="px-1 py-1">
									<div class="flex items-center gap-0.5">
										<Button
											variant="ghost"
											size="icon"
											class="h-6 w-6 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground transition-opacity"
											onclick={() => duplicateStatement(description.id, stmt.id)}
										>
											<Copy class="h-3 w-3" />
										</Button>
										<Button
											variant="ghost"
											size="icon"
											class="h-6 w-6 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive transition-opacity"
											onclick={() => removeStatement(description.id, stmt.id)}
										>
											<Trash2 class="h-3 w-3" />
										</Button>
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
							{:else if editingCell === `${rowIndex}-${colIndex}`}
								<td class="px-0.5 py-0.5">
									{#if $assistanceEnabled && col.field === 'propertyId'}
										<!-- Smart: PropertyAutocomplete -->
										<PropertyAutocomplete
											value={editValue}
											placeholder="prefix:term"
											type="P"
											class="w-full"
											onchange={(v) => { editValue = v; }}
											onselect={(result) => {
												editValue = result.prefixed;
												commitEdit(stmt, col);
											}}
										/>
									{:else if $assistanceEnabled && col.field === 'valueType'}
										<!-- Smart: ValueType dropdown -->
										<select
											class="w-full h-7 px-1 text-xs bg-background border border-ring rounded focus:outline-none focus:ring-1 focus:ring-ring"
											value={editValue}
											onchange={(e) => {
												editValue = (e.target as HTMLSelectElement).value;
												commitEdit(stmt, col);
											}}
											onblur={() => commitEdit(stmt, col)}
											autofocus
										>
											{#if flavor === 'dctap'}
												<option value="">(empty)</option>
												<option value="literal">literal</option>
												<option value="IRI">IRI</option>
												<option value="bnode">bnode</option>
											{:else}
												<option value="">{labels.valueTypes.empty}</option>
												<option value={labels.valueTypes.literal}>{labels.valueTypes.literal}</option>
												<option value={labels.valueTypes.iri}>{labels.valueTypes.iri}</option>
												<option value={labels.valueTypes.structured}>{labels.valueTypes.structured}</option>
											{/if}
										</select>
									{:else if $assistanceEnabled && col.field === 'min' && flavor === 'dctap'}
										<!-- Smart: mandatory TRUE/FALSE dropdown -->
										<select
											class="w-full h-7 px-1 text-xs bg-background border border-ring rounded focus:outline-none focus:ring-1 focus:ring-ring"
											value={editValue}
											onchange={(e) => {
												editValue = (e.target as HTMLSelectElement).value;
												commitEdit(stmt, col);
											}}
											onblur={() => commitEdit(stmt, col)}
											autofocus
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
											onblur={() => commitEdit(stmt, col)}
											autofocus
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
											onblur={() => commitEdit(stmt, col)}
											autofocus
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
									{:else if $assistanceEnabled && col.field === 'datatype'}
										<!-- Smart: valueDataType dropdown -->
										<select
											class="w-full h-7 px-1 text-xs font-mono bg-background border border-ring rounded focus:outline-none focus:ring-1 focus:ring-ring"
											value={editValue}
											onchange={(e) => {
												editValue = (e.target as HTMLSelectElement).value;
												commitEdit(stmt, col);
											}}
											onblur={() => commitEdit(stmt, col)}
											autofocus
										>
											<option value="">(none)</option>
											<option value="xsd:string">xsd:string</option>
											<option value="xsd:integer">xsd:integer</option>
											<option value="xsd:decimal">xsd:decimal</option>
											<option value="xsd:boolean">xsd:boolean</option>
											<option value="xsd:date">xsd:date</option>
											<option value="xsd:dateTime">xsd:dateTime</option>
											<option value="xsd:time">xsd:time</option>
											<option value="xsd:gYear">xsd:gYear</option>
											<option value="xsd:anyURI">xsd:anyURI</option>
											<option value="xsd:float">xsd:float</option>
											<option value="xsd:double">xsd:double</option>
											<option value="xsd:nonNegativeInteger">xsd:nonNegativeInteger</option>
											<option value="rdf:langString">rdf:langString</option>
										</select>
									{:else}
										<!-- Default: plain text input -->
										<input
											type="text"
											bind:value={editValue}
											onblur={() => commitEdit(stmt, col)}
											onkeydown={(e: KeyboardEvent) => handleKeydown(e, stmt, col, rowIndex, colIndex)}
											class="w-full h-7 px-1.5 text-xs bg-background border border-ring rounded focus:outline-none focus:ring-1 focus:ring-ring {col.mono ? 'font-mono' : ''}"
											autofocus
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
				No {labels.statementPlural.toLowerCase()} yet. Click the + row above to add one.
			</p>
		</div>
	{/if}
</div>
