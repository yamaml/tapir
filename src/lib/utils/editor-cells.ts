/**
 * @fileoverview Shared cell↔model mapping for the table editors.
 *
 * The Raw Table and Smart Table render *composed* display values
 * (localized value types, the single SimpleDSP Constraint column) that
 * must be parsed back into the structured Statement fields on commit.
 * These pure functions centralise that mapping so all three editor
 * modes agree, and so it can be unit-tested without component mounts.
 *
 * Key invariant (types/profile.ts): `'structured'` is a *display*
 * value type derived from `shapeRefs`/`classConstraint` presence — it
 * is never stored in `Statement.valueType`.
 *
 * @module utils/editor-cells
 */

import type { Statement, ValueType } from '$lib/types';
import { parseQuotedValues } from '$lib/converters/simpledsp-parser';

// ── Value Type Display + Parsing ────────────────────────────────

/** Display-level value type: the internal union plus derived 'structured'. */
export type DisplayValueType = ValueType | 'structured';

/**
 * Resolves the display value type for a statement.
 *
 * `structured` is derived from `shapeRefs`/`classConstraint` presence
 * (and tolerated for legacy records that stored the out-of-union
 * string); everything else is the stored `valueType`.
 *
 * @param stmt - The statement to inspect.
 * @returns The display value type.
 */
export function displayValueType(stmt: Statement): DisplayValueType {
	if (stmt.shapeRefs && stmt.shapeRefs.length > 0) return 'structured';
	if (stmt.classConstraint && stmt.classConstraint.length > 0) return 'structured';
	if ((stmt.valueType as string) === 'structured') return 'structured'; // legacy tolerance
	return stmt.valueType;
}

/**
 * Recognised value-type spellings → display value type. Keys are
 * lowercase; covers the internal names, SimpleDSP English labels,
 * the Japanese labels (文字列/参照値/構造化/制約なし), the `URI`
 * alias, and the editors' empty-state placeholders.
 */
const VALUE_TYPE_INPUTS: Record<string, DisplayValueType> = {
	'': '',
	literal: 'literal',
	'文字列': 'literal',
	iri: 'iri',
	uri: 'iri',
	reference: 'iri',
	'参照値': 'iri',
	'参照値(uri)': 'iri',
	bnode: 'bnode',
	structured: 'structured',
	'構造化': 'structured',
	'制約なし': '',
	'(no constraint)': '',
	'(none)': '',
	'(empty)': '',
};

/**
 * Parses a value-type cell input back to a display value type.
 *
 * @param input - The raw cell text (any of the recognised spellings).
 * @returns The display value type, or `null` when unrecognised — the
 *   caller should treat `null` as "leave the statement unchanged"
 *   rather than wiping the stored value.
 *
 * @example
 * parseValueTypeCell('文字列') // => 'literal'
 * parseValueTypeCell('IRI')    // => 'iri'
 * parseValueTypeCell('typo')   // => null
 */
export function parseValueTypeCell(input: string): DisplayValueType | null {
	const key = input.trim().toLowerCase();
	return key in VALUE_TYPE_INPUTS ? VALUE_TYPE_INPUTS[key] : null;
}

/**
 * Maps a value-type selection to the Statement updates to commit.
 *
 * Selecting `structured` clears the literal-side fields and keeps the
 * structural ones (`shapeRefs`/`classConstraint`) so the editor can
 * reveal their pickers — it never writes `'structured'` into
 * `valueType`. Any other selection stores the value type and drops
 * structural refs.
 *
 * @param selection - The chosen display value type.
 * @returns Partial statement updates for `updateStatement`.
 */
export function valueTypeSelectionUpdates(selection: DisplayValueType): Partial<Statement> {
	if (selection === 'structured') {
		return { valueType: '', datatype: [] };
	}
	return { valueType: selection, shapeRefs: [], classConstraint: [] };
}

// ── SimpleDSP Constraint Cell ───────────────────────────────────

/** All constraint-bearing fields, reset before applying one source. */
const CLEARED_CONSTRAINT_FIELDS: Partial<Statement> = {
	shapeRefs: [],
	classConstraint: [],
	datatype: [],
	inScheme: [],
	values: [],
	constraint: '',
};

/**
 * Parses a SimpleDSP Constraint-column cell back into structured
 * fields, using the same precedence the display composition uses
 * (`resolveSimpleDspConstraint`): `#refs` → shapeRefs; classes (for
 * structured rows) → classConstraint; datatypes (literal rows);
 * stems ending `:` or URIs ending `/`/`#` → inScheme; quoted values →
 * values. Exactly one source is set; the others are cleared so the
 * cell round-trips.
 *
 * @param text - The committed cell text.
 * @param stmt - The statement being edited (provides the value-type context).
 * @returns Partial statement updates for `updateStatement`.
 */
export function parseSimpleDspConstraintCell(
	text: string,
	stmt: Statement
): Partial<Statement> {
	const t = text.trim();
	if (!t) return { ...CLEARED_CONSTRAINT_FIELDS };

	if (t.startsWith('#')) {
		const refs = t
			.split(/\s+/)
			.filter((s) => s.startsWith('#'))
			.map((s) => s.slice(1))
			.filter(Boolean);
		return { ...CLEARED_CONSTRAINT_FIELDS, shapeRefs: refs };
	}

	const display = displayValueType(stmt);

	if (display === 'structured') {
		// Class constraint(s). The SimpleDSP parser stores these as
		// valueType 'iri' + classConstraint; mirror it here.
		return {
			...CLEARED_CONSTRAINT_FIELDS,
			valueType: 'iri',
			classConstraint: t.split(/\s+/).filter(Boolean),
		};
	}

	if (display === 'literal' || (display === '' && t.startsWith('"'))) {
		if (t.startsWith('"')) {
			return { ...CLEARED_CONSTRAINT_FIELDS, values: parseQuotedValues(t) };
		}
		// Space-separated datatype union (SimpleDSP spec §4.6 Table 16).
		return { ...CLEARED_CONSTRAINT_FIELDS, datatype: t.split(/\s+/).filter(Boolean) };
	}

	if (display === 'iri') {
		const raw = t.replace(/<([^>]+)>/g, '$1');
		const parts = raw.split(/\s+/).filter(Boolean);
		// Stems: prefix references ending with `:` or full namespace
		// URIs ending with `/`/`#` → inScheme; the rest are enumerated
		// IRI values. Same rule as the SimpleDSP parser's import path.
		const isStem = (p: string) =>
			p.endsWith(':') || (/^(https?|urn):/.test(p) && /[/#]$/.test(p));
		return {
			...CLEARED_CONSTRAINT_FIELDS,
			inScheme: parts.filter(isStem),
			values: parts.filter((p) => !isStem(p)),
		};
	}

	// Untyped row: the parser reads the cell as datatype(s), the only
	// constraint kind meaningful without a value type.
	return { ...CLEARED_CONSTRAINT_FIELDS, datatype: t.split(/\s+/).filter(Boolean) };
}

// ── DCTAP valueConstraint Cell ──────────────────────────────────

/**
 * Parses a DCTAP valueConstraint cell back into structured fields,
 * interpreted per the statement's `valueConstraintType` (DCTAP Primer:
 * the type defines the values in the constraint cell). Unknown or
 * absent types pass the text through to `constraint` verbatim, which
 * DCTAP allows and Tapir preserves on export.
 *
 * @param text - The committed cell text.
 * @param stmt - The statement being edited (provides `constraintType`).
 * @returns Partial statement updates for `updateStatement`.
 */
export function parseDctapConstraintCell(
	text: string,
	stmt: Statement
): Partial<Statement> {
	const t = text.trim();
	const type = (stmt.constraintType || '').toLowerCase();
	const splitCsv = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

	switch (type) {
		case 'picklist':
		case 'languagetag':
			return { values: splitCsv(t), inScheme: [], pattern: '', constraint: '' };
		case 'iristem':
			return { inScheme: splitCsv(t), values: [], pattern: '', constraint: '' };
		case 'pattern':
			return { pattern: t, values: [], inScheme: [], constraint: '' };
		case 'mininclusive':
		case 'maxinclusive':
		case 'minlength':
		case 'maxlength': {
			const n = Number(t);
			if (!t || Number.isNaN(n)) {
				// Not a number — keep the raw text in `constraint` so the
				// user's input is never silently discarded.
				return { facets: {}, values: [], inScheme: [], pattern: '', constraint: t };
			}
			const key =
				type === 'mininclusive' ? 'MinInclusive'
				: type === 'maxinclusive' ? 'MaxInclusive'
				: type === 'minlength' ? 'MinLength'
				: 'MaxLength';
			return { facets: { [key]: n }, values: [], inScheme: [], pattern: '', constraint: '' };
		}
		default:
			return { constraint: t };
	}
}
