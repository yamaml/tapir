import { describe, it, expect } from 'vitest';
import { parseSimpleDsp } from '$lib/converters/simpledsp-parser';
import { buildSimpleDsp } from '$lib/converters/simpledsp-generator';
import { createProject, createDescription, createStatement } from '$lib/types/profile';
import type { TapirProject } from '$lib/types';
import type { GeneratorWarning } from '$lib/types/export';

// ── Helpers ─────────────────────────────────────────────────────

function makeProject(overrides?: Partial<TapirProject>): TapirProject {
	return createProject({ name: 'Test', flavor: 'simpledsp', ...overrides });
}

// ── §6.2.6: header-less shorthand ───────────────────────────────

describe('header-less shorthand (§6.2.6)', () => {
	it('parses a file with no [...] block as an implicit [MAIN]', () => {
		const text = [
			'#Name\tProperty\tMin\tMax\tValueType\tConstraint\tComment',
			'Title\tdcterms:title\t1\t1\tliteral\t\tThe title',
			'Creator\tdcterms:creator\t0\t-\tliteral\t\t',
		].join('\n');

		const result = parseSimpleDsp(text);
		expect(result.data.descriptions).toHaveLength(1);
		expect(result.data.descriptions[0].name).toBe('MAIN');
		expect(result.data.descriptions[0].statements).toHaveLength(2);
		expect(result.data.descriptions[0].statements[0].propertyId).toBe('dcterms:title');
	});

	it('parses statement rows without even a header comment', () => {
		const result = parseSimpleDsp('Title\tdcterms:title\t1\t1\tliteral\t\t');
		expect(result.data.descriptions).toHaveLength(1);
		expect(result.data.descriptions[0].statements).toHaveLength(1);
	});
});

// ── ID-row note round trip ──────────────────────────────────────

describe('description note via the ID row', () => {
	it('imports the ID-row Comment as desc.note', () => {
		const text = [
			'[MAIN]',
			'ID\tfoaf:Person\t1\t1\tID\t\tThis is the record description',
			'Name\tfoaf:name\t1\t1\tliteral\t\t',
		].join('\n');

		const result = parseSimpleDsp(text);
		expect(result.data.descriptions[0].note).toBe('This is the record description');
	});

	it('round-trips a description note through export and import', () => {
		const project = makeProject();
		project.descriptions = [
			createDescription({
				name: 'Book',
				targetClass: 'dcterms:BibliographicResource',
				note: 'Block-level documentation',
				statements: [createStatement({ label: 'Title', propertyId: 'dcterms:title' })],
			}),
		];

		const parsed = parseSimpleDsp(buildSimpleDsp(project));
		expect(parsed.data.descriptions[0].note).toBe('Block-level documentation');
	});
});

// ── Unrecognised value types (§4.5) ─────────────────────────────

describe('unrecognised value types', () => {
	it('records an error and preserves the constraint verbatim', () => {
		const text = ['[MAIN]', 'X\tex:p\t0\t-\tlitteral\txsd:string\t'].join('\n');
		const result = parseSimpleDsp(text);
		expect(result.errors.length).toBeGreaterThan(0);
		expect(result.errors[0].message).toContain('litteral');
		const stmt = result.data.descriptions[0].statements[0];
		// Misfiled-into-datatype was the old bug; the raw constraint must
		// be preserved instead.
		expect(stmt.datatype).toEqual([]);
		expect(stmt.constraint).toBe('xsd:string');
	});

	it('accepts the OWL-DSP English keyword "reference" as IRI', () => {
		const text = ['[MAIN]', 'X\tex:p\t0\t-\treference\t\t'].join('\n');
		const result = parseSimpleDsp(text);
		expect(result.errors).toHaveLength(0);
		expect(result.data.descriptions[0].statements[0].valueType).toEqual(['iri']);
	});

	it('maps 制約なし to the unconstrained value type', () => {
		const text = ['[MAIN]', 'X\tex:p\t0\t-\t制約なし\t\t'].join('\n');
		const result = parseSimpleDsp(text);
		expect(result.errors).toHaveLength(0);
		expect(result.data.descriptions[0].statements[0].valueType).toEqual([]);
	});
});

// ── Picklists ───────────────────────────────────────────────────

describe('picklist quoting', () => {
	it('keeps a single-value picklist a picklist (not a datatype)', () => {
		const project = makeProject();
		project.descriptions = [
			createDescription({
				name: 'Item',
				statements: [
					createStatement({
						label: 'Status',
						propertyId: 'ex:status',
						valueType: ['literal'],
						values: ['red'],
					}),
				],
			}),
		];

		const text = buildSimpleDsp(project);
		expect(text).toContain('"red"');

		const parsed = parseSimpleDsp(text);
		const stmt = parsed.data.descriptions[0].statements[0];
		expect(stmt.values).toEqual(['red']);
		expect(stmt.datatype).toEqual([]);
	});

	it('round-trips picklist values containing embedded quotes', () => {
		const project = makeProject();
		project.descriptions = [
			createDescription({
				name: 'Item',
				statements: [
					createStatement({
						label: 'Quote',
						propertyId: 'ex:q',
						valueType: ['literal'],
						values: ['say "hi"', 'plain'],
					}),
				],
			}),
		];

		const parsed = parseSimpleDsp(buildSimpleDsp(project));
		expect(parsed.data.descriptions[0].statements[0].values).toEqual(['say "hi"', 'plain']);
	});
});

// ── S6: MAIN rename and reference rewriting ─────────────────────

describe('MAIN rename reference rewriting (S6)', () => {
	it('rewrites refs to the renamed first description as #MAIN', () => {
		const project = makeProject();
		project.descriptions = [
			createDescription({
				name: 'Work',
				statements: [
					createStatement({
						label: 'Related',
						propertyId: 'dcterms:relation',
						shapeRefs: ['Work'], // self-reference
					}),
				],
			}),
			createDescription({
				name: 'Person',
				statements: [
					createStatement({
						label: 'Created',
						propertyId: 'foaf:made',
						shapeRefs: ['Work'],
					}),
				],
			}),
		];

		const text = buildSimpleDsp(project);
		expect(text).toContain('#MAIN');
		expect(text).not.toContain('#Work');
	});

	it('resolves #MAIN refs to the first block on import (round trip)', () => {
		const project = makeProject();
		project.descriptions = [
			createDescription({
				name: 'Work',
				statements: [
					createStatement({
						label: 'Related',
						propertyId: 'dcterms:relation',
						shapeRefs: ['Work'],
					}),
				],
			}),
		];

		const parsed = parseSimpleDsp(buildSimpleDsp(project));
		const first = parsed.data.descriptions[0];
		// The block is now named MAIN; the ref must point at it (no dangle).
		expect(first.statements[0].shapeRefs).toEqual([first.name]);
	});
});

// ── S7: cell sanitising ─────────────────────────────────────────

describe('TSV cell sanitising (S7 / DECISION 10)', () => {
	it('replaces newlines in notes with spaces and warns', () => {
		const project = makeProject();
		project.descriptions = [
			createDescription({
				name: 'S',
				statements: [
					createStatement({
						label: 'Multi',
						propertyId: 'ex:p',
						note: 'line one\nline two',
					}),
				],
			}),
		];

		const warnings: GeneratorWarning[] = [];
		const text = buildSimpleDsp(project, { warnings });

		// Row structure intact: the statement row still has 7 columns.
		const row = text.split('\n').find((l) => l.startsWith('Multi'));
		expect(row).toBeDefined();
		expect(row!.split('\t')).toHaveLength(7);
		expect(row).toContain('line one line two');
		expect(warnings.length).toBeGreaterThan(0);
	});
});

// ── D8: statement name fallback ─────────────────────────────────

describe('statement Name fallback (D8)', () => {
	it('derives the Name column from the property local name when label is empty', () => {
		const project = makeProject();
		project.descriptions = [
			createDescription({
				name: 'S',
				statements: [createStatement({ propertyId: 'dcterms:title' })],
			}),
		];

		const text = buildSimpleDsp(project);
		const row = text.split('\n').find((l) => l.includes('dcterms:title'));
		expect(row!.split('\t')[0]).toBe('title');
	});
});

// ── JP export ───────────────────────────────────────────────────

describe('Japanese export labels', () => {
	it('exports iri value type as 参照値 (spec Table 15), never "IRI"', () => {
		const project = makeProject();
		project.descriptions = [
			createDescription({
				name: 'S',
				statements: [
					createStatement({
						label: '主題',
						propertyId: 'dcterms:subject',
						valueType: ['iri'],
						inScheme: ['skos:'],
					}),
				],
			}),
		];

		const text = buildSimpleDsp(project, { lang: 'jp' });
		const row = text.split('\n').find((l) => l.startsWith('主題'));
		expect(row).toContain('参照値');
		expect(row).not.toContain('IRI');
	});

	it('JP export round-trips back to the same value types', () => {
		const project = makeProject();
		project.descriptions = [
			createDescription({
				name: 'S',
				targetClass: 'foaf:Person',
				statements: [
					createStatement({ label: '名前', propertyId: 'foaf:name', valueType: ['literal'] }),
					createStatement({ label: '主題', propertyId: 'dcterms:subject', valueType: ['iri'] }),
					createStatement({
						label: '著者',
						propertyId: 'dcterms:creator',
						shapeRefs: ['S'],
					}),
				],
			}),
		];

		const parsed = parseSimpleDsp(buildSimpleDsp(project, { lang: 'jp' }));
		expect(parsed.errors).toHaveLength(0);
		const stmts = parsed.data.descriptions[0].statements;
		expect(stmts[0].valueType).toEqual(['literal']);
		expect(stmts[1].valueType).toEqual(['iri']);
		expect(stmts[2].shapeRefs).toEqual(['MAIN']);
	});
});

// ── D7: ID-row policy ───────────────────────────────────────────

describe('ID-row policy (D7)', () => {
	it('emits an ID row for the MAIN block even without identity fields', () => {
		const project = makeProject();
		project.descriptions = [
			createDescription({
				name: 'S',
				statements: [createStatement({ label: 'X', propertyId: 'ex:p' })],
			}),
		];
		const text = buildSimpleDsp(project);
		expect(text).toContain('ID\t\t1\t1\tID\t\t');
	});

	it('omits the ID row for later blocks with no idPrefix/targetClass', () => {
		const project = makeProject();
		project.descriptions = [
			createDescription({
				name: 'First',
				statements: [createStatement({ label: 'X', propertyId: 'ex:p' })],
			}),
			createDescription({
				name: 'Plain',
				statements: [createStatement({ label: 'Y', propertyId: 'ex:q' })],
			}),
		];
		const text = buildSimpleDsp(project);
		const plainBlock = text.slice(text.indexOf('[Plain]'));
		expect(plainBlock).not.toContain('\tID\t');
	});
});

// ── URI stems vs values (iri constraints) ───────────────────────

describe('IRI constraint stem classification', () => {
	it('classifies full URIs ending in / or # as inScheme stems', () => {
		const text = [
			'[MAIN]',
			'Type\tdct:type\t0\t-\tIRI\thttp://purl.org/coar/resource_type/\t',
		].join('\n');
		const result = parseSimpleDsp(text);
		const stmt = result.data.descriptions[0].statements[0];
		expect(stmt.inScheme).toEqual(['http://purl.org/coar/resource_type/']);
		expect(stmt.values).toEqual([]);
	});

	it('keeps non-stem URIs as enumerated values', () => {
		const text = [
			'[MAIN]',
			'Type\tdct:type\t0\t-\tIRI\thttp://example.org/TypeA http://example.org/ns#\t',
		].join('\n');
		const result = parseSimpleDsp(text);
		const stmt = result.data.descriptions[0].statements[0];
		expect(stmt.values).toEqual(['http://example.org/TypeA']);
		expect(stmt.inScheme).toEqual(['http://example.org/ns#']);
	});
});

// ── CSV input with quoted newlines ──────────────────────────────

describe('SimpleDSP CSV input (S8)', () => {
	it('parses quoted newlines inside CSV comment cells', () => {
		const text = [
			'[MAIN]',
			'#Name,Property,Min,Max,ValueType,Constraint,Comment',
			'Title,dcterms:title,1,1,literal,,"line one',
			'line two"',
			'Creator,dcterms:creator,0,-,literal,,after',
		].join('\n');

		const result = parseSimpleDsp(text);
		const stmts = result.data.descriptions[0].statements;
		expect(stmts).toHaveLength(2);
		expect(stmts[0].note).toBe('line one\nline two');
		expect(stmts[1].propertyId).toBe('dcterms:creator');
	});

	it('parses spreadsheet-padded block markers ([MAIN],,,,,,)', () => {
		const text = [
			'[MAIN],,,,,,',
			'Title,dcterms:title,1,1,literal,,',
		].join('\n');
		const result = parseSimpleDsp(text);
		expect(result.data.descriptions).toHaveLength(1);
		expect(result.data.descriptions[0].statements).toHaveLength(1);
	});

	it('strips a BOM from the first line', () => {
		const text = '\uFEFF' + ['[MAIN]', 'Title\tdcterms:title\t1\t1\tliteral\t\t'].join('\n');
		const result = parseSimpleDsp(text);
		expect(result.data.descriptions).toHaveLength(1);
		expect(result.data.descriptions[0].name).toBe('MAIN');
	});
});
