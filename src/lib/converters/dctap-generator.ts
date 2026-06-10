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
import type { GeneratorWarning } from '$lib/types/export';

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
 * `undefined` (and legacy `null`) means unspecified and exports as
 * an empty cell; `min >= 1` → `TRUE`; `min 0` → `FALSE`. Exactly
 * reverses the importer's mapping.
 *
 * @param min - The Statement.min value.
 * @returns `"TRUE"`, `"FALSE"`, or empty string.
 */
export function toMandatory(min: number | null | undefined): string {
	if (min == null) return '';
	return min >= 1 ? 'TRUE' : 'FALSE';
}

/**
 * Resolves the DCTAP `repeatable` flag from Tapir max cardinality.
 *
 * `undefined` = unspecified → empty cell; `null` = explicitly
 * unbounded → `TRUE`; `max > 1` → `TRUE`; `max ≤ 1` → `FALSE`.
 * Exactly reverses the importer's mapping — unlike the previous
 * implementation, an unset `repeatable` no longer fabricates `TRUE`
 * just because `mandatory` was set.
 *
 * @param max - The Statement.max value.
 * @returns `"TRUE"`, `"FALSE"`, or empty string.
 */
export function toRepeatable(max: number | null | undefined): string {
	if (max === undefined) return '';
	if (max === null) return 'TRUE';
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
 *   2. Otherwise, heuristic based on which structural field is set,
 *      in the cross-implementation precedence order (matching
 *      yama-cli): inScheme → IRIstem, then values → picklist, then
 *      pattern, then facets.
 *
 * DCTAP serialisation uses comma-separated lists inside a single cell
 * (per the spec's examples: `History,Science,Art` and `en,fr,zh-Hans`).
 * List members that themselves contain commas cannot survive the
 * round-trip; a warning is recorded when that happens.
 *
 * @param stmt - The statement to extract constraints from.
 * @param warnings - Optional accumulator for lossy-serialisation warnings.
 * @returns Object with `valueConstraint` and `valueConstraintType` strings.
 */
export function toValueConstraint(
	stmt: Statement,
	warnings?: GeneratorWarning[]
): {
	valueConstraint: string;
	valueConstraintType: string;
} {
	const userType = (stmt.constraintType || '').trim();
	const joinList = (items: string[], kind: string): string => {
		if (items.some((v) => v.includes(','))) {
			warnings?.push({
				message: `Statement "${stmt.label || stmt.propertyId || stmt.id}": ${kind} value containing a comma cannot be represented losslessly in DCTAP's comma-separated cell`,
			});
		}
		return items.join(',');
	};

	// 1. Explicit user-set constraintType wins — route to the right source.
	if (userType) {
		const normalised = userType.toLowerCase();
		if (normalised === 'picklist' && stmt.values?.length) {
			return { valueConstraint: joinList(stmt.values, 'picklist'), valueConstraintType: 'picklist' };
		}
		if (normalised === 'languagetag' && stmt.values?.length) {
			return { valueConstraint: joinList(stmt.values, 'languageTag'), valueConstraintType: 'languageTag' };
		}
		if (normalised === 'iristem' && (stmt.inScheme?.length || stmt.values?.length)) {
			const stems = (stmt.inScheme?.length ? stmt.inScheme : stmt.values) ?? [];
			return { valueConstraint: joinList(stems, 'IRIstem'), valueConstraintType: 'IRIstem' };
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

	// 2. Heuristic fallback — inScheme first (D2; matches yama-cli).
	if (Array.isArray(stmt.inScheme) && stmt.inScheme.length > 0) {
		return { valueConstraint: joinList(stmt.inScheme, 'IRIstem'), valueConstraintType: 'IRIstem' };
	}
	if (Array.isArray(stmt.values) && stmt.values.length > 0) {
		return { valueConstraint: joinList(stmt.values, 'picklist'), valueConstraintType: 'picklist' };
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

/** An all-empty DCTAP row, used as the base for header rows. */
function emptyRow(): DctapOutputRow {
	return {
		shapeID: '',
		shapeLabel: '',
		propertyID: '',
		propertyLabel: '',
		mandatory: '',
		repeatable: '',
		valueNodeType: '',
		valueDataType: '',
		valueConstraint: '',
		valueConstraintType: '',
		valueShape: '',
		note: '',
	};
}

/**
 * Converts a `TapirProject` to DCTAP row objects.
 *
 * Each description becomes one or more rows. The `shapeID` and
 * `shapeLabel` are carried by the **first emitted** row of the shape
 * (not blindly statement index 0, which may be skipped for having no
 * property — that previously detached the whole shape on re-import).
 *
 * A dedicated shape header row (shapeID/shapeLabel/note, no
 * propertyID) is emitted when the description has a `note` — which
 * has no other home in DCTAP — or when it has no emittable statement
 * rows at all.
 *
 * @param project - The Tapir project to export.
 * @param options - When `includeEmptyStatements` is true, statements
 *   with an empty `propertyId` are emitted as blank rows rather than
 *   skipped. The default (false) matches the DCTAP CSV file format —
 *   spec-conforming output omits incomplete statements. The Raw Table
 *   editor passes true so users can see and fill in unfinished rows.
 *   `warnings` is an optional accumulator for lossy-mapping warnings.
 * @returns Array of row objects with DCTAP column keys.
 *
 * @example
 * const rows = buildDctapRows(project);
 * // Serialise rows to CSV, TSV, or Excel...
 */
export function buildDctapRows(
	project: TapirProject,
	options: { includeEmptyStatements?: boolean; warnings?: GeneratorWarning[] } = {},
): DctapOutputRow[] {
	const descriptions = project.descriptions || [];
	const rows: DctapOutputRow[] = [];
	const includeEmpty = options.includeEmptyStatements === true;
	const warnings = options.warnings;

	for (const desc of descriptions) {
		const statements = (desc.statements || []).filter(
			(stmt) => stmt.propertyId || includeEmpty
		);

		// Dedicated shape header row: carries the description's note
		// (statement rows' note column belongs to the statements), and
		// guarantees the shape appears even with no statement rows.
		const needsHeaderRow = statements.length === 0 || !!desc.note;
		if (needsHeaderRow) {
			rows.push({
				...emptyRow(),
				shapeID: desc.name,
				shapeLabel: desc.label || '',
				note: desc.note || '',
			});
		}

		for (let i = 0; i < statements.length; i++) {
			const stmt = statements[i];
			const isFirstEmitted = !needsHeaderRow && i === 0;
			const { valueConstraint, valueConstraintType } = toValueConstraint(stmt, warnings);

			rows.push({
				shapeID: isFirstEmitted ? desc.name : '',
				shapeLabel: isFirstEmitted ? (desc.label || '') : '',
				propertyID: stmt.propertyId,
				propertyLabel: stmt.label || '',
				mandatory: toMandatory(stmt.min),
				repeatable: toRepeatable(stmt.max),
				valueNodeType: toValueNodeType(stmt.valueType),
				valueDataType: (stmt.datatype || []).join(' '),
				valueConstraint,
				valueConstraintType,
				valueShape: (stmt.shapeRefs || []).join(' '),
				note: stmt.note || '',
			});
		}
	}

	return rows;
}
