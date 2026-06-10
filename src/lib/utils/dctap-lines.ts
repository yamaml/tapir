/**
 * @fileoverview Line→statement mapping for the DCTAP raw table.
 *
 * The raw-table editor renders the exact rows `buildDctapRows` emits.
 * Instead of reverse-engineering which row belongs to which statement
 * from the row contents (fragile: a first statement with an empty
 * propertyID, or a dedicated shape header row carrying the
 * description's note, shifted every later row by one), this module
 * walks the descriptions in step with the generator's row order and
 * tags every line with its `descIndex`/`stmtIndex` directly.
 *
 * @module utils/dctap-lines
 */

import type { TapirProject } from '$lib/types';
import {
	buildDctapRows,
	dctapShapeNeedsHeaderRow,
	DCTAP_COLUMNS,
} from '$lib/converters/dctap-generator';

// ── Types ───────────────────────────────────────────────────────

/** One rendered DCTAP raw-table line with its model coordinates. */
export interface DctapLine {
	/** `header` = shape-only row (no statement); `data` = statement row. */
	kind: 'header' | 'data';
	/** Cell values in `DCTAP_COLUMNS` order. */
	cells: string[];
	/** Index into `project.descriptions`. */
	descIndex: number;
	/** Index into the description's statements. Absent on header rows. */
	stmtIndex?: number;
	/** True when this line carries the shapeID/shapeLabel columns. */
	carriesShape: boolean;
}

// ── Builder ─────────────────────────────────────────────────────

/**
 * Builds the raw-table line list with exact statement coordinates.
 *
 * Mirrors `buildDctapRows(project, { includeEmptyStatements: true })`:
 * a dedicated shape header row appears when the description has a
 * `note` or no statements at all; otherwise the first statement row
 * carries the shapeID/shapeLabel cells. Empty-propertyID statements
 * are included, so every statement row is editable.
 *
 * @param project - The project to render.
 * @returns Lines in generator order, each tagged with model indices.
 *
 * @example
 * const lines = buildDctapLines(project);
 * lines[0].descIndex; // 0 — even when the first statement has no propertyID
 */
export function buildDctapLines(project: TapirProject): DctapLine[] {
	const rows = buildDctapRows(project, { includeEmptyStatements: true });
	const lines: DctapLine[] = [];
	const descriptions = project.descriptions || [];
	let r = 0;

	for (let di = 0; di < descriptions.length; di++) {
		const desc = descriptions[di];
		const stmts = desc.statements || [];
		// Shared predicate with the generator: header row when the shape
		// has a note (which has no other home in DCTAP) or no statement
		// rows. `true` mirrors `includeEmptyStatements: true` above.
		const hasHeaderRow = dctapShapeNeedsHeaderRow(desc, true);

		if (hasHeaderRow) {
			lines.push({
				kind: 'header',
				cells: DCTAP_COLUMNS.map((c) => rows[r][c]),
				descIndex: di,
				carriesShape: true,
			});
			r++;
		}

		for (let si = 0; si < stmts.length; si++) {
			lines.push({
				kind: 'data',
				cells: DCTAP_COLUMNS.map((c) => rows[r][c]),
				descIndex: di,
				stmtIndex: si,
				carriesShape: !hasHeaderRow && si === 0,
			});
			r++;
		}
	}

	return lines;
}
