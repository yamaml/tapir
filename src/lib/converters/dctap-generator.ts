/**
 * @fileoverview DCTAP (DC Tabular Application Profiles) generator.
 *
 * Generates DCTAP row objects from a `TapirProject`. The output rows
 * can be serialised to CSV, TSV, or Excel by the caller.
 *
 * Tapir field → DCTAP column mapping:
 *
 * | Tapir field              | DCTAP column          |
 * |--------------------------|-----------------------|
 * | Description.name         | shapeID               |
 * | Description.label        | shapeLabel            |
 * | Statement.propertyId     | propertyID            |
 * | Statement.label          | propertyLabel         |
 * | Statement.min >= 1       | mandatory = TRUE      |
 * | Statement.max null/> 1   | repeatable = TRUE     |
 * | Statement.valueType      | valueNodeType         |
 * | Statement.datatype       | valueDataType         |
 * | Statement.shapeRefs      | valueShape (space-separated) |
 * | Statement.values         | valueConstraint (picklist) |
 * | Statement.pattern        | valueConstraint (pattern)  |
 * | Statement.facets         | valueConstraint (facet)    |
 * | Statement.note           | note                  |
 *
 * Ported from yama-cli `src/modules/dctap.js`.
 *
 * @module converters/dctap-generator
 * @see https://dcmi.github.io/dctap/
 */

import type { TapirProject, Statement } from '$lib/types';

// ── Constants ───────────────────────────────────────────────────

/** Canonical DCTAP column headers in standard order. */
export const DCTAP_COLUMNS = [
	'shapeID',
	'shapeLabel',
	'propertyID',
	'propertyLabel',
	'mandatory',
	'repeatable',
	'valueNodeType',
	'valueDataType',
	'valueConstraint',
	'valueConstraintType',
	'valueShape',
	'note',
] as const;

/** A single DCTAP output row. */
export type DctapOutputRow = Record<(typeof DCTAP_COLUMNS)[number], string>;

// ── Helper Functions ────────────────────────────────────────────

/**
 * Resolves the DCTAP `mandatory` flag from Tapir min cardinality.
 *
 * @param min - The Statement.min value.
 * @returns `"TRUE"`, `"FALSE"`, or empty string.
 */
export function toMandatory(min: number | null): string {
	if (min == null) return '';
	return min >= 1 ? 'TRUE' : 'FALSE';
}

/**
 * Resolves the DCTAP `repeatable` flag from Tapir max cardinality.
 *
 * @param max - The Statement.max value.
 * @param min - The Statement.min value (used to detect "unset" state).
 * @returns `"TRUE"`, `"FALSE"`, or empty string.
 */
export function toRepeatable(max: number | null, min: number | null): string {
	if (min == null && max == null) return '';
	if (max == null) return 'TRUE';
	return max > 1 ? 'TRUE' : 'FALSE';
}

/**
 * Resolves the DCTAP `valueNodeType` from Tapir valueType.
 *
 * @param type - The Tapir ValueType value.
 * @returns The DCTAP valueNodeType string.
 */
export function toValueNodeType(type: string): string {
	if (!type) return '';
	switch (type.toLowerCase()) {
		case 'iri':
			return 'IRI';
		case 'literal':
			return 'literal';
		case 'bnode':
			return 'bnode';
		default:
			return '';
	}
}

/**
 * Resolves DCTAP valueConstraint and valueConstraintType from Tapir
 * Statement fields.
 *
 * Preference order:
 *   1. An explicit `constraintType` set by the user — pulls from the
 *      field appropriate to that type (values / pattern / facets /
 *      inScheme). This lets the user pick `languageTag` or `IRIstem`
 *      without guessing at heuristics.
 *   2. Otherwise, heuristic based on which structural field is set:
 *      values → picklist, pattern → pattern, inScheme → IRIstem,
 *      facets → the corresponding facet type.
 *
 * DCTAP serialisation uses comma-separated lists inside a single cell
 * (per the spec's examples: `History,Science,Art` and `en,fr,zh-Hans`).
 *
 * @param stmt - The statement to extract constraints from.
 * @returns Object with `valueConstraint` and `valueConstraintType` strings.
 */
export function toValueConstraint(stmt: Statement): {
	valueConstraint: string;
	valueConstraintType: string;
} {
	const userType = (stmt.constraintType || '').trim();

	// 1. Explicit user-set constraintType wins — route to the right source.
	if (userType) {
		const normalised = userType.toLowerCase();
		if (normalised === 'picklist' && stmt.values?.length) {
			return { valueConstraint: stmt.values.join(','), valueConstraintType: 'picklist' };
		}
		if (normalised === 'languagetag' && stmt.values?.length) {
			return { valueConstraint: stmt.values.join(','), valueConstraintType: 'languageTag' };
		}
		if (normalised === 'iristem' && (stmt.inScheme?.length || stmt.values?.length)) {
			const stems = (stmt.inScheme?.length ? stmt.inScheme : stmt.values) ?? [];
			return { valueConstraint: stems.join(','), valueConstraintType: 'IRIstem' };
		}
		if (normalised === 'pattern' && stmt.pattern) {
			return { valueConstraint: stmt.pattern, valueConstraintType: 'pattern' };
		}
		const facetKey = FACET_FOR_TYPE[normalised];
		if (facetKey && stmt.facets?.[facetKey] != null) {
			return {
				valueConstraint: String(stmt.facets[facetKey]),
				valueConstraintType: normaliseFacetName(normalised),
			};
		}
		// User set a type but no matching content — preserve `constraint`
		// verbatim so the export still reflects their choice.
		if (stmt.constraint) {
			return { valueConstraint: stmt.constraint, valueConstraintType: userType };
		}
	}

	// 2. Heuristic fallback.
	if (Array.isArray(stmt.values) && stmt.values.length > 0) {
		return { valueConstraint: stmt.values.join(','), valueConstraintType: 'picklist' };
	}
	if (Array.isArray(stmt.inScheme) && stmt.inScheme.length > 0) {
		return { valueConstraint: stmt.inScheme.join(','), valueConstraintType: 'IRIstem' };
	}
	if (stmt.pattern) {
		return { valueConstraint: stmt.pattern, valueConstraintType: 'pattern' };
	}
	if (stmt.facets) {
		const facetMap: Record<string, string> = {
			MinInclusive: 'minInclusive',
			MaxInclusive: 'maxInclusive',
			MinLength: 'minLength',
			MaxLength: 'maxLength',
		};
		for (const [tapirKey, dctapType] of Object.entries(facetMap)) {
			const facetValue = stmt.facets[tapirKey as keyof typeof stmt.facets];
			if (facetValue != null) {
				return { valueConstraint: String(facetValue), valueConstraintType: dctapType };
			}
		}
	}

	return { valueConstraint: '', valueConstraintType: '' };
}

/** Maps a lowercased DCTAP facet type to the Tapir Statement.facets key. */
const FACET_FOR_TYPE: Record<string, keyof Statement['facets']> = {
	mininclusive: 'MinInclusive',
	maxinclusive: 'MaxInclusive',
	minlength: 'MinLength',
	maxlength: 'MaxLength',
};

/** Restores camelCase casing for a lowercased facet type name. */
function normaliseFacetName(lower: string): string {
	switch (lower) {
		case 'mininclusive':
			return 'minInclusive';
		case 'maxinclusive':
			return 'maxInclusive';
		case 'minlength':
			return 'minLength';
		case 'maxlength':
			return 'maxLength';
		default:
			return lower;
	}
}

// ── Main Generator ──────────────────────────────────────────────

/**
 * Converts a `TapirProject` to DCTAP row objects.
 *
 * Each description becomes one or more rows. The first statement row
 * in each description carries the `shapeID` and `shapeLabel`;
 * subsequent rows leave those columns empty.
 *
 * Descriptions with no statements produce a single row with only
 * `shapeID`, `shapeLabel`, and optionally `note`.
 *
 * @param project - The Tapir project to export.
 * @returns Array of row objects with DCTAP column keys.
 *
 * @example
 * const rows = buildDctapRows(project);
 * // Serialise rows to CSV, TSV, or Excel...
 */
export function buildDctapRows(project: TapirProject): DctapOutputRow[] {
	const descriptions = project.descriptions || [];
	const rows: DctapOutputRow[] = [];

	for (const desc of descriptions) {
		const statements = desc.statements || [];

		if (statements.length === 0) {
			rows.push({
				shapeID: desc.name,
				shapeLabel: desc.label || '',
				propertyID: '',
				propertyLabel: '',
				mandatory: '',
				repeatable: '',
				valueNodeType: '',
				valueDataType: '',
				valueConstraint: '',
				valueConstraintType: '',
				valueShape: '',
				note: desc.note || '',
			});
			continue;
		}

		for (let i = 0; i < statements.length; i++) {
			const stmt = statements[i];
			if (!stmt.propertyId) continue;

			const { valueConstraint, valueConstraintType } = toValueConstraint(stmt);

			rows.push({
				shapeID: i === 0 ? desc.name : '',
				shapeLabel: i === 0 ? (desc.label || '') : '',
				propertyID: stmt.propertyId,
				propertyLabel: stmt.label || '',
				mandatory: toMandatory(stmt.min),
				repeatable: toRepeatable(stmt.max, stmt.min),
				valueNodeType: toValueNodeType(stmt.valueType),
				valueDataType: stmt.datatype || '',
				valueConstraint,
				valueConstraintType,
				valueShape: (stmt.shapeRefs || []).join(' '),
				note: stmt.note || '',
			});
		}
	}

	return rows;
}
