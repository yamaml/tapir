import { describe, it, expect } from 'vitest';
import {
	hasValueType,
	primaryValueType,
	valueTypeUnset,
	tokenToValueType,
	parseValueTypeTokens,
	normaliseValueTypes,
	formatValueNodeType,
	ordered,
} from '$lib/utils/value-type';
import { createStatement } from '$lib/types';
import type { Statement } from '$lib/types';

function stmt(init?: Partial<Statement>): Statement {
	return createStatement(init);
}

// ── Read helpers ────────────────────────────────────────────────

describe('hasValueType', () => {
	it('tests membership of a node kind', () => {
		const s = stmt({ valueType: ['iri', 'bnode'] });
		expect(hasValueType(s, 'iri')).toBe(true);
		expect(hasValueType(s, 'bnode')).toBe(true);
		expect(hasValueType(s, 'literal')).toBe(false);
	});
});

describe('primaryValueType', () => {
	it('returns the dominant kind in canonical order (iri > literal > bnode)', () => {
		expect(primaryValueType(stmt({ valueType: ['literal', 'iri'] }))).toBe('iri');
		expect(primaryValueType(stmt({ valueType: ['bnode', 'literal'] }))).toBe('literal');
		expect(primaryValueType(stmt({ valueType: ['bnode'] }))).toBe('bnode');
	});

	it('returns "" when unspecified', () => {
		expect(primaryValueType(stmt())).toBe('');
	});
});

describe('valueTypeUnset', () => {
	it('is true only for an empty list', () => {
		expect(valueTypeUnset(stmt())).toBe(true);
		expect(valueTypeUnset(stmt({ valueType: ['iri'] }))).toBe(false);
	});
});

// ── Token parsing ───────────────────────────────────────────────

describe('tokenToValueType', () => {
	it('maps each spelling case-insensitively, URI as iri', () => {
		expect(tokenToValueType('IRI')).toBe('iri');
		expect(tokenToValueType('uri')).toBe('iri');
		expect(tokenToValueType('LITERAL')).toBe('literal');
		expect(tokenToValueType('bnode')).toBe('bnode');
		expect(tokenToValueType('nope')).toBeNull();
	});
});

describe('parseValueTypeTokens', () => {
	it('parses a whitespace cell, dropping unknowns and duplicates', () => {
		expect(parseValueTypeTokens('IRI BNODE')).toEqual(['iri', 'bnode']);
		expect(parseValueTypeTokens('IRI iri literal')).toEqual(['iri', 'literal']);
		expect(parseValueTypeTokens('IRI nope')).toEqual(['iri']);
		expect(parseValueTypeTokens('')).toEqual([]);
		expect(parseValueTypeTokens(undefined)).toEqual([]);
	});
});

describe('normaliseValueTypes', () => {
	it('coerces scalar, array, and legacy inputs to a clean list', () => {
		expect(normaliseValueTypes('iri')).toEqual(['iri']);
		expect(normaliseValueTypes(['IRI', 'BNODE'])).toEqual(['iri', 'bnode']);
		expect(normaliseValueTypes('')).toEqual([]);
		expect(normaliseValueTypes('structured')).toEqual([]);
		expect(normaliseValueTypes(undefined)).toEqual([]);
		expect(normaliseValueTypes(null)).toEqual([]);
	});
});

// ── Serialisation ───────────────────────────────────────────────

describe('formatValueNodeType', () => {
	it('serialises in canonical order with DCTAP casing', () => {
		expect(formatValueNodeType(['bnode', 'iri'])).toBe('IRI bnode');
		expect(formatValueNodeType(['iri', 'literal'])).toBe('IRI literal');
		expect(formatValueNodeType([])).toBe('');
	});
});

describe('ordered', () => {
	it('reorders into canonical order', () => {
		expect(ordered(['bnode', 'literal', 'iri'])).toEqual(['iri', 'literal', 'bnode']);
	});
});
