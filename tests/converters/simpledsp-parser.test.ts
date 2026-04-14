import { describe, it, expect } from 'vitest';
import {
	parseSimpleDspText,
	simpleDspToTapir,
	parseCardinality,
	parseQuotedValues,
	parseSimpleDsp,
} from '$lib/converters/simpledsp-parser';

// ── parseCardinality ────────────────────────────────────────────

describe('parseCardinality', () => {
	it('parses numeric values', () => {
		expect(parseCardinality('0')).toBe(0);
		expect(parseCardinality('1')).toBe(1);
		expect(parseCardinality('5')).toBe(5);
	});

	it('returns null for dash (unbounded)', () => {
		expect(parseCardinality('-')).toBeNull();
	});

	it('returns null for empty string', () => {
		expect(parseCardinality('')).toBeNull();
	});

	it('returns null for keyword values', () => {
		expect(parseCardinality('推奨')).toBeNull();
		expect(parseCardinality('recommended')).toBeNull();
	});
});

// ── parseQuotedValues ───────────────────────────────────────────

describe('parseQuotedValues', () => {
	it('parses multiple quoted values', () => {
		expect(parseQuotedValues('"banana" "apple" "orange"')).toEqual([
			'banana',
			'apple',
			'orange',
		]);
	});

	it('parses single quoted value', () => {
		expect(parseQuotedValues('"hello"')).toEqual(['hello']);
	});

	it('returns input as array if no quotes', () => {
		expect(parseQuotedValues('xsd:string')).toEqual(['xsd:string']);
	});
});

// ── parseSimpleDspText ──────────────────────────────────────────

describe('parseSimpleDspText', () => {
	it('parses namespace block', () => {
		const text = [
			'[@NS]',
			'ex\thttp://example.org/',
			'@base\thttp://example.org/base/',
			'',
			'[MAIN]',
			'#Name\tProperty\tMin\tMax\tValueType\tConstraint\tComment',
			'name\tex:name\t1\t1\tliteral\txsd:string\tFull name',
		].join('\n');

		const result = parseSimpleDspText(text);
		expect(result.namespaces['ex']).toBe('http://example.org/');
		expect(result.namespaces['@base']).toBe('http://example.org/base/');
		expect(result.blocks).toHaveLength(1);
		expect(result.blocks[0].id).toBe('MAIN');
	});

	it('parses multiple blocks', () => {
		const text = [
			'[MAIN]',
			'#header',
			'name\tfoaf:name\t1\t1\tliteral\t\t',
			'',
			'[Agent]',
			'#header',
			'type\trdf:type\t1\t1\treference\t\t',
		].join('\n');

		const result = parseSimpleDspText(text);
		expect(result.blocks).toHaveLength(2);
		expect(result.blocks[0].id).toBe('MAIN');
		expect(result.blocks[0].rows).toHaveLength(1);
		expect(result.blocks[1].id).toBe('Agent');
		expect(result.blocks[1].rows).toHaveLength(1);
	});

	it('skips comment lines starting with #', () => {
		const text = [
			'[MAIN]',
			'#Name\tProperty\tMin\tMax\tValueType\tConstraint\tComment',
			'name\tfoaf:name\t1\t1\tliteral\t\t',
		].join('\n');

		const result = parseSimpleDspText(text);
		expect(result.blocks[0].rows).toHaveLength(1);
		expect(result.blocks[0].rows[0].Name).toBe('name');
	});

	it('skips empty lines', () => {
		const text = [
			'[MAIN]',
			'#header',
			'',
			'name\tfoaf:name\t1\t1\tliteral\t\t',
			'',
		].join('\n');

		const result = parseSimpleDspText(text);
		expect(result.blocks[0].rows).toHaveLength(1);
	});

	it('reads columns by position', () => {
		const text = [
			'[MAIN]',
			'myName\tmyProp\t2\t5\tstructured\t#Agent\tmy note',
		].join('\n');

		const row = parseSimpleDspText(text).blocks[0].rows[0];
		expect(row.Name).toBe('myName');
		expect(row.Property).toBe('myProp');
		expect(row.Min).toBe('2');
		expect(row.Max).toBe('5');
		expect(row.ValueType).toBe('structured');
		expect(row.Constraint).toBe('#Agent');
		expect(row.Comment).toBe('my note');
	});

	it('handles rows with missing trailing columns', () => {
		const text = '[MAIN]\nname\tfoaf:name';
		const row = parseSimpleDspText(text).blocks[0].rows[0];
		expect(row.Name).toBe('name');
		expect(row.Property).toBe('foaf:name');
		expect(row.Min).toBe('');
		expect(row.Max).toBe('');
		expect(row.ValueType).toBe('');
	});

	it('returns empty result for empty input', () => {
		const result = parseSimpleDspText('');
		expect(result.blocks).toHaveLength(0);
		expect(Object.keys(result.namespaces)).toHaveLength(0);
	});
});

// ── simpleDspToTapir ────────────────────────────────────────────

describe('simpleDspToTapir', () => {
	it('creates a project with correct flavor', () => {
		const result = simpleDspToTapir([], {});
		expect(result.data.flavor).toBe('simpledsp');
	});

	it('applies base from @base namespace', () => {
		const result = simpleDspToTapir([], {
			'@base': 'http://example.org/',
		});
		expect(result.data.base).toBe('http://example.org/');
	});

	it('applies namespaces (excluding @base)', () => {
		const result = simpleDspToTapir([], {
			ex: 'http://example.org/',
			'@base': 'http://base.org/',
		});
		expect(result.data.namespaces['ex']).toBe('http://example.org/');
		expect(result.data.namespaces['@base']).toBeUndefined();
	});

	it('converts literal statement', () => {
		const blocks = [
			{
				id: 'MAIN',
				rows: [
					{
						Name: 'Full Name',
						Property: 'foaf:name',
						Min: '1',
						Max: '1',
						ValueType: 'literal',
						Constraint: 'xsd:string',
						Comment: 'The person name',
					},
				],
			},
		];

		const result = simpleDspToTapir(blocks, {});
		expect(result.errors).toHaveLength(0);
		const stmt = result.data.descriptions[0].statements[0];
		expect(stmt.label).toBe('Full Name');
		expect(stmt.propertyId).toBe('foaf:name');
		expect(stmt.min).toBe(1);
		expect(stmt.max).toBe(1);
		expect(stmt.valueType).toBe('literal');
		expect(stmt.datatype).toBe('xsd:string');
		expect(stmt.note).toBe('The person name');
	});

	it('converts structured statement with shape ref', () => {
		const blocks = [
			{
				id: 'MAIN',
				rows: [
					{
						Name: 'Agent',
						Property: 'dcterms:creator',
						Min: '0',
						Max: '-',
						ValueType: 'structured',
						Constraint: '#AgentShape',
						Comment: '',
					},
				],
			},
		];

		const result = simpleDspToTapir(blocks, {});
		const stmt = result.data.descriptions[0].statements[0];
		expect(stmt.shapeRefs).toEqual(['AgentShape']);
		expect(stmt.valueType).toBe('');
	});

	it('converts structured statement with class constraint', () => {
		const blocks = [
			{
				id: 'MAIN',
				rows: [
					{
						Name: 'Creator',
						Property: 'dcterms:creator',
						Min: '0',
						Max: '-',
						ValueType: 'structured',
						Constraint: 'foaf:Agent foaf:Person',
						Comment: '',
					},
				],
			},
		];

		const result = simpleDspToTapir(blocks, {});
		const stmt = result.data.descriptions[0].statements[0];
		expect(stmt.classConstraint).toEqual(['foaf:Agent', 'foaf:Person']);
		expect(stmt.valueType).toBe('iri');
	});

	it('converts reference statement', () => {
		const blocks = [
			{
				id: 'MAIN',
				rows: [
					{
						Name: 'Subject',
						Property: 'dcterms:subject',
						Min: '0',
						Max: '-',
						ValueType: 'IRI',
						Constraint: 'skos:',
						Comment: 'Subject heading',
					},
				],
			},
		];

		const result = simpleDspToTapir(blocks, {});
		const stmt = result.data.descriptions[0].statements[0];
		expect(stmt.valueType).toBe('iri');
		expect(stmt.inScheme).toEqual(['skos:']);
		expect(stmt.note).toBe('Subject heading');
	});

	it('converts reference statement with URI values', () => {
		const blocks = [
			{
				id: 'MAIN',
				rows: [
					{
						Name: 'Type',
						Property: 'rdf:type',
						Min: '1',
						Max: '1',
						ValueType: 'IRI',
						Constraint: 'foaf:Person foaf:Agent',
						Comment: '',
					},
				],
			},
		];

		const result = simpleDspToTapir(blocks, {});
		const stmt = result.data.descriptions[0].statements[0];
		expect(stmt.values).toEqual(['foaf:Person', 'foaf:Agent']);
	});

	it('converts literal statement with quoted picklist', () => {
		const blocks = [
			{
				id: 'MAIN',
				rows: [
					{
						Name: 'Color',
						Property: 'ex:color',
						Min: '1',
						Max: '1',
						ValueType: 'literal',
						Constraint: '"red" "green" "blue"',
						Comment: '',
					},
				],
			},
		];

		const result = simpleDspToTapir(blocks, {});
		const stmt = result.data.descriptions[0].statements[0];
		expect(stmt.values).toEqual(['red', 'green', 'blue']);
	});

	it('handles ID rows (sets targetClass)', () => {
		const blocks = [
			{
				id: 'MAIN',
				rows: [
					{
						Name: 'ID',
						Property: 'foaf:Person',
						Min: '1',
						Max: '1',
						ValueType: 'ID',
						Constraint: 'http://example.org/',
						Comment: '',
					},
					{
						Name: 'Name',
						Property: 'foaf:name',
						Min: '1',
						Max: '1',
						ValueType: 'literal',
						Constraint: '',
						Comment: '',
					},
				],
			},
		];

		const result = simpleDspToTapir(blocks, {});
		const desc = result.data.descriptions[0];
		expect(desc.targetClass).toBe('foaf:Person');
		expect(desc.statements).toHaveLength(1); // ID row is not a statement
		expect(result.data.base).toBe('http://example.org/');
	});

	it('handles Japanese value types', () => {
		const blocks = [
			{
				id: 'MAIN',
				rows: [
					{
						Name: 'タイトル',
						Property: 'dcterms:title',
						Min: '1',
						Max: '1',
						ValueType: '文字列',
						Constraint: '',
						Comment: '',
					},
				],
			},
		];

		const result = simpleDspToTapir(blocks, {});
		const stmt = result.data.descriptions[0].statements[0];
		expect(stmt.valueType).toBe('literal');
	});

	it('handles cardinality keywords (cardinalityNote)', () => {
		const blocks = [
			{
				id: 'MAIN',
				rows: [
					{
						Name: 'Note',
						Property: 'dcterms:description',
						Min: '推奨',
						Max: '-',
						ValueType: 'literal',
						Constraint: '',
						Comment: '',
					},
				],
			},
		];

		const result = simpleDspToTapir(blocks, {});
		const stmt = result.data.descriptions[0].statements[0];
		expect(stmt.min).toBeNull();
		expect(stmt.cardinalityNote).toBe('推奨');
	});

	it('skips rows without name or property', () => {
		const blocks = [
			{
				id: 'MAIN',
				rows: [
					{
						Name: '',
						Property: '',
						Min: '',
						Max: '',
						ValueType: '',
						Constraint: '',
						Comment: '',
					},
					{
						Name: 'Name',
						Property: 'foaf:name',
						Min: '1',
						Max: '1',
						ValueType: 'literal',
						Constraint: '',
						Comment: '',
					},
				],
			},
		];

		const result = simpleDspToTapir(blocks, {});
		expect(result.data.descriptions[0].statements).toHaveLength(1);
	});

	it('generates unique keys for duplicate names', () => {
		const blocks = [
			{
				id: 'MAIN',
				rows: [
					{
						Name: 'Title',
						Property: 'dcterms:title',
						Min: '0',
						Max: '-',
						ValueType: 'literal',
						Constraint: '',
						Comment: '',
					},
					{
						Name: 'Title',
						Property: 'dcterms:alternative',
						Min: '0',
						Max: '-',
						ValueType: 'literal',
						Constraint: '',
						Comment: '',
					},
				],
			},
		];

		const result = simpleDspToTapir(blocks, {});
		const stmts = result.data.descriptions[0].statements;
		expect(stmts).toHaveLength(2);
		expect(stmts[0].id).toBe('title');
		expect(stmts[1].id).toBe('title2');
	});

	it('handles multiple blocks', () => {
		const blocks = [
			{
				id: 'MAIN',
				rows: [
					{
						Name: 'Name',
						Property: 'foaf:name',
						Min: '1',
						Max: '1',
						ValueType: 'literal',
						Constraint: '',
						Comment: '',
					},
				],
			},
			{
				id: 'Agent',
				rows: [
					{
						Name: 'Type',
						Property: 'rdf:type',
						Min: '1',
						Max: '1',
						ValueType: 'IRI',
						Constraint: '',
						Comment: '',
					},
				],
			},
		];

		const result = simpleDspToTapir(blocks, {});
		expect(result.data.descriptions).toHaveLength(2);
		expect(result.data.descriptions[0].name).toBe('MAIN');
		expect(result.data.descriptions[1].name).toBe('Agent');
	});

	it('warns when no blocks found', () => {
		const result = simpleDspToTapir([], {});
		expect(result.warnings.length).toBeGreaterThan(0);
		expect(result.warnings[0].message).toContain('No description blocks');
	});

	it('handles unconstrained value type with constraint as datatype', () => {
		const blocks = [
			{
				id: 'MAIN',
				rows: [
					{
						Name: 'Custom',
						Property: 'ex:custom',
						Min: '0',
						Max: '-',
						ValueType: '',
						Constraint: 'xsd:integer',
						Comment: '',
					},
				],
			},
		];

		const result = simpleDspToTapir(blocks, {});
		const stmt = result.data.descriptions[0].statements[0];
		expect(stmt.datatype).toBe('xsd:integer');
	});

	it('handles reference with angle-bracket URIs', () => {
		const blocks = [
			{
				id: 'MAIN',
				rows: [
					{
						Name: 'See also',
						Property: 'rdfs:seeAlso',
						Min: '0',
						Max: '-',
						ValueType: 'IRI',
						Constraint: '<http://example.org/scheme>',
						Comment: '',
					},
				],
			},
		];

		const result = simpleDspToTapir(blocks, {});
		const stmt = result.data.descriptions[0].statements[0];
		expect(stmt.values).toEqual(['http://example.org/scheme']);
	});
});

// ── parseSimpleDsp (convenience) ────────────────────────────────

describe('parseSimpleDsp', () => {
	it('parses complete SimpleDSP text end-to-end', () => {
		const text = [
			'[@NS]',
			'ex\thttp://example.org/',
			'',
			'[MAIN]',
			'#Name\tProperty\tMin\tMax\tValueType\tConstraint\tComment',
			'Title\tdcterms:title\t1\t1\tliteral\txsd:string\tThe title',
			'Author\tdcterms:creator\t0\t-\tstructured\t#Agent\tCreator ref',
			'',
			'[Agent]',
			'#Name\tProperty\tMin\tMax\tValueType\tConstraint\tComment',
			'Name\tfoaf:name\t1\t1\tliteral\t\tAgent name',
		].join('\n');

		const result = parseSimpleDsp(text, 'Test Project');
		expect(result.errors).toHaveLength(0);
		expect(result.data.name).toBe('Test Project');
		expect(result.data.flavor).toBe('simpledsp');
		expect(result.data.namespaces['ex']).toBe('http://example.org/');
		expect(result.data.descriptions).toHaveLength(2);

		const main = result.data.descriptions[0];
		expect(main.name).toBe('MAIN');
		expect(main.statements).toHaveLength(2);
		expect(main.statements[0].propertyId).toBe('dcterms:title');
		expect(main.statements[1].shapeRefs).toEqual(['Agent']);

		const agent = result.data.descriptions[1];
		expect(agent.name).toBe('Agent');
		expect(agent.statements).toHaveLength(1);
	});

	it('uses default project name', () => {
		const result = parseSimpleDsp('[MAIN]\nname\tfoaf:name\t1\t1\tliteral\t\t');
		expect(result.data.name).toBe('Imported SimpleDSP');
	});
});
