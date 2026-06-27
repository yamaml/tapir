import { describe, it, expect } from 'vitest';
import {
	displayValueType,
	displayValueTypes,
	parseValueTypeCell,
	parseValueTypeCellList,
	valueTypeSelectionUpdates,
	parseSimpleDspConstraintCell,
	parseDctapConstraintCell,
	commitCellEdit,
} from '$lib/utils/editor-cells';
import { createStatement } from '$lib/types';
import type { Statement } from '$lib/types';

// ── Fixtures ────────────────────────────────────────────────────

function stmt(init?: Partial<Statement>): Statement {
	return createStatement(init);
}

// ── displayValueType ────────────────────────────────────────────

describe('displayValueType', () => {
	it('derives structured from shapeRefs', () => {
		expect(displayValueType(stmt({ shapeRefs: ['Agent'] }))).toBe('structured');
	});

	it('derives structured from classConstraint', () => {
		expect(displayValueType(stmt({ valueType: ['iri'], classConstraint: ['foaf:Person'] }))).toBe(
			'structured'
		);
	});

	it('passes through the dominant stored value type', () => {
		expect(displayValueType(stmt({ valueType: ['literal'] }))).toBe('literal');
		expect(displayValueType(stmt({ valueType: ['iri'] }))).toBe('iri');
		expect(displayValueType(stmt())).toBe('');
		// Dominant token precedence: iri wins over literal.
		expect(displayValueType(stmt({ valueType: ['literal', 'iri'] }))).toBe('iri');
	});
});

// ── displayValueTypes (multi) ───────────────────────────────────

describe('displayValueTypes', () => {
	it('returns the stored node kinds in canonical order', () => {
		expect(displayValueTypes(stmt({ valueType: ['bnode', 'iri'] }))).toEqual(['iri', 'bnode']);
		expect(displayValueTypes(stmt({ valueType: ['literal'] }))).toEqual(['literal']);
		expect(displayValueTypes(stmt())).toEqual([]);
	});

	it('returns ["structured"] when refs/classes are present (SimpleDSP)', () => {
		expect(displayValueTypes(stmt({ shapeRefs: ['Agent'] }))).toEqual(['structured']);
		expect(displayValueTypes(stmt({ valueType: ['iri'], classConstraint: ['foaf:Person'] }))).toEqual(
			['structured']
		);
	});

	it('keeps the stored node kinds for DCTAP even alongside shape refs', () => {
		// DCTAP valueNodeType and valueShape are independent columns, so a
		// statement can carry "IRI BNODE" *and* a valueShape — the chips
		// must still show the node kinds, never collapse to structured.
		expect(
			displayValueTypes(stmt({ valueType: ['iri', 'bnode'], shapeRefs: ['Person'] }), 'dctap')
		).toEqual(['iri', 'bnode']);
		expect(displayValueTypes(stmt({ shapeRefs: ['Person'] }), 'dctap')).toEqual([]);
	});
});

// ── parseValueTypeCell ──────────────────────────────────────────

describe('parseValueTypeCell', () => {
	it('parses English spellings', () => {
		expect(parseValueTypeCell('literal')).toBe('literal');
		expect(parseValueTypeCell('IRI')).toBe('iri');
		expect(parseValueTypeCell('URI')).toBe('iri');
		expect(parseValueTypeCell('bnode')).toBe('bnode');
		expect(parseValueTypeCell('structured')).toBe('structured');
		expect(parseValueTypeCell('')).toBe('');
	});

	it('parses the Japanese labels back to internal value types', () => {
		expect(parseValueTypeCell('文字列')).toBe('literal');
		expect(parseValueTypeCell('参照値')).toBe('iri');
		expect(parseValueTypeCell('参照値(URI)')).toBe('iri');
		expect(parseValueTypeCell('構造化')).toBe('structured');
		expect(parseValueTypeCell('制約なし')).toBe('');
	});

	it('parses editor placeholders as empty', () => {
		expect(parseValueTypeCell('(no constraint)')).toBe('');
		expect(parseValueTypeCell('(none)')).toBe('');
		expect(parseValueTypeCell('(empty)')).toBe('');
	});

	it('returns null for unrecognised input (caller must not wipe)', () => {
		expect(parseValueTypeCell('typo')).toBeNull();
		expect(parseValueTypeCell('ID')).toBeNull();
	});
});

// ── valueTypeSelectionUpdates ───────────────────────────────────

describe('valueTypeSelectionUpdates', () => {
	it('never stores "structured" in valueType', () => {
		const updates = valueTypeSelectionUpdates('structured');
		expect(updates.valueType).toEqual([]);
		expect(updates.datatype).toEqual([]);
		// structural fields must be left alone so existing refs survive
		expect('shapeRefs' in updates).toBe(false);
		expect('classConstraint' in updates).toBe(false);
	});

	it('clears structural refs when a concrete type is chosen', () => {
		const updates = valueTypeSelectionUpdates('literal');
		expect(updates.valueType).toEqual(['literal']);
		expect(updates.shapeRefs).toEqual([]);
		expect(updates.classConstraint).toEqual([]);
	});

	it('stores a multi-kind selection in canonical order', () => {
		const updates = valueTypeSelectionUpdates(['bnode', 'iri']);
		expect(updates.valueType).toEqual(['iri', 'bnode']);
		expect(updates.shapeRefs).toEqual([]);
	});

	it('clears the value type for an empty selection', () => {
		const updates = valueTypeSelectionUpdates([]);
		expect(updates.valueType).toEqual([]);
	});

	it('for DCTAP, never touches shapeRefs/classConstraint (independent columns)', () => {
		// valueNodeType and valueShape are independent DCTAP columns, so
		// changing the node kind must not wipe the shape ref.
		const updates = valueTypeSelectionUpdates(['iri', 'bnode'], 'dctap');
		expect(updates.valueType).toEqual(['iri', 'bnode']);
		expect('shapeRefs' in updates).toBe(false);
		expect('classConstraint' in updates).toBe(false);
	});

	it('for SimpleDSP, clears refs on a node-kind selection (structured is exclusive)', () => {
		const updates = valueTypeSelectionUpdates(['iri'], 'simpledsp');
		expect(updates.valueType).toEqual(['iri']);
		expect(updates.shapeRefs).toEqual([]);
		expect(updates.classConstraint).toEqual([]);
	});
});

// ── parseValueTypeCellList ──────────────────────────────────────

describe('parseValueTypeCellList', () => {
	it('parses a multi-token cell into node kinds', () => {
		expect(parseValueTypeCellList('IRI BNODE')).toEqual(['iri', 'bnode']);
		expect(parseValueTypeCellList('IRI literal')).toEqual(['iri', 'literal']);
	});

	it('parses a single token, preserving structured and empty', () => {
		expect(parseValueTypeCellList('literal')).toEqual(['literal']);
		expect(parseValueTypeCellList('structured')).toEqual(['structured']);
		expect(parseValueTypeCellList('')).toEqual(['']);
	});

	it('returns null when any token is unrecognised (caller must not wipe)', () => {
		expect(parseValueTypeCellList('IRI typo')).toBeNull();
	});
});

// ── parseSimpleDspConstraintCell ────────────────────────────────

describe('parseSimpleDspConstraintCell', () => {
	it('parses #refs into shapeRefs (single and multi)', () => {
		const updates = parseSimpleDspConstraintCell('#Agent #Org', stmt());
		expect(updates.shapeRefs).toEqual(['Agent', 'Org']);
		expect(updates.constraint).toBe('');
		expect(updates.datatype).toEqual([]);
	});

	it('parses classes for structured statements into classConstraint', () => {
		const s = stmt({ valueType: ['iri'], classConstraint: ['foaf:Agent'] });
		const updates = parseSimpleDspConstraintCell('foaf:Person foaf:Organization', s);
		expect(updates.classConstraint).toEqual(['foaf:Person', 'foaf:Organization']);
		expect(updates.valueType).toEqual(['iri']);
		expect(updates.shapeRefs).toEqual([]);
	});

	it('parses datatypes for literal statements', () => {
		const s = stmt({ valueType: ['literal'] });
		const updates = parseSimpleDspConstraintCell('xsd:decimal xsd:integer', s);
		expect(updates.datatype).toEqual(['xsd:decimal', 'xsd:integer']);
		expect(updates.values).toEqual([]);
	});

	it('parses quoted values for literal statements into values', () => {
		const s = stmt({ valueType: ['literal'] });
		const updates = parseSimpleDspConstraintCell('"red" "green" "say ""hi"""', s);
		expect(updates.values).toEqual(['red', 'green', 'say "hi"']);
		expect(updates.datatype).toEqual([]);
	});

	it('routes IRI stems (prefix: or trailing /) into inScheme', () => {
		const s = stmt({ valueType: ['iri'] });
		const updates = parseSimpleDspConstraintCell(
			'ndlsh: https://id.loc.gov/authorities/subjects/',
			s
		);
		expect(updates.inScheme).toEqual([
			'ndlsh:',
			'https://id.loc.gov/authorities/subjects/',
		]);
		expect(updates.values).toEqual([]);
	});

	it('routes enumerated IRIs (no stem marker) into values', () => {
		const s = stmt({ valueType: ['iri'] });
		const updates = parseSimpleDspConstraintCell('card:VISA card:AMEX', s);
		expect(updates.values).toEqual(['card:VISA', 'card:AMEX']);
		expect(updates.inScheme).toEqual([]);
	});

	it('clears every constraint field when the cell is emptied', () => {
		const s = stmt({ valueType: ['iri'], inScheme: ['ndlsh:'] });
		const updates = parseSimpleDspConstraintCell('', s);
		expect(updates).toMatchObject({
			shapeRefs: [],
			classConstraint: [],
			datatype: [],
			inScheme: [],
			values: [],
			constraint: '',
		});
	});

	it('round-trips: a cell composed from inScheme parses back to inScheme', () => {
		// The display value for inScheme ['ndlsh:'] is "ndlsh:"; committing
		// that exact text must not move the data into `constraint`.
		const s = stmt({ valueType: ['iri'], inScheme: ['ndlsh:'] });
		const updates = parseSimpleDspConstraintCell('ndlsh:', s);
		expect(updates.inScheme).toEqual(['ndlsh:']);
		expect(updates.constraint).toBe('');
	});

	it('reads untyped-row cells as datatypes (parser parity)', () => {
		const updates = parseSimpleDspConstraintCell('xsd:string', stmt());
		expect(updates.datatype).toEqual(['xsd:string']);
	});
});

// ── parseDctapConstraintCell ────────────────────────────────────

describe('parseDctapConstraintCell', () => {
	it('parses picklist values per constraintType', () => {
		const s = stmt({ constraintType: 'picklist' });
		const updates = parseDctapConstraintCell('red,green,blue', s);
		expect(updates.values).toEqual(['red', 'green', 'blue']);
		expect(updates.constraint).toBe('');
	});

	it('parses IRIstem into inScheme', () => {
		const s = stmt({ constraintType: 'IRIstem' });
		const updates = parseDctapConstraintCell('https://id.loc.gov/authorities/', s);
		expect(updates.inScheme).toEqual(['https://id.loc.gov/authorities/']);
		expect(updates.values).toEqual([]);
	});

	it('parses pattern into pattern', () => {
		const s = stmt({ constraintType: 'pattern' });
		const updates = parseDctapConstraintCell('^[0-9]{4}$', s);
		expect(updates.pattern).toBe('^[0-9]{4}$');
	});

	it('parses numeric facets', () => {
		const s = stmt({ constraintType: 'minInclusive' });
		const updates = parseDctapConstraintCell('1900', s);
		expect(updates.facets).toEqual({ MinInclusive: 1900 });
	});

	it('keeps non-numeric facet input in constraint instead of dropping it', () => {
		const s = stmt({ constraintType: 'maxLength' });
		const updates = parseDctapConstraintCell('lots', s);
		expect(updates.constraint).toBe('lots');
		expect(updates.facets).toEqual({});
	});

	it('passes untyped constraints through verbatim', () => {
		const updates = parseDctapConstraintCell('anything goes', stmt());
		expect(updates).toEqual({ constraint: 'anything goes' });
	});
});

// ── commitCellEdit ──────────────────────────────────────────────

describe('commitCellEdit', () => {
	it('is a no-op when the value is unchanged', () => {
		const s = stmt({ valueType: ['literal'], datatype: ['xsd:date'] });
		const result = commitCellEdit(s, 'constraint', 'xsd:date', 'xsd:date', 'simpledsp');
		expect(result.updates).toBeNull();
		expect(result.openConstraintPopover).toBe(false);
	});

	it('is a no-op for unrecognised value-type input', () => {
		const s = stmt({ valueType: ['literal'] });
		const result = commitCellEdit(s, 'valueType', 'typo', 'literal', 'simpledsp');
		expect(result.updates).toBeNull();
	});

	// — SimpleDSP constraint cell routes —

	it('routes a SimpleDSP #ref constraint to shapeRefs', () => {
		const s = stmt({ valueType: [] });
		const result = commitCellEdit(s, 'constraint', '#Agent', '', 'simpledsp');
		expect(result.updates).toMatchObject({ shapeRefs: ['Agent'] });
	});

	it('routes a SimpleDSP literal-row constraint to datatype', () => {
		const s = stmt({ valueType: ['literal'] });
		const result = commitCellEdit(s, 'constraint', 'xsd:date xsd:gYear', '', 'simpledsp');
		expect(result.updates).toMatchObject({ datatype: ['xsd:date', 'xsd:gYear'] });
	});

	it('routes a SimpleDSP iri-row stem constraint to inScheme', () => {
		const s = stmt({ valueType: ['iri'] });
		const result = commitCellEdit(s, 'constraint', 'dcterms:', '', 'simpledsp');
		expect(result.updates).toMatchObject({ inScheme: ['dcterms:'], values: [] });
	});

	// — DCTAP cell routes —

	it('maps DCTAP mandatory TRUE/FALSE/cleared to min', () => {
		const s = stmt();
		expect(commitCellEdit(s, 'min', 'TRUE', '', 'dctap').updates).toEqual({ min: 1 });
		expect(commitCellEdit(s, 'min', 'FALSE', '', 'dctap').updates).toEqual({ min: 0 });
		expect(commitCellEdit(s, 'min', '', 'TRUE', 'dctap').updates).toEqual({ min: undefined });
	});

	it('maps DCTAP repeatable TRUE/FALSE/cleared to tri-state max', () => {
		const s = stmt();
		expect(commitCellEdit(s, 'max', 'TRUE', '', 'dctap').updates).toEqual({ max: null });
		expect(commitCellEdit(s, 'max', 'FALSE', '', 'dctap').updates).toEqual({ max: 1 });
		expect(commitCellEdit(s, 'max', '', 'FALSE', 'dctap').updates).toEqual({ max: undefined });
	});

	it('routes the DCTAP constraint cell per constraintType', () => {
		const s = stmt({ constraintType: 'picklist' });
		const result = commitCellEdit(s, 'constraint', 'a,b', '', 'dctap');
		expect(result.updates).toMatchObject({ values: ['a', 'b'] });
	});

	it('splits a DCTAP valueDataType edit on whitespace', () => {
		const s = stmt();
		const result = commitCellEdit(s, 'datatype', 'xsd:date  edtf:EDTF', '', 'dctap');
		expect(result.updates).toEqual({ datatype: ['xsd:date', 'edtf:EDTF'] });
	});

	// — SimpleDSP numeric cardinality + structured popover —

	it('parses SimpleDSP numeric min/max and unsets on empty', () => {
		const s = stmt();
		expect(commitCellEdit(s, 'min', '2', '', 'simpledsp').updates).toEqual({ min: 2 });
		expect(commitCellEdit(s, 'max', '', '3', 'simpledsp').updates).toEqual({ max: undefined });
	});

	it('asks to open the constraint popover for structured with no refs yet', () => {
		const s = stmt({ valueType: [], shapeRefs: [], classConstraint: [] });
		const result = commitCellEdit(s, 'valueType', 'structured', '', 'simpledsp');
		expect(result.openConstraintPopover).toBe(true);
		expect(result.updates).toEqual({ valueType: [], datatype: [] });
	});

	it('does not open the popover when refs already exist', () => {
		const s = stmt({ shapeRefs: ['Agent'] });
		const result = commitCellEdit(s, 'valueType', 'structured', '', 'simpledsp');
		expect(result.openConstraintPopover).toBe(false);
	});

	it('writes plain string fields directly', () => {
		const s = stmt();
		const result = commitCellEdit(s, 'note', 'a comment', '', 'simpledsp');
		expect(result.updates).toEqual({ note: 'a comment' });
	});
});
