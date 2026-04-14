<script lang="ts">
	import type { TapirProject, Flavor } from '$lib/types';
	import { buildSimpleDsp, resolveSimpleDspValueType, resolveSimpleDspConstraint } from '$lib/converters';
	import { buildDctapRows, DCTAP_COLUMNS } from '$lib/converters';
	import { currentProject, updateStatement, updateDescription, simpleDspLang } from '$lib/stores';
	import { parseSimpleDspText, simpleDspToTapir, parseCardinality } from '$lib/converters';
	import Plus from 'lucide-svelte/icons/plus';
	import { addStatement } from '$lib/stores';

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

	interface DctapLine {
		type: 'shape-header' | 'data';
		cells: string[];
		descIndex?: number;
		stmtIndex?: number;
	}

	let dctapLines = $derived.by((): DctapLine[] => {
		if (flavor !== 'dctap') return [];
		const rows = buildDctapRows(project);
		const lines: DctapLine[] = [];
		let currentDescIdx = -1;
		let stmtCountInDesc = 0;

		for (const row of rows) {
			if (row.shapeID) {
				currentDescIdx++;
				stmtCountInDesc = 0;
				// If this is a shape-only row (no propertyID), show as shape header
				if (!row.propertyID) {
					lines.push({
						type: 'shape-header',
						cells: DCTAP_COLUMNS.map((c) => row[c]),
						descIndex: currentDescIdx,
					});
					continue;
				}
			}

			lines.push({
				type: row.shapeID ? 'shape-header' : 'data',
				cells: DCTAP_COLUMNS.map((c) => row[c]),
				descIndex: currentDescIdx,
				stmtIndex: stmtCountInDesc,
			});
			stmtCountInDesc++;
		}

		return lines;
	});

	// ── Inline editing ──────────────────────────────────────────────

	let editingCell = $state<string | null>(null);
	let editValue = $state('');

	function startEdit(lineIndex: number, colIndex: number, currentValue: string) {
		editingCell = `${lineIndex}-${colIndex}`;
		editValue = currentValue;
	}

	function commitSimpleDspEdit(line: SimpleDspLine, colIndex: number) {
		if (!editingCell || line.descIndex == null) {
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
					updateStatement(desc.id, stmt.id, { cardinalityNote: editValue, min: null });
				} else {
					updateStatement(desc.id, stmt.id, { min: n, cardinalityNote: '' });
				}
				break;
			}
			case 3: { // Max
				const n = parseCardinality(editValue);
				updateStatement(desc.id, stmt.id, { max: n });
				break;
			}
			case 4: { // ValueType
				const vt = editValue.toLowerCase();
				if (vt === 'literal') {
					updateStatement(desc.id, stmt.id, { valueType: 'literal' });
				} else if (vt === 'iri') {
					updateStatement(desc.id, stmt.id, { valueType: 'iri' });
				} else if (vt === 'structured') {
					// structured is derived, keep current
				} else {
					updateStatement(desc.id, stmt.id, { valueType: '' });
				}
				break;
			}
			case 5: { // Constraint
				if (editValue.startsWith('#')) {
					// SimpleDSP spec: single #shape; also accept space-separated
					// "#A #B" for round-tripping multi-shape profiles.
					const refs = editValue
						.split(/\s+/)
						.filter((s) => s.startsWith('#'))
						.map((s) => s.slice(1))
						.filter(Boolean);
					updateStatement(desc.id, stmt.id, {
						shapeRefs: refs,
						constraint: '',
						datatype: '',
					});
				} else if (stmt.valueType === 'literal' && editValue) {
					updateStatement(desc.id, stmt.id, { datatype: editValue, constraint: '' });
				} else {
					updateStatement(desc.id, stmt.id, { constraint: editValue });
				}
				break;
			}
			case 6: // Comment
				updateStatement(desc.id, stmt.id, { note: editValue });
				break;
		}

		editingCell = null;
	}

	function commitDctapEdit(line: DctapLine, colIndex: number) {
		if (!editingCell || line.descIndex == null || line.stmtIndex == null) {
			editingCell = null;
			return;
		}

		const desc = project.descriptions[line.descIndex];
		if (!desc) { editingCell = null; return; }
		const stmt = desc.statements[line.stmtIndex];
		if (!stmt) { editingCell = null; return; }

		const colName = DCTAP_COLUMNS[colIndex];
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
				else updateStatement(desc.id, stmt.id, { min: null });
				break;
			}
			case 'repeatable': {
				const upper = editValue.toUpperCase();
				if (upper === 'TRUE') updateStatement(desc.id, stmt.id, { max: null });
				else if (upper === 'FALSE') updateStatement(desc.id, stmt.id, { max: 1 });
				else updateStatement(desc.id, stmt.id, { max: null });
				break;
			}
			case 'valueNodeType': {
				const lower = editValue.toLowerCase();
				if (lower === 'iri') updateStatement(desc.id, stmt.id, { valueType: 'iri' });
				else if (lower === 'literal') updateStatement(desc.id, stmt.id, { valueType: 'literal' });
				else if (lower === 'bnode') updateStatement(desc.id, stmt.id, { valueType: 'bnode' });
				else updateStatement(desc.id, stmt.id, { valueType: '' });
				break;
			}
			case 'valueDataType':
				updateStatement(desc.id, stmt.id, { datatype: editValue });
				break;
			case 'valueConstraint':
				updateStatement(desc.id, stmt.id, { constraint: editValue });
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
												autofocus
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
											{cell || '\u00A0'}
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
							{line.type === 'shape-header' ? 'bg-muted/30 font-semibold' : lineIndex % 2 === 0 ? 'bg-card' : 'bg-background'}">
							{#each line.cells as cell, colIndex}
								{#if editingCell === `${lineIndex}-${colIndex}`}
									<td class="px-0.5 py-0.5">
										<input
											type="text"
											bind:value={editValue}
											onblur={() => commitDctapEdit(line, colIndex)}
											onkeydown={(e: KeyboardEvent) => handleKeydown(e, () => commitDctapEdit(line, colIndex))}
											class="w-full h-6 px-1 text-xs font-mono bg-background border border-ring rounded focus:outline-none focus:ring-1 focus:ring-ring"
											autofocus
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
										{cell || '\u00A0'}
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
