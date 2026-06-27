/**
 * @fileoverview Shared helpers for the multi-valued `Statement.valueType`.
 *
 * `valueType` is a list of node-kind alternatives (logical OR): a value
 * may be any of `iri`, `literal`, or `bnode`. An empty list means
 * unspecified. These helpers replace the hand-rolled `=== 'iri'`
 * comparisons that single-value code used, so converters and validators
 * read the list consistently.
 *
 * @module utils/value-type
 */

import type { Statement, ValueType } from '$lib/types';

// ── Order + Read Helpers ────────────────────────────────────────

/**
 * Canonical render/serialise order for value types. Authored DCTAP
 * cells follow it (`IRI BNODE`, `IRI literal`), and it doubles as the
 * precedence for lossy single-value targets (SimpleDSP, Frictionless).
 */
export const VALUE_TYPE_ORDER: readonly ValueType[] = ['iri', 'literal', 'bnode'];

/**
 * Tests whether a statement declares a given value type.
 *
 * @param stmt - The statement to inspect.
 * @param kind - The value type to look for.
 * @returns `true` when `kind` is among the statement's value types.
 *
 * @example
 * hasValueType(stmt, 'iri') // => true when valueType includes 'iri'
 */
export function hasValueType(stmt: Statement, kind: ValueType): boolean {
	return stmt.valueType.includes(kind);
}

/**
 * Returns the single representative value type for formats that cannot
 * express alternatives (SimpleDSP, Frictionless, the diagram labels).
 *
 * Picks the first type in {@link VALUE_TYPE_ORDER} that is present, so a
 * `['literal','iri']` list and an `['iri','literal']` list both collapse
 * to `iri`. Returns `''` when the list is empty (unspecified).
 *
 * @param stmt - The statement to inspect.
 * @returns The dominant value type, or `''` when unspecified.
 */
export function primaryValueType(stmt: Statement): ValueType | '' {
	for (const t of VALUE_TYPE_ORDER) {
		if (stmt.valueType.includes(t)) return t;
	}
	return '';
}

/** True when the statement declares no value type. */
export function valueTypeUnset(stmt: Statement): boolean {
	return stmt.valueType.length === 0;
}

// ── Token Parsing + Normalisation ───────────────────────────────

/**
 * Maps one DCTAP/YAMA node-kind token to a Tapir value type.
 *
 * Case-insensitive; `URI` is accepted as a synonym for `IRI`. Returns
 * `null` for unrecognised tokens so callers can skip them.
 *
 * @param token - A single node-kind token (e.g. `IRI`, `bnode`).
 * @returns The value type, or `null` when unrecognised.
 */
export function tokenToValueType(token: string): ValueType | null {
	switch (token.trim().toUpperCase()) {
		case 'IRI':
		case 'URI':
			return 'iri';
		case 'LITERAL':
			return 'literal';
		case 'BNODE':
			return 'bnode';
		default:
			return null;
	}
}

/**
 * Parses a whitespace-separated node-kind cell into value types.
 *
 * Unrecognised tokens are dropped, and duplicates are de-duplicated
 * while keeping first-seen order. Mirrors how `datatype`/`shapeRefs`
 * parse space-separated cells.
 *
 * @param cell - The raw cell text (e.g. `"IRI BNODE"`).
 * @returns The parsed value types (empty when none recognised).
 *
 * @example
 * parseValueTypeTokens('IRI BNODE') // => ['iri', 'bnode']
 * parseValueTypeTokens('IRI literal') // => ['iri', 'literal']
 */
export function parseValueTypeTokens(cell: string | undefined): ValueType[] {
	if (!cell) return [];
	const out: ValueType[] = [];
	for (const tok of String(cell).trim().split(/\s+/).filter(Boolean)) {
		const vt = tokenToValueType(tok);
		if (vt && !out.includes(vt)) out.push(vt);
	}
	return out;
}

/**
 * Coerces a possibly-scalar, possibly-legacy input into a value-type
 * list — back-compat for persisted projects and YAML that may carry a
 * single string, an array, or the old empty-string sentinel.
 *
 * @param raw - A scalar value type, an array, or undefined.
 * @returns A normalised value-type list (de-duplicated, no empties).
 */
export function normaliseValueTypes(
	raw: ValueType | string | readonly (ValueType | string)[] | undefined | null
): ValueType[] {
	if (raw == null) return [];
	const items = Array.isArray(raw) ? raw : [raw];
	const out: ValueType[] = [];
	for (const item of items) {
		const vt = tokenToValueType(String(item));
		if (vt && !out.includes(vt)) out.push(vt);
	}
	return out;
}

// ── Serialisation ───────────────────────────────────────────────

/** DCTAP node-kind spellings (IRI uppercase, literal/bnode lowercase). */
const DCTAP_TOKEN: Record<ValueType, string> = {
	iri: 'IRI',
	literal: 'literal',
	bnode: 'bnode',
};

/**
 * Serialises a value-type list to a DCTAP `valueNodeType` cell, in
 * canonical order, space-separated. Empty list → empty cell.
 *
 * @param types - The value types to serialise.
 * @returns The DCTAP cell string (e.g. `"IRI BNODE"`).
 */
export function formatValueNodeType(types: readonly ValueType[]): string {
	return ordered(types)
		.map((t) => DCTAP_TOKEN[t])
		.join(' ');
}

/** Returns the list re-ordered into canonical {@link VALUE_TYPE_ORDER}. */
export function ordered(types: readonly ValueType[]): ValueType[] {
	return VALUE_TYPE_ORDER.filter((t) => types.includes(t));
}
