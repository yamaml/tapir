import { describe, it, expect } from 'vitest';
import {
	displayValueType,
	parseValueTypeCell,
	valueTypeSelectionUpdates,
	parseSimpleDspConstraintCell,
	parseDctapConstraintCell,
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
		expect(displayValueType(stmt({ valueType: 'iri', classConstraint: ['foaf:Person'] }))).toBe(
			'structured'
		);
	});

	it('tolerates legacy records that stored "structured" in valueType', () => {
		const legacy = stmt();
		(legacy as unknown as { valueType: string }).valueType = 'structured';
		expect(displayValueType(legacy)).toBe('structured');
	});

	it('passes through stored value types', () => {
		expect(displayValueType(stmt({ valueType: 'literal' }))).toBe('literal');
		expect(displayValueType(stmt({ valueType: 'iri' }))).toBe('iri');
		expect(displayValueType(stmt())).toBe('');
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
		expect(updates.valueType).toBe('');
		expect(updates.datatype).toEqual([]);
		// structural fields must be left alone so existing refs survive
		expect('shapeRefs' in updates).toBe(false);
		expect('classConstraint' in updates).toBe(false);
	});

	it('clears structural refs when a concrete type is chosen', () => {
		const updates = valueTypeSelectionUpdates('literal');
		expect(updates.valueType).toBe('literal');
		expect(updates.shapeRefs).toEqual([]);
		expect(updates.classConstraint).toEqual([]);
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
		const s = stmt({ valueType: 'iri', classConstraint: ['foaf:Agent'] });
		const updates = parseSimpleDspConstraintCell('foaf:Person foaf:Organization', s);
		expect(updates.classConstraint).toEqual(['foaf:Person', 'foaf:Organization']);
		expect(updates.valueType).toBe('iri');
		expect(updates.shapeRefs).toEqual([]);
	});

	it('parses datatypes for literal statements', () => {
		const s = stmt({ valueType: 'literal' });
		const updates = parseSimpleDspConstraintCell('xsd:decimal xsd:integer', s);
		expect(updates.datatype).toEqual(['xsd:decimal', 'xsd:integer']);
		expect(updates.values).toEqual([]);
	});

	it('parses quoted values for literal statements into values', () => {
		const s = stmt({ valueType: 'literal' });
		const updates = parseSimpleDspConstraintCell('"red" "green" "say ""hi"""', s);
		expect(updates.values).toEqual(['red', 'green', 'say "hi"']);
		expect(updates.datatype).toEqual([]);
	});

	it('routes IRI stems (prefix: or trailing /) into inScheme', () => {
		const s = stmt({ valueType: 'iri' });
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
		const s = stmt({ valueType: 'iri' });
		const updates = parseSimpleDspConstraintCell('card:VISA card:AMEX', s);
		expect(updates.values).toEqual(['card:VISA', 'card:AMEX']);
		expect(updates.inScheme).toEqual([]);
	});

	it('clears every constraint field when the cell is emptied', () => {
		const s = stmt({ valueType: 'iri', inScheme: ['ndlsh:'] });
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
		const s = stmt({ valueType: 'iri', inScheme: ['ndlsh:'] });
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
