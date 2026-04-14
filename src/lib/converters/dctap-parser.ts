/**
 * @fileoverview DCTAP (DC Tabular Application Profiles) parser.
 *
 * Parses an array of row objects (from CSV/TSV/XLSX parsing) with
 * DCTAP column keys into the Tapir internal model (`TapirProject`).
 *
 * DCTAP column → Tapir field mapping:
 *
 * | DCTAP column        | Tapir field                         |
 * |---------------------|-------------------------------------|
 * | shapeID             | Description.name                    |
 * | shapeLabel          | Description.label                   |
 * | propertyID          | Statement.propertyId                |
 * | propertyLabel       | Statement.label                     |
 * | mandatory           | Statement.min (1 or 0)              |
 * | repeatable          | Statement.max (null or 1)           |
 * | valueNodeType       | Statement.valueType (iri/literal/bnode) |
 * | valueDataType       | Statement.datatype                  |
 * | valueShape          | Statement.shapeRef                  |
 * | valueConstraint     | Statement.values/pattern/facets     |
 * | valueConstraintType | (determines which field above)      |
 * | note                | Statement.note                      |
 *
 * Ported from yama-cli `src/modules/dctap.js`.
 *
 * @module converters/dctap-parser
 * @see https://dcmi.github.io/dctap/
 */

import type {
	TapirProject,
	Description,
	Statement,
	ValueType,
	FacetMap,
} from '$lib/types';
import type { ParseResult, ParseMessage } from '$lib/types/export';
import { createProject, createDescription, createStatement } from '$lib/types/profile';

// ── Types ───────────────────────────────────────────────────────

/** A row object with DCTAP column keys. */
export interface DctapRow {
	shapeID?: string;
	shapeLabel?: string;
	propertyID?: string;
	propertyLabel?: string;
	mandatory?: string;
	repeatable?: string;
	valueNodeType?: string;
	valueDataType?: string;
	valueConstraint?: string;
	valueConstraintType?: string;
	valueShape?: string;
	note?: string;
	[key: string]: string | undefined;
}

// ── Helper Functions ────────────────────────────────────────────

/**
 * Parses a boolean DCTAP field value.
 *
 * Recognises `TRUE`, `1`, `YES` (case-insensitive) as true;
 * `FALSE`, `0`, `NO` as false; empty/null as null.
 *
 * @param val - The DCTAP boolean string.
 * @returns True, false, or null if empty/unset.
 */
export function parseBool(val: string | null | undefined): boolean | null {
	if (val == null || String(val).trim() === '') return null;
	const v = String(val).trim().toUpperCase();
	return v === 'TRUE' || v === '1' || v === 'YES';
}

/**
 * Resolves Tapir `valueType` from a DCTAP `valueNodeType` string.
 *
 * @param nodeType - The DCTAP valueNodeType value.
 * @returns The Tapir ValueType, or empty string if unrecognised.
 */
export function fromValueNodeType(nodeType: string | undefined): ValueType {
	if (!nodeType) return '';
	const parts = String(nodeType).trim().split(/\s+/);
	switch (parts[0].toUpperCase()) {
		case 'IRI':
		case 'URI':
			return 'iri';
		case 'LITERAL':
			return 'literal';
		case 'BNODE':
			return 'bnode';
		default:
			return '';
	}
}

/**
 * Resolves Tapir constraint fields from DCTAP valueConstraint/Type.
 *
 * Maps DCTAP constraint types to the appropriate Tapir Statement fields,
 * **preserving** the original `constraintType` so that a round-trip
 * re-emits the same value (e.g. `languageTag`, `IRIstem`).
 *
 *   - `picklist` → `values` (comma-separated list)
 *   - `pattern` → `pattern`
 *   - `IRIstem` → `inScheme` (comma-separated stems)
 *   - `languageTag` → `values` (comma-separated tags)
 *   - `minInclusive` / `maxInclusive` / `minLength` / `maxLength` → `facets`
 *
 * Unknown constraint types are still honoured: their raw value is
 * stored in `constraint` alongside the original `constraintType`, so
 * DCTAP extensions survive a round-trip even if Tapir doesn't model them.
 *
 * @param constraint - The DCTAP valueConstraint value.
 * @param constraintType - The DCTAP valueConstraintType value.
 * @returns Partial statement fields to merge.
 */
export function fromValueConstraint(
	constraint: string,
	constraintType: string
): Partial<Pick<Statement, 'values' | 'pattern' | 'facets' | 'inScheme' | 'constraint' | 'constraintType'>> {
	if (!constraint) return {};
	const val = String(constraint).trim();
	if (!val) return {};

	if (!constraintType) {
		// No type declared: store the raw value so it round-trips.
		return { constraint: val };
	}

	const type = String(constraintType).trim();
	const lower = type.toLowerCase();

	switch (lower) {
		case 'picklist':
			return {
				values: val.split(',').map((v) => v.trim()).filter(Boolean),
				constraintType: 'picklist',
			};
		case 'pattern':
			return { pattern: val, constraintType: 'pattern' };
		case 'iristem':
			return {
				inScheme: val.split(',').map((v) => v.trim()).filter(Boolean),
				constraintType: 'IRIstem',
			};
		case 'languagetag':
			return {
				values: val.split(',').map((v) => v.trim()).filter(Boolean),
				constraintType: 'languageTag',
			};
		case 'mininclusive': {
			const n = Number(val);
			return Number.isNaN(n) ? { constraint: val, constraintType: type } : { facets: { MinInclusive: n }, constraintType: 'minInclusive' };
		}
		case 'maxinclusive': {
			const n = Number(val);
			return Number.isNaN(n) ? { constraint: val, constraintType: type } : { facets: { MaxInclusive: n }, constraintType: 'maxInclusive' };
		}
		case 'minlength': {
			const n = Number(val);
			return Number.isNaN(n) ? { constraint: val, constraintType: type } : { facets: { MinLength: n }, constraintType: 'minLength' };
		}
		case 'maxlength': {
			const n = Number(val);
			return Number.isNaN(n) ? { constraint: val, constraintType: type } : { facets: { MaxLength: n }, constraintType: 'maxLength' };
		}
		default:
			// Unknown DCTAP extension type — preserve verbatim.
			return { constraint: val, constraintType: type };
	}
}

/**
 * Generates a camelCase statement key from a propertyID.
 *
 * Extracts the local name from a prefixed term or IRI and converts
 * it to a camelCase identifier. Deduplicates against existing keys
 * by appending a numeric suffix.
 *
 * @param propertyID - The DCTAP propertyID value.
 * @param existingKeys - Set of already-used keys for deduplication.
 * @returns A unique camelCase key string.
 */
export function toStatementKey(propertyID: string, existingKeys: Set<string>): string {
	let local: string;

	if (propertyID.includes(':')) {
		const parts = propertyID.split(/[:#/]/);
		local = parts[parts.length - 1];
	} else {
		local = propertyID;
	}

	let key = local.charAt(0).toLowerCase() + local.slice(1);

	if (existingKeys.has(key)) {
		let suffix = 2;
		while (existingKeys.has(`${key}${suffix}`)) suffix++;
		key = `${key}${suffix}`;
	}

	existingKeys.add(key);
	return key;
}

// ── Main Converter ──────────────────────────────────────────────

/**
 * Converts DCTAP rows to a `TapirProject`.
 *
 * Handles the DCTAP convention where `shapeID` on a row introduces
 * a new shape, and subsequent rows with empty `shapeID` belong to
 * the same shape.
 *
 * @param rows - Array of row objects with DCTAP column keys.
 * @param projectName - Optional project name (defaults to `'Imported DCTAP'`).
 * @returns A `ParseResult` containing the project, warnings, and errors.
 *
 * @example
 * const result = dctapRowsToTapir(rows);
 * if (result.errors.length === 0) {
 *   console.log(result.data.descriptions);
 * }
 */
export function dctapRowsToTapir(
	rows: DctapRow[],
	projectName: string = 'Imported DCTAP'
): ParseResult<TapirProject> {
	const warnings: ParseMessage[] = [];
	const errors: ParseMessage[] = [];

	const descriptions: Description[] = [];
	const descMap = new Map<string, Description>();
	const usedKeysMap = new Map<string, Set<string>>();
	let currentShapeID: string | null = null;

	for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
		const row = rows[rowIndex];
		const shapeID = String(row.shapeID || '').trim();
		const propertyID = String(row.propertyID || '').trim();

		// New shape introduced
		if (shapeID) {
			currentShapeID = shapeID;
			if (!descMap.has(currentShapeID)) {
				const label = String(row.shapeLabel || '').trim();
				const desc = createDescription({ name: currentShapeID });
				if (label) desc.label = label;
				if (!propertyID) {
					const note = String(row.note || '').trim();
					if (note) desc.note = note;
				}
				descMap.set(currentShapeID, desc);
				usedKeysMap.set(currentShapeID, new Set<string>());
				descriptions.push(desc);
			}
		}

		// Assign default shape if no shapeID seen yet
		if (!currentShapeID && propertyID) {
			currentShapeID = 'default';
			if (!descMap.has(currentShapeID)) {
				const desc = createDescription({ name: currentShapeID });
				descMap.set(currentShapeID, desc);
				usedKeysMap.set(currentShapeID, new Set<string>());
				descriptions.push(desc);
			}
		}

		if (!currentShapeID || !propertyID) continue;

		// Ensure the description exists (for edge cases)
		if (!descMap.has(currentShapeID)) {
			const desc = createDescription({ name: currentShapeID });
			descMap.set(currentShapeID, desc);
			usedKeysMap.set(currentShapeID, new Set<string>());
			descriptions.push(desc);
		}

		const desc = descMap.get(currentShapeID)!;
		const usedKeys = usedKeysMap.get(currentShapeID)!;
		const stmtKey = toStatementKey(propertyID, usedKeys);

		const stmt = createStatement({ id: stmtKey });
		stmt.propertyId = propertyID;

		// Property label
		const propertyLabel = String(row.propertyLabel || '').trim();
		if (propertyLabel) stmt.label = propertyLabel;

		// Value node type
		const valueType = fromValueNodeType(row.valueNodeType);
		if (valueType) stmt.valueType = valueType;

		// Value data type
		const dataType = String(row.valueDataType || '').trim();
		if (dataType) stmt.datatype = dataType;

		// Cardinality
		const mandatory = parseBool(row.mandatory);
		const repeatable = parseBool(row.repeatable);
		if (mandatory != null) stmt.min = mandatory ? 1 : 0;
		if (repeatable != null) {
			stmt.max = repeatable ? null : 1;
		}

		// Shape reference(s). DCTAP's spec cardinality is "zero or one",
		// but DCMI's SRAP profile uses space-separated multi-shape as a
		// de-facto extension (e.g. "Person Organization"). We read both.
		const valueShape = String(row.valueShape || '').trim();
		if (valueShape) {
			stmt.shapeRefs = valueShape.split(/\s+/).filter(Boolean);
		}

		// Value constraints
		const constraints = fromValueConstraint(
			row.valueConstraint || '',
			row.valueConstraintType || ''
		);
		if (constraints.values) stmt.values = constraints.values;
		if (constraints.pattern) stmt.pattern = constraints.pattern;
		if (constraints.facets) stmt.facets = constraints.facets;
		if (constraints.inScheme) stmt.inScheme = constraints.inScheme;
		if (constraints.constraint) stmt.constraint = constraints.constraint;
		if (constraints.constraintType) stmt.constraintType = constraints.constraintType;

		// Note
		const note = String(row.note || '').trim();
		if (note) stmt.note = note;

		desc.statements.push(stmt);
	}

	if (rows.length > 0 && descriptions.length === 0) {
		warnings.push({ message: 'No shapes found in DCTAP rows' });
	}

	const project = createProject({
		name: projectName,
		flavor: 'dctap',
		descriptions,
	});

	return { data: project, warnings, errors };
}
