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

import type { Flavor, Statement, ValueType } from '$lib/types';
import { parseQuotedValues } from '$lib/converters/simpledsp-parser';
import { VALUE_TYPE_ORDER } from './value-type';

/** Stored node kinds in canonical order (no derived `structured`). */
function nodeKinds(stmt: Statement): ValueType[] {
	return VALUE_TYPE_ORDER.filter((t) => stmt.valueType.includes(t));
}

// ── Value Type Display + Parsing ────────────────────────────────

/**
 * Display-level value type: one stored node kind, the empty-state `''`,
 * or the derived pseudo-type `structured`.
 */
export type DisplayValueType = ValueType | 'structured' | '';

/**
 * Resolves the display value types for a statement (multi-chip view).
 *
 * For SimpleDSP, `structured` is a display value type derived from
 * `shapeRefs`/`classConstraint` presence, mutually exclusive with the
 * stored node kinds — so a row with refs displays as `['structured']`.
 *
 * DCTAP has no `structured` concept: `valueNodeType` and `valueShape`
 * are independent columns, so a DCTAP statement can carry both a node
 * kind and a shape ref. There the stored node kinds are returned
 * verbatim, never collapsed to `structured`.
 *
 * An empty result means "no value type".
 *
 * @param stmt - The statement to inspect.
 * @param flavor - The active flavor (defaults to SimpleDSP semantics).
 * @returns The display value types (empty when none).
 */
export function displayValueTypes(
	stmt: Statement,
	flavor: Flavor = 'simpledsp'
): DisplayValueType[] {
	if (flavor === 'dctap') return nodeKinds(stmt);
	if (stmt.shapeRefs && stmt.shapeRefs.length > 0) return ['structured'];
	if (stmt.classConstraint && stmt.classConstraint.length > 0) return ['structured'];
	return nodeKinds(stmt);
}

/**
 * Resolves the single dominant display value type for a statement, for
 * the places that can only show one token (cell colour, the SimpleDSP
 * Constraint-cell parsing precedence).
 *
 * Precedence: `structured` (from refs/classes) → `iri` → `literal` →
 * `bnode` → `''` (none).
 *
 * @param stmt - The statement to inspect.
 * @returns The dominant display value type, or `''` when none.
 */
export function displayValueType(
	stmt: Statement,
	flavor: Flavor = 'simpledsp'
): DisplayValueType {
	const types = displayValueTypes(stmt, flavor);
	return types.length > 0 ? types[0] : '';
}

/**
 * Recognised value-type spellings → display value type. Keys are
 * lowercase; covers the internal names, SimpleDSP English labels,
 * the Japanese labels (文字列/参照値/構造化/制約なし), the `URI`
 * alias, and the editors' empty-state placeholders.
 *
 * The lowercase '参照値(uri)' key exists to cover case-folded
 * '参照値(URI)' display variants (inputs are lowercased before
 * lookup). Display paths currently emit plain '参照値' without the
 * suffix, so the key is purely defensive for pasted or legacy text.
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
 * Parses a whitespace-separated value-type cell (e.g. the Raw Table's
 * `"IRI BNODE"`) into a list of display value types.
 *
 * Each token is mapped through {@link parseValueTypeCell}; unrecognised
 * tokens make the whole parse fail (returns `null`) so a typo never
 * silently wipes part of the value, matching the single-token contract.
 * `structured` and `''` tokens are dropped from a multi-token list
 * (they are not real node kinds); a lone `''`/`structured` token is
 * preserved so clearing the cell still works.
 *
 * @param input - The raw cell text.
 * @returns The display value types, or `null` when any token is unrecognised.
 *
 * @example
 * parseValueTypeCellList('IRI BNODE') // => ['iri', 'bnode']
 * parseValueTypeCellList('')          // => ['']
 * parseValueTypeCellList('IRI typo')  // => null
 */
export function parseValueTypeCellList(input: string): DisplayValueType[] | null {
	const tokens = input.trim().split(/\s+/).filter(Boolean);
	if (tokens.length === 0) return [''];
	const parsed = tokens.map(parseValueTypeCell);
	if (parsed.some((p) => p === null)) return null;
	const types = parsed as DisplayValueType[];
	// A lone 'structured' or '' (clear) token is preserved as-is; in a
	// multi-token cell those pseudo-tokens are dropped, leaving only the
	// real node kinds (de-duplicated, first-seen order).
	if (types.length === 1) return types;
	const out: DisplayValueType[] = [];
	for (const t of types) {
		if (t && t !== 'structured' && !out.includes(t)) out.push(t);
	}
	return out;
}

/**
 * Maps a value-type selection (one display type or a list of them) to
 * the Statement updates to commit.
 *
 * Behaviour depends on flavour:
 *   - SimpleDSP: `structured` and the node kinds are mutually exclusive
 *     (`structured` is derived from `shapeRefs`/`classConstraint`).
 *     Selecting `structured` clears the node kinds and datatype; any
 *     node-kind selection clears the structural refs.
 *   - DCTAP: `valueNodeType` and `valueShape` are independent columns, so
 *     changing the node kind leaves `shapeRefs`/`classConstraint`
 *     untouched. There is no `structured` display type for DCTAP.
 *
 * `structured` is never written into `valueType`. Empty selections clear
 * the value type.
 *
 * @param selection - The chosen display value type(s).
 * @param flavor - The active flavour (defaults to SimpleDSP semantics).
 * @returns Partial statement updates for `updateStatement`.
 */
export function valueTypeSelectionUpdates(
	selection: DisplayValueType | DisplayValueType[],
	flavor: Flavor = 'simpledsp'
): Partial<Statement> {
	const list = Array.isArray(selection) ? selection : [selection];
	// Keep only real node kinds, in canonical order.
	const valueType = VALUE_TYPE_ORDER.filter((t) => list.includes(t));

	if (flavor === 'dctap') {
		// Node kind and valueShape coexist — never touch the refs here.
		return { valueType };
	}

	if (list.includes('structured')) {
		return { valueType: [], datatype: [] };
	}
	return { valueType, shapeRefs: [], classConstraint: [] };
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
		// valueType ['iri'] + classConstraint; mirror it here.
		return {
			...CLEARED_CONSTRAINT_FIELDS,
			valueType: ['iri'],
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

// ── Cell Commit Routing ─────────────────────────────────────────

/** Outcome of committing a Smart Table cell edit. */
export interface CellCommitResult {
	/** Updates for `updateStatement`, or `null` when nothing changes. */
	updates: Partial<Statement> | null;
	/**
	 * True when the SimpleDSP constraint popover should open: the user
	 * selected `structured` but the statement has no shape refs or
	 * class constraints yet, so the selection would otherwise display
	 * as empty.
	 */
	openConstraintPopover: boolean;
}

/**
 * Routes a committed Smart Table cell edit to Statement updates.
 *
 * Extracted from `smart-table-editor.svelte`'s `commitEdit` so the
 * per-field parsing (cardinality flags, localized value types, the
 * composed constraint cells) is pure and unit-testable. The component
 * applies `updates` via `updateStatement` and opens the constraint
 * popover when asked to.
 *
 * @param stmt - The statement being edited.
 * @param field - The Statement field the cell maps to.
 * @param value - The committed cell text.
 * @param originalValue - The cell text at edit start. Commits with
 *   `value === originalValue` are no-ops: blurring a cell whose
 *   display is composed (localized value types, the Constraint
 *   column) must never re-parse the display text and corrupt the
 *   source fields.
 * @param flavor - The active profile flavor.
 * @returns The updates to apply (or `null`) plus the popover directive.
 *
 * @example
 * commitCellEdit(stmt, 'min', 'TRUE', '', 'dctap');
 * // => { updates: { min: 1 }, openConstraintPopover: false }
 */
export function commitCellEdit(
	stmt: Statement,
	field: keyof Statement,
	value: string,
	originalValue: string,
	flavor: Flavor
): CellCommitResult {
	const noop: CellCommitResult = { updates: null, openConstraintPopover: false };
	const commit = (updates: Partial<Statement>): CellCommitResult => ({
		updates,
		openConstraintPopover: false,
	});

	// Unchanged → no-op. Without this, blurring a cell whose display
	// is composed (localized value types, the Constraint column)
	// would re-parse the display text and corrupt the source fields.
	if (value === originalValue) return noop;

	if (field === 'min') {
		if (flavor === 'dctap') {
			const upper = value.toUpperCase();
			if (upper === 'TRUE') return commit({ min: 1 });
			if (upper === 'FALSE') return commit({ min: 0 });
			// Cleared → undefined (unset)
			return commit({ min: undefined });
		}
		const n = value === '' ? undefined : parseInt(value, 10);
		return commit({ min: n != null && Number.isNaN(n) ? undefined : n });
	}

	if (field === 'max') {
		if (flavor === 'dctap') {
			// Tri-state max: TRUE → null (explicitly unbounded),
			// FALSE → 1, cleared → undefined (unset). Legacy stored
			// null values keep meaning "unbounded" — no migration.
			const upper = value.toUpperCase();
			if (upper === 'TRUE') return commit({ max: null });
			if (upper === 'FALSE') return commit({ max: 1 });
			return commit({ max: undefined });
		}
		const n = value === '' ? undefined : parseInt(value, 10);
		return commit({ max: n != null && Number.isNaN(n) ? undefined : n });
	}

	if (field === 'valueType') {
		// Parse display strings (EN + localized JP labels) back to the
		// internal value type via the shared mapping. A multi-token cell
		// (e.g. the Raw Table's "IRI BNODE") parses to a list.
		const parsed = parseValueTypeCellList(value);
		if (parsed === null) {
			// Unrecognised input never wipes the stored value.
			return noop;
		}
		// 'structured' can only arrive as a lone token (the list parser
		// drops it from a multi-token cell).
		const isStructured = parsed.length === 1 && parsed[0] === 'structured';
		return {
			updates: valueTypeSelectionUpdates(parsed, flavor),
			// 'structured' is derived from refs; with none set yet the
			// selection would otherwise display as empty, so the editor
			// opens the constraint popover for the user to pick a target.
			openConstraintPopover:
				isStructured &&
				flavor === 'simpledsp' &&
				!(stmt.shapeRefs?.length || stmt.classConstraint?.length),
		};
	}

	if (field === 'constraint') {
		// Parse the composed display back with the same precedence the
		// display used so a constraint sourced from
		// classConstraint/inScheme/values returns to its field instead
		// of being dumped into `constraint`/`datatype`.
		return commit(
			flavor === 'simpledsp'
				? parseSimpleDspConstraintCell(value, stmt)
				: parseDctapConstraintCell(value, stmt)
		);
	}

	if (field === 'datatype') {
		// Free-text edit of valueDataType: split on whitespace so
		// multi-datatype profiles (DCMI SRAP, SimpleDSP) survive a
		// commit-and-reopen round-trip.
		return commit({ datatype: value.split(/\s+/).filter(Boolean) });
	}

	return commit({ [field]: value } as Partial<Statement>);
}
