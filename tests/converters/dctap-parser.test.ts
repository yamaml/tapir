import { describe, it, expect } from 'vitest';
import {
	parseBool,
	fromValueNodeType,
	fromValueConstraint,
	toStatementKey,
	dctapRowsToTapir,
} from '$lib/converters/dctap-parser';
import type { DctapRow } from '$lib/converters/dctap-parser';

// ── parseBool ───────────────────────────────────────────────────

describe('parseBool', () => {
	it('returns true for TRUE/1/YES (case-insensitive)', () => {
		expect(parseBool('TRUE')).toBe(true);
		expect(parseBool('true')).toBe(true);
		expect(parseBool('True')).toBe(true);
		expect(parseBool('1')).toBe(true);
		expect(parseBool('YES')).toBe(true);
		expect(parseBool('yes')).toBe(true);
	});

	it('returns false for FALSE/0/NO', () => {
		expect(parseBool('FALSE')).toBe(false);
		expect(parseBool('false')).toBe(false);
		expect(parseBool('0')).toBe(false);
		expect(parseBool('NO')).toBe(false);
	});

	it('returns null for empty or null values', () => {
		expect(parseBool(null)).toBeNull();
		expect(parseBool(undefined)).toBeNull();
		expect(parseBool('')).toBeNull();
		expect(parseBool('  ')).toBeNull();
	});
});

// ── fromValueNodeType ───────────────────────────────────────────

describe('fromValueNodeType', () => {
	it('maps IRI/URI to "iri"', () => {
		expect(fromValueNodeType('IRI')).toBe('iri');
		expect(fromValueNodeType('URI')).toBe('iri');
		expect(fromValueNodeType('iri')).toBe('iri');
	});

	it('maps literal to "literal"', () => {
		expect(fromValueNodeType('literal')).toBe('literal');
		expect(fromValueNodeType('LITERAL')).toBe('literal');
	});

	it('maps bnode to "bnode"', () => {
		expect(fromValueNodeType('bnode')).toBe('bnode');
		expect(fromValueNodeType('BNODE')).toBe('bnode');
	});

	it('returns empty string for unknown or empty', () => {
		expect(fromValueNodeType('')).toBe('');
		expect(fromValueNodeType(undefined)).toBe('');
		expect(fromValueNodeType('unknown')).toBe('');
	});

	it('handles multi-word nodeType (takes first word)', () => {
		expect(fromValueNodeType('IRI or literal')).toBe('iri');
	});
});

// ── fromValueConstraint ─────────────────────────────────────────

describe('fromValueConstraint', () => {
	it('parses picklist constraint', () => {
		const result = fromValueConstraint('red, green, blue', 'picklist');
		expect(result.values).toEqual(['red', 'green', 'blue']);
	});

	it('parses pattern constraint', () => {
		const result = fromValueConstraint('^[A-Z]', 'pattern');
		expect(result.pattern).toBe('^[A-Z]');
	});

	it('parses IRIstem constraint into inScheme', () => {
		const result = fromValueConstraint('http://example.org/', 'IRIstem');
		expect(result.inScheme).toEqual(['http://example.org/']);
		expect(result.constraintType).toBe('IRIstem');
	});

	it('parses multi-stem IRIstem as comma-separated list', () => {
		const result = fromValueConstraint(
			'https://id.loc.gov/authorities/subjects/, http://vocab.getty.edu/',
			'IRIstem'
		);
		expect(result.inScheme).toEqual([
			'https://id.loc.gov/authorities/subjects/',
			'http://vocab.getty.edu/',
		]);
	});

	it('parses languageTag constraint as comma-separated tags', () => {
		const result = fromValueConstraint('en,fr,zh-Hans', 'languageTag');
		expect(result.values).toEqual(['en', 'fr', 'zh-Hans']);
		expect(result.constraintType).toBe('languageTag');
	});

	it('parses minInclusive facet', () => {
		const result = fromValueConstraint('0', 'minInclusive');
		expect(result.facets).toEqual({ MinInclusive: 0 });
	});

	it('parses maxInclusive facet', () => {
		const result = fromValueConstraint('100', 'maxInclusive');
		expect(result.facets).toEqual({ MaxInclusive: 100 });
	});

	it('parses minLength facet', () => {
		const result = fromValueConstraint('3', 'minLength');
		expect(result.facets).toEqual({ MinLength: 3 });
	});

	it('parses maxLength facet', () => {
		const result = fromValueConstraint('255', 'maxLength');
		expect(result.facets).toEqual({ MaxLength: 255 });
	});

	it('falls back to raw constraint when a numeric facet is not a number', () => {
		const result = fromValueConstraint('abc', 'minInclusive');
		// Non-numeric input falls through as verbatim so it round-trips.
		expect(result.constraint).toBe('abc');
		expect(result.constraintType).toBe('minInclusive');
		expect(result.facets).toBeUndefined();
	});

	it('returns empty for empty constraint value', () => {
		expect(fromValueConstraint('', 'picklist')).toEqual({});
	});

	it('stores raw constraint when valueConstraintType is missing', () => {
		expect(fromValueConstraint('value', '')).toEqual({ constraint: 'value' });
	});

	it('preserves unknown DCTAP extension types verbatim', () => {
		// DCTAP's valueConstraintType vocabulary is open (spec §Extensions),
		// so unknown types are kept so they round-trip.
		const result = fromValueConstraint('value', 'myCustomType');
		expect(result.constraint).toBe('value');
		expect(result.constraintType).toBe('myCustomType');
	});
});

// ── toStatementKey ──────────────────────────────────────────────

describe('toStatementKey', () => {
	it('extracts local name from prefixed term', () => {
		const keys = new Set<string>();
		expect(toStatementKey('foaf:name', keys)).toBe('name');
	});

	it('extracts local name from IRI with hash', () => {
		const keys = new Set<string>();
		expect(toStatementKey('http://xmlns.com/foaf/0.1/#name', keys)).toBe('name');
	});

	it('lowercases first character', () => {
		const keys = new Set<string>();
		expect(toStatementKey('foaf:Person', keys)).toBe('person');
	});

	it('deduplicates keys with numeric suffix', () => {
		const keys = new Set<string>();
		expect(toStatementKey('foaf:name', keys)).toBe('name');
		expect(toStatementKey('schema:name', keys)).toBe('name2');
		expect(toStatementKey('ex:name', keys)).toBe('name3');
	});

	it('uses raw value for non-prefixed terms', () => {
		const keys = new Set<string>();
		expect(toStatementKey('title', keys)).toBe('title');
	});
});

// ── dctapRowsToTapir ────────────────────────────────────────────

describe('dctapRowsToTapir', () => {
	it('creates a project with dctap flavor', () => {
		const result = dctapRowsToTapir([]);
		expect(result.data.flavor).toBe('dctap');
		expect(result.errors).toHaveLength(0);
	});

	it('uses custom project name', () => {
		const result = dctapRowsToTapir([], 'My Profile');
		expect(result.data.name).toBe('My Profile');
	});

	it('uses default project name', () => {
		const result = dctapRowsToTapir([]);
		expect(result.data.name).toBe('Imported DCTAP');
	});

	it('creates description from shapeID', () => {
		const rows: DctapRow[] = [
			{
				shapeID: 'PersonShape',
				shapeLabel: 'Person',
				propertyID: 'foaf:name',
				propertyLabel: 'Name',
				mandatory: 'TRUE',
				repeatable: 'FALSE',
				valueNodeType: 'literal',
				valueDataType: 'xsd:string',
				note: 'Full name',
			},
		];

		const result = dctapRowsToTapir(rows);
		expect(result.errors).toHaveLength(0);
		expect(result.data.descriptions).toHaveLength(1);

		const desc = result.data.descriptions[0];
		expect(desc.name).toBe('PersonShape');
		expect(desc.label).toBe('Person');
		expect(desc.statements).toHaveLength(1);

		const stmt = desc.statements[0];
		expect(stmt.propertyId).toBe('foaf:name');
		expect(stmt.label).toBe('Name');
		expect(stmt.min).toBe(1);
		expect(stmt.max).toBe(1);
		expect(stmt.valueType).toBe('literal');
		expect(stmt.datatype).toBe('xsd:string');
		expect(stmt.note).toBe('Full name');
	});

	it('groups subsequent rows under same shape', () => {
		const rows: DctapRow[] = [
			{
				shapeID: 'PersonShape',
				shapeLabel: 'Person',
				propertyID: 'foaf:name',
			},
			{
				shapeID: '',
				propertyID: 'foaf:mbox',
			},
			{
				shapeID: '',
				propertyID: 'foaf:age',
			},
		];

		const result = dctapRowsToTapir(rows);
		expect(result.data.descriptions).toHaveLength(1);
		expect(result.data.descriptions[0].statements).toHaveLength(3);
	});

	it('handles multiple shapes', () => {
		const rows: DctapRow[] = [
			{
				shapeID: 'PersonShape',
				propertyID: 'foaf:name',
			},
			{
				shapeID: 'BookShape',
				propertyID: 'dcterms:title',
			},
		];

		const result = dctapRowsToTapir(rows);
		expect(result.data.descriptions).toHaveLength(2);
		expect(result.data.descriptions[0].name).toBe('PersonShape');
		expect(result.data.descriptions[1].name).toBe('BookShape');
	});

	it('handles shape-only row (no propertyID)', () => {
		const rows: DctapRow[] = [
			{
				shapeID: 'EmptyShape',
				shapeLabel: 'Empty',
				note: 'Shape note',
			},
		];

		const result = dctapRowsToTapir(rows);
		expect(result.data.descriptions).toHaveLength(1);

		const desc = result.data.descriptions[0];
		expect(desc.name).toBe('EmptyShape');
		expect(desc.label).toBe('Empty');
		expect(desc.note).toBe('Shape note');
		expect(desc.statements).toHaveLength(0);
	});

	it('assigns default shape for rows without shapeID', () => {
		const rows: DctapRow[] = [
			{
				propertyID: 'foaf:name',
			},
		];

		const result = dctapRowsToTapir(rows);
		expect(result.data.descriptions).toHaveLength(1);
		expect(result.data.descriptions[0].name).toBe('default');
	});

	it('maps mandatory TRUE → min 1', () => {
		const rows: DctapRow[] = [
			{ shapeID: 'S', propertyID: 'ex:p', mandatory: 'TRUE' },
		];
		const stmt = dctapRowsToTapir(rows).data.descriptions[0].statements[0];
		expect(stmt.min).toBe(1);
	});

	it('maps mandatory FALSE → min 0', () => {
		const rows: DctapRow[] = [
			{ shapeID: 'S', propertyID: 'ex:p', mandatory: 'FALSE' },
		];
		const stmt = dctapRowsToTapir(rows).data.descriptions[0].statements[0];
		expect(stmt.min).toBe(0);
	});

	it('maps repeatable TRUE → max null', () => {
		const rows: DctapRow[] = [
			{ shapeID: 'S', propertyID: 'ex:p', repeatable: 'TRUE' },
		];
		const stmt = dctapRowsToTapir(rows).data.descriptions[0].statements[0];
		expect(stmt.max).toBeNull();
	});

	it('maps repeatable FALSE → max 1', () => {
		const rows: DctapRow[] = [
			{ shapeID: 'S', propertyID: 'ex:p', repeatable: 'FALSE' },
		];
		const stmt = dctapRowsToTapir(rows).data.descriptions[0].statements[0];
		expect(stmt.max).toBe(1);
	});

	it('maps valueShape to shapeRef', () => {
		const rows: DctapRow[] = [
			{ shapeID: 'S', propertyID: 'ex:p', valueShape: 'AgentShape' },
		];
		const stmt = dctapRowsToTapir(rows).data.descriptions[0].statements[0];
		expect(stmt.shapeRefs).toEqual(['AgentShape']);
	});

	it('maps picklist valueConstraint to values', () => {
		const rows: DctapRow[] = [
			{
				shapeID: 'S',
				propertyID: 'ex:color',
				valueConstraint: 'red,green,blue',
				valueConstraintType: 'picklist',
			},
		];
		const stmt = dctapRowsToTapir(rows).data.descriptions[0].statements[0];
		expect(stmt.values).toEqual(['red', 'green', 'blue']);
	});

	it('maps pattern valueConstraint to pattern', () => {
		const rows: DctapRow[] = [
			{
				shapeID: 'S',
				propertyID: 'ex:code',
				valueConstraint: '^[A-Z]{3}$',
				valueConstraintType: 'pattern',
			},
		];
		const stmt = dctapRowsToTapir(rows).data.descriptions[0].statements[0];
		expect(stmt.pattern).toBe('^[A-Z]{3}$');
	});

	it('maps facet valueConstraint to facets', () => {
		const rows: DctapRow[] = [
			{
				shapeID: 'S',
				propertyID: 'ex:age',
				valueConstraint: '0',
				valueConstraintType: 'minInclusive',
			},
		];
		const stmt = dctapRowsToTapir(rows).data.descriptions[0].statements[0];
		expect(stmt.facets).toEqual({ MinInclusive: 0 });
	});

	it('skips rows without propertyID', () => {
		const rows: DctapRow[] = [
			{ shapeID: 'S', propertyID: 'ex:p1' },
			{ propertyID: '' },
			{ propertyID: 'ex:p2' },
		];

		const result = dctapRowsToTapir(rows);
		expect(result.data.descriptions[0].statements).toHaveLength(2);
	});

	it('deduplicates statement keys', () => {
		const rows: DctapRow[] = [
			{ shapeID: 'S', propertyID: 'foaf:name' },
			{ propertyID: 'schema:name' },
		];

		const result = dctapRowsToTapir(rows);
		const stmts = result.data.descriptions[0].statements;
		expect(stmts[0].id).toBe('name');
		expect(stmts[1].id).toBe('name2');
	});
});
