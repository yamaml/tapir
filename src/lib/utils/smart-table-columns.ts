/**
 * @fileoverview Column definitions for the Smart Table editor.
 *
 * Extracted from `smart-table-editor.svelte` so the per-flavor column
 * model (cell key, Statement field, width, help copy) is a pure
 * function that can be unit-tested without component mounts.
 *
 * @module utils/smart-table-columns
 */

import type { Flavor, Statement, FlavorLabels, EditorStrings } from '$lib/types';

// ── Types ───────────────────────────────────────────────────────

/** One Smart Table column definition. */
export interface SmartTableColumn {
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
	/**
	 * One-line explanation surfaced via the column header's help icon.
	 * Mirrors the FieldLabel `help` content used in the Customized
	 * editor — keep these in sync so the vocabulary is identical
	 * across modes.
	 */
	help?: string;
}

// ── Builder ─────────────────────────────────────────────────────

/**
 * Builds the Smart Table column list for a flavor.
 *
 * Help copy comes from the centralised editor strings, so the
 * SimpleDSP JP toggle localises it (no-mixing rule) and DCTAP shows
 * wording for its own column model rather than SimpleDSP copy.
 *
 * @param flavor - The active profile flavor.
 * @param labels - Flavor labels providing the column headers.
 * @param ui - Editor strings providing the column help copy.
 * @returns Columns in display order, ending with the actions column.
 *
 * @example
 * const cols = buildSmartTableColumns('dctap', labels, ui);
 * cols[0].key; // 'propertyID'
 */
export function buildSmartTableColumns(
	flavor: Flavor,
	labels: FlavorLabels,
	ui: EditorStrings
): SmartTableColumn[] {
	if (flavor === 'dctap') {
		return [
			{ key: 'propertyID', header: labels.columns.property, field: 'propertyId', width: 'w-[120px]', mono: true,
				help: ui.columnHelp.property },
			{ key: 'propertyLabel', header: labels.columns.name, field: 'label', width: 'w-[110px]',
				help: ui.columnHelp.name },
			{ key: 'mandatory', header: labels.columns.min, field: 'min', width: 'w-[70px]',
				help: ui.columnHelp.min },
			{ key: 'repeatable', header: labels.columns.max, field: 'max', width: 'w-[70px]',
				help: ui.columnHelp.max },
			{ key: 'valueNodeType', header: labels.columns.valueType, field: 'valueType', width: 'w-[90px]',
				help: ui.columnHelp.valueType },
			{ key: 'valueDataType', header: 'valueDataType', field: 'datatype', width: 'w-[100px]', mono: true,
				help: ui.columnHelp.datatype },
			{ key: 'constraintType', header: 'valueConstraintType', field: 'constraintType', width: 'w-[110px]',
				help: ui.columnHelp.constraintType },
			{ key: 'valueConstraint', header: labels.columns.constraint, field: 'constraint', width: 'w-[110px]',
				help: ui.columnHelp.constraint },
			{ key: 'valueShape', header: 'valueShape', field: 'shapeRefs', width: 'w-[100px]',
				help: ui.columnHelp.shapeRefs },
			{ key: 'note', header: labels.columns.note, field: 'note', width: 'w-[120px]',
				help: ui.columnHelp.note },
			{ key: 'actions', header: '', field: 'actions', width: 'w-[40px]' },
		];
	}
	// SimpleDSP — help strings come from the centralized editor
	// strings so the JP toggle localizes them (no-mixing rule).
	return [
		{ key: 'name', header: labels.columns.name, field: 'label', width: 'w-[120px]',
			help: ui.columnHelp.name },
		{ key: 'property', header: labels.columns.property, field: 'propertyId', width: 'w-[130px]', mono: true,
			help: ui.columnHelp.property },
		{ key: 'min', header: labels.columns.min, field: 'min', width: 'w-[55px]',
			help: ui.columnHelp.min },
		{ key: 'max', header: labels.columns.max, field: 'max', width: 'w-[55px]',
			help: ui.columnHelp.max },
		{ key: 'valueType', header: labels.columns.valueType, field: 'valueType', width: 'w-[90px]',
			help: ui.columnHelp.valueType },
		{ key: 'constraint', header: labels.columns.constraint, field: 'constraint', width: 'w-[130px]', mono: true,
			help: ui.columnHelp.constraint },
		{ key: 'note', header: labels.columns.note, field: 'note', width: 'w-[140px]',
			help: ui.columnHelp.note },
		{ key: 'actions', header: '', field: 'actions', width: 'w-[40px]' },
	];
}
