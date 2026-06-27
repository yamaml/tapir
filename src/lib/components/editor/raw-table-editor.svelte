<script lang="ts">
	import type { TapirProject, Flavor } from '$lib/types';
	import { resolveSimpleDspValueType, resolveSimpleDspConstraint } from '$lib/converters';
	import { DCTAP_COLUMNS } from '$lib/converters';
	import { updateStatement, updateDescription, simpleDspLang, addStatement } from '$lib/stores';
	import { parseCardinality } from '$lib/converters';
	import {
		parseValueTypeCell,
		parseValueTypeCellList,
		valueTypeSelectionUpdates,
		parseSimpleDspConstraintCell,
		parseDctapConstraintCell,
	} from '$lib/utils/editor-cells';
	import { buildDctapLines, type DctapLine } from '$lib/utils/dctap-lines';
	import { focusOnMount } from '$lib/utils/focus-on-mount';
	import Plus from 'lucide-svelte/icons/plus';

	/** English → Japanese mapping for SimpleDSP value-type display. */
	const VALUE_TYPE_JP: Record<string, string> = {
		ID: 'ID',
		literal: '文字列',
		structured: '構造化',
		reference: '参照値',
		IRI: '参照値',
		'': '制約なし',
	};

	function localizeValueType(vt: string, lang: 'en' | 'jp'): string {
		return lang === 'jp' ? (VALUE_TYPE_JP[vt] ?? vt) : vt;
	}

	interface Props {
		project: TapirProject;
		flavor: Flavor;
	}

	let { project, flavor }: Props = $props();

	// ── SimpleDSP view ──────────────────────────────────────────────

	interface SimpleDspLine {
		type: 'block-header' | 'comment-header' | 'data';
		text?: string;
		cells?: string[];
		descIndex?: number;
		stmtIndex?: number;
		isIdRow?: boolean;
	}

	let simpleDspLines = $derived.by((): SimpleDspLine[] => {
		if (flavor !== 'simpledsp') return [];
		const lines: SimpleDspLine[] = [];
		const descriptions = project.descriptions || [];

		for (let di = 0; di < descriptions.length; di++) {
			const desc = descriptions[di];
			const blockId = (di === 0 && flavor === 'simpledsp') ? 'MAIN' : desc.name;

			lines.push({ type: 'block-header', text: `[${blockId}]`, descIndex: di });
			const headerCells = $simpleDspLang === 'jp'
				? ['#項目規則名', 'プロパティ', '最小', '最大', '値タイプ', '値制約', 'コメント']
				: ['#Name', 'Property', 'Min', 'Max', 'ValueType', 'Constraint', 'Comment'];
			lines.push({ type: 'comment-header', cells: headerCells });

			// ID row
			if (flavor === 'simpledsp') {
				const idComment = desc.note || '';
				const idConstraint = desc.idPrefix ? `${desc.idPrefix}:` : '';
				lines.push({
					type: 'data',
					cells: ['ID', desc.targetClass, '1', '1', 'ID', idConstraint, idComment],
					descIndex: di,
					isIdRow: true,
				});
			}

			for (let si = 0; si < desc.statements.length; si++) {
				const stmt = desc.statements[si];
				const name = stmt.label || '';
				const property = stmt.propertyId || '';
				const min = stmt.cardinalityNote
					? stmt.cardinalityNote
					: stmt.min != null
						? String(stmt.min)
						: '0';
				const max = stmt.max != null ? String(stmt.max) : '-';
				const valueType = localizeValueType(resolveSimpleDspValueType(stmt), $simpleDspLang);
				const constraint = resolveSimpleDspConstraint(stmt);
				const comment = stmt.note || '';

				lines.push({
					type: 'data',
					cells: [name, property, min, max, valueType, constraint, comment],
					descIndex: di,
					stmtIndex: si,
				});
			}
		}

		return lines;
	});

	// SimpleDSP column headers
	const simpleDspHeaders = ['Name', 'Property', 'Min', 'Max', 'ValueType', 'Constraint', 'Comment'];

	// ── DCTAP view ──────────────────────────────────────────────────

	// Line→statement coordinates come from `buildDctapLines`, which
	// walks the descriptions in step with the generator's row order —
	// so a first statement with an empty propertyID stays editable and
	// dedicated shape header rows (emitted when a shape has a note)
	// never shift later rows onto the wrong statement.
	let dctapLines = $derived.by((): DctapLine[] => {
		if (flavor !== 'dctap') return [];
		return buildDctapLines(project);
	});

	// ── Inline editing ──────────────────────────────────────────────

	let editingCell = $state<string | null>(null);
	let editValue = $state('');
	/**
	 * Cell text at edit start. Commit is a no-op when the value is
	 * unchanged — without this, blurring a cell whose display is
	 * composed (localized value types, the Constraint column) would
	 * re-parse the display text and corrupt the underlying fields.
	 */
	let originalValue = $state('');

	function startEdit(lineIndex: number, colIndex: number, currentValue: string) {
		editingCell = `${lineIndex}-${colIndex}`;
		editValue = currentValue;
		originalValue = currentValue;
	}

	function commitSimpleDspEdit(line: SimpleDspLine, colIndex: number) {
		if (!editingCell || line.descIndex == null) {
			editingCell = null;
			return;
		}
		// Unchanged → no-op (see `originalValue`).
		if (editValue === originalValue) {
			editingCell = null;
			return;
		}

		const desc = project.descriptions[line.descIndex];
		if (!desc) { editingCell = null; return; }

		// ID row edits update description fields
		if (line.isIdRow) {
			if (colIndex === 1) {
				updateDescription(desc.id, { targetClass: editValue });
			} else if (colIndex === 6) {
				updateDescription(desc.id, { note: editValue });
			}
			editingCell = null;
			return;
		}

		if (line.stmtIndex == null) { editingCell = null; return; }

		const stmt = desc.statements[line.stmtIndex];
		if (!stmt) { editingCell = null; return; }

		// Map column index to field update
		switch (colIndex) {
			case 0: // Name
				updateStatement(desc.id, stmt.id, { label: editValue });
				break;
			case 1: // Property
				updateStatement(desc.id, stmt.id, { propertyId: editValue });
				break;
			case 2: { // Min
				const n = parseCardinality(editValue);
				if (editValue && n == null && editValue !== '-') {
					// Keyword cardinality (推奨 etc.) — keep the keyword,
					// leave min unset (undefined = unspecified).
					updateStatement(desc.id, stmt.id, { cardinalityNote: editValue, min: undefined });
				} else {
					// '' → undefined (unset); numbers pass through.
					updateStatement(desc.id, stmt.id, { min: n, cardinalityNote: '' });
				}
				break;
			}
			case 3: { // Max
				// Tri-state: '' → undefined (unset), '-' → null (explicitly
				// unbounded), number → explicit. Legacy stored null values
				// keep meaning "unbounded" — no migration needed.
				const n = parseCardinality(editValue);
				updateStatement(desc.id, stmt.id, { max: n });
				break;
			}
			case 4: { // ValueType — accepts EN + JP labels (文字列/参照値/構造化/制約なし)
				const parsed = parseValueTypeCell(editValue);
				if (parsed === null || parsed === 'structured') {
					// Unrecognised input never wipes the stored value;
					// 'structured' is derived from refs — keep current.
					break;
				}
				updateStatement(desc.id, stmt.id, valueTypeSelectionUpdates(parsed, 'simpledsp'));
				break;
			}
			case 5: { // Constraint — parse back with the display's precedence
				updateStatement(desc.id, stmt.id, parseSimpleDspConstraintCell(editValue, stmt));
				break;
			}
			case 6: // Comment
				updateStatement(desc.id, stmt.id, { note: editValue });
				break;
		}

		editingCell = null;
	}

	function commitDctapEdit(line: DctapLine, colIndex: number) {
		if (!editingCell || line.descIndex == null) {
			editingCell = null;
			return;
		}
		// Unchanged → no-op (see `originalValue`).
		if (editValue === originalValue) {
			editingCell = null;
			return;
		}

		const desc = project.descriptions[line.descIndex];
		if (!desc) { editingCell = null; return; }

		const colName = DCTAP_COLUMNS[colIndex];

		// Shape-level cells: editable on the line that displays them
		// (a dedicated header row, or the shape's first statement row).
		if (colName === 'shapeID' || colName === 'shapeLabel') {
			if (line.carriesShape) {
				if (colName === 'shapeID' && editValue.trim()) {
					updateDescription(desc.id, { name: editValue.trim() });
				} else if (colName === 'shapeLabel') {
					updateDescription(desc.id, { label: editValue });
				}
			}
			editingCell = null;
			return;
		}

		// Header rows have no statement; their note column belongs to
		// the description (it's where the generator writes desc.note).
		if (line.stmtIndex == null) {
			if (line.kind === 'header' && colName === 'note') {
				updateDescription(desc.id, { note: editValue });
			}
			editingCell = null;
			return;
		}

		const stmt = desc.statements[line.stmtIndex];
		if (!stmt) { editingCell = null; return; }

		switch (colName) {
			case 'propertyID':
				updateStatement(desc.id, stmt.id, { propertyId: editValue });
				break;
			case 'propertyLabel':
				updateStatement(desc.id, stmt.id, { label: editValue });
				break;
			case 'mandatory': {
				const upper = editValue.toUpperCase();
				if (upper === 'TRUE') updateStatement(desc.id, stmt.id, { min: 1 });
				else if (upper === 'FALSE') updateStatement(desc.id, stmt.id, { min: 0 });
				else updateStatement(desc.id, stmt.id, { min: undefined }); // cleared → unset
				break;
			}
			case 'repeatable': {
				// Tri-state max: TRUE → null (explicitly unbounded),
				// FALSE → 1, cleared → undefined (unset). Legacy stored
				// null values keep meaning "unbounded" — no migration.
				const upper = editValue.toUpperCase();
				if (upper === 'TRUE') updateStatement(desc.id, stmt.id, { max: null });
				else if (upper === 'FALSE') updateStatement(desc.id, stmt.id, { max: 1 });
				else updateStatement(desc.id, stmt.id, { max: undefined });
				break;
			}
			case 'valueNodeType': {
				// DCTAP cells can carry multiple node kinds ("IRI BNODE"),
				// so parse the whole cell as a list.
				const parsed = parseValueTypeCellList(editValue);
				// Unrecognised input never wipes the stored value.
				if (parsed === null) break;
				updateStatement(desc.id, stmt.id, valueTypeSelectionUpdates(parsed, 'dctap'));
				break;
			}
			case 'valueDataType':
				// DCTAP valueDataType: space-separated per the DCMI SRAP
				// convention (mirrors valueShape handling below).
				updateStatement(desc.id, stmt.id, {
					datatype: editValue.split(/\s+/).map((s) => s.trim()).filter(Boolean),
				});
				break;
			case 'valueConstraint':
				// Parse back per valueConstraintType — a composed display
				// (picklist, IRI stem, pattern, facet) returns to its
				// structured field instead of being dumped into `constraint`.
				updateStatement(desc.id, stmt.id, parseDctapConstraintCell(editValue, stmt));
				break;
			case 'valueConstraintType':
				updateStatement(desc.id, stmt.id, { constraintType: editValue });
				break;
			case 'valueShape':
				// DCTAP valueShape: space-separated per DCMI SRAP convention.
				updateStatement(desc.id, stmt.id, {
					shapeRefs: editValue.split(/\s+/).map((s) => s.trim()).filter(Boolean),
				});
				break;
			case 'note':
				updateStatement(desc.id, stmt.id, { note: editValue });
				break;
		}

		editingCell = null;
	}

	function handleKeydown(e: KeyboardEvent, commitFn: () => void) {
		if (e.key === 'Enter') {
			commitFn();
			e.preventDefault();
		} else if (e.key === 'Escape') {
			editingCell = null;
			e.preventDefault();
		}
	}

	function handleAddToDesc(descIndex: number) {
		const desc = project.descriptions[descIndex];
		if (desc) {
			addStatement(desc.id);
		}
	}
</script>

<div class="space-y-2">
	{#if flavor === 'simpledsp'}
		<!-- SimpleDSP Raw Table -->
		<div class="overflow-x-auto rounded-md border border-border">
			<table class="w-full min-w-[700px] font-mono text-xs">
				<thead>
					<tr class="border-b border-border bg-muted/50">
						{#each simpleDspHeaders as header}
							<th class="px-2 py-1.5 text-left text-[10px] font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap">
								{header}
							</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each simpleDspLines as line, lineIndex}
						{#if line.type === 'block-header'}
							<tr class="bg-[var(--tapir-warning)]/15">
								<td colspan="7" class="px-2 py-1.5 font-bold text-[var(--tapir-warning)]">
									{line.text}
								</td>
							</tr>
						{:else if line.type === 'comment-header' && line.cells}
							<tr class="bg-muted/30">
								{#each line.cells as cell}
									<td class="px-2 py-1 text-muted-foreground">
										{cell}
									</td>
								{/each}
							</tr>
						{:else if line.type === 'data' && line.cells}
							<tr class="border-b border-border/50 last:border-b-0
								{line.isIdRow ? 'bg-muted/20 text-muted-foreground' : lineIndex % 2 === 0 ? 'bg-card' : 'bg-background'}">
								{#each line.cells as cell, colIndex}
									{#if editingCell === `${lineIndex}-${colIndex}`}
										<td class="px-0.5 py-0.5">
											<input
												type="text"
												bind:value={editValue}
												onblur={() => commitSimpleDspEdit(line, colIndex)}
												onkeydown={(e: KeyboardEvent) => handleKeydown(e, () => commitSimpleDspEdit(line, colIndex))}
												class="w-full h-6 px-1 text-xs font-mono bg-background border border-ring rounded focus:outline-none focus:ring-1 focus:ring-ring"
												use:focusOnMount
											/>
										</td>
									{:else}
										<td
											class="px-2 py-1 cursor-text whitespace-nowrap truncate max-w-[160px]"
											onclick={() => startEdit(lineIndex, colIndex, cell)}
											role="gridcell"
											tabindex="0"
											onkeydown={(e: KeyboardEvent) => {
												if (e.key === 'Enter' || e.key === 'F2') {
													startEdit(lineIndex, colIndex, cell);
													e.preventDefault();
												}
											}}
										>
											{cell || ' '}
										</td>
									{/if}
								{/each}
							</tr>
						{/if}
					{/each}
					<!-- Add row buttons for each description -->
					{#each project.descriptions as desc, di}
						<tr class="border-t border-dashed border-border/50">
							<td colspan="7" class="px-2 py-0.5">
								<button
									type="button"
									class="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors py-0.5"
									onclick={() => handleAddToDesc(di)}
								>
									<Plus class="h-2.5 w-2.5" />
									Add to {(di === 0 && flavor === 'simpledsp') ? 'MAIN' : desc.name}
								</button>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{:else}
		<!-- DCTAP Raw Table -->
		<div class="overflow-x-auto rounded-md border border-border">
			<table class="w-full min-w-[700px] font-mono text-xs">
				<thead>
					<tr class="border-b border-border bg-muted/50">
						{#each DCTAP_COLUMNS as col}
							<!--
								DCTAP column names are camelCase per the spec
								(propertyID, valueNodeType, etc.) — render
								verbatim in a monospace face.
							-->
							<th class="px-2 py-1.5 text-left text-[10px] font-mono font-medium text-muted-foreground tracking-wider whitespace-nowrap">
								{col}
							</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each dctapLines as line, lineIndex}
						<tr class="border-b border-border/50 last:border-b-0
							{line.carriesShape ? 'bg-muted/30 font-semibold' : lineIndex % 2 === 0 ? 'bg-card' : 'bg-background'}">
							{#each line.cells as cell, colIndex}
								{#if editingCell === `${lineIndex}-${colIndex}`}
									<td class="px-0.5 py-0.5">
										<input
											type="text"
											bind:value={editValue}
											onblur={() => commitDctapEdit(line, colIndex)}
											onkeydown={(e: KeyboardEvent) => handleKeydown(e, () => commitDctapEdit(line, colIndex))}
											class="w-full h-6 px-1 text-xs font-mono bg-background border border-ring rounded focus:outline-none focus:ring-1 focus:ring-ring"
											use:focusOnMount
										/>
									</td>
								{:else}
									<td
										class="px-2 py-1 cursor-text whitespace-nowrap truncate max-w-[130px]
											{colIndex === 0 && cell ? 'font-bold' : ''}"
										onclick={() => startEdit(lineIndex, colIndex, cell)}
										role="gridcell"
										tabindex="0"
										onkeydown={(e: KeyboardEvent) => {
											if (e.key === 'Enter' || e.key === 'F2') {
												startEdit(lineIndex, colIndex, cell);
												e.preventDefault();
											}
										}}
									>
										{cell || ' '}
									</td>
								{/if}
							{/each}
						</tr>
					{/each}
					<!-- Add row buttons -->
					{#each project.descriptions as desc, di}
						<tr class="border-t border-dashed border-border/50">
							<td colspan={DCTAP_COLUMNS.length} class="px-2 py-0.5">
								<button
									type="button"
									class="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors py-0.5"
									onclick={() => handleAddToDesc(di)}
								>
									<Plus class="h-2.5 w-2.5" />
									Add to {desc.name}
								</button>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}

	{#if project.descriptions.length === 0}
		<div class="flex items-center justify-center py-8">
			<p class="text-sm text-muted-foreground font-mono">
				No descriptions. Add one from the sidebar.
			</p>
		</div>
	{/if}
</div>
