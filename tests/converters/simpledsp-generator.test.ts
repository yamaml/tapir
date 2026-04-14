import { describe, it, expect } from 'vitest';
import {
	buildSimpleDsp,
	resolveSimpleDspValueType,
	resolveSimpleDspConstraint,
	STANDARD_PREFIXES,
} from '$lib/converters/simpledsp-generator';
import { parseSimpleDsp } from '$lib/converters/simpledsp-parser';
import { createProject, createDescription, createStatement } from '$lib/types/profile';
import type { TapirProject } from '$lib/types';

// ── Helpers ─────────────────────────────────────────────────────

function makeProject(overrides?: Partial<TapirProject>): TapirProject {
	return createProject({
		name: 'Test',
		flavor: 'simpledsp',
		...overrides,
	});
}

// ── STANDARD_PREFIXES ───────────────────────────────────────────

describe('STANDARD_PREFIXES', () => {
	it('contains expected standard prefixes', () => {
		expect(STANDARD_PREFIXES['foaf']).toBe('http://xmlns.com/foaf/0.1/');
		expect(STANDARD_PREFIXES['dcterms']).toBe('http://purl.org/dc/terms/');
		expect(STANDARD_PREFIXES['xsd']).toBe('http://www.w3.org/2001/XMLSchema#');
		expect(STANDARD_PREFIXES['rdf']).toBeDefined();
		expect(STANDARD_PREFIXES['rdfs']).toBeDefined();
		expect(STANDARD_PREFIXES['owl']).toBeDefined();
	});
});

// ── resolveSimpleDspValueType ───────────────────────────────────

describe('resolveSimpleDspValueType', () => {
	it('returns "structured" for shapeRef', () => {
		const stmt = createStatement({ shapeRefs: ['Agent'] });
		expect(resolveSimpleDspValueType(stmt)).toBe('structured');
	});

	it('returns "structured" for classConstraint', () => {
		const stmt = createStatement({
			classConstraint: ['foaf:Agent'],
		});
		expect(resolveSimpleDspValueType(stmt)).toBe('structured');
	});

	it('returns "IRI" for iri valueType', () => {
		const stmt = createStatement({ valueType: 'iri' });
		expect(resolveSimpleDspValueType(stmt)).toBe('IRI');
	});

	it('returns "literal" for literal valueType', () => {
		const stmt = createStatement({ valueType: 'literal' });
		expect(resolveSimpleDspValueType(stmt)).toBe('literal');
	});

	it('returns "literal" for datatype present', () => {
		const stmt = createStatement({ datatype: 'xsd:string' });
		expect(resolveSimpleDspValueType(stmt)).toBe('literal');
	});

	it('returns "literal" for values present', () => {
		const stmt = createStatement({ values: ['a', 'b'] });
		expect(resolveSimpleDspValueType(stmt)).toBe('literal');
	});

	it('returns empty string for unconstrained', () => {
		const stmt = createStatement();
		expect(resolveSimpleDspValueType(stmt)).toBe('');
	});
});

// ── resolveSimpleDspConstraint ──────────────────────────────────

describe('resolveSimpleDspConstraint', () => {
	it('returns shape ref with hash prefix', () => {
		const stmt = createStatement({ shapeRefs: ['AgentShape'] });
		expect(resolveSimpleDspConstraint(stmt)).toBe('#AgentShape');
	});

	it('returns class constraints space-separated', () => {
		const stmt = createStatement({
			classConstraint: ['foaf:Agent', 'foaf:Person'],
		});
		expect(resolveSimpleDspConstraint(stmt)).toBe('foaf:Agent foaf:Person');
	});

	it('returns datatype', () => {
		const stmt = createStatement({ datatype: 'xsd:date' });
		expect(resolveSimpleDspConstraint(stmt)).toBe('xsd:date');
	});

	it('returns inScheme joined', () => {
		const stmt = createStatement({ inScheme: ['skos:', 'ex:'] });
		expect(resolveSimpleDspConstraint(stmt)).toBe('skos: ex:');
	});

	it('returns quoted literal values', () => {
		const stmt = createStatement({
			valueType: 'literal',
			values: ['red', 'green'],
		});
		expect(resolveSimpleDspConstraint(stmt)).toBe('"red" "green"');
	});

	it('returns unquoted IRI values', () => {
		const stmt = createStatement({
			valueType: 'iri',
			values: ['foaf:Person', 'foaf:Agent'],
		});
		expect(resolveSimpleDspConstraint(stmt)).toBe('foaf:Person foaf:Agent');
	});

	it('returns empty string for unconstrained', () => {
		const stmt = createStatement();
		expect(resolveSimpleDspConstraint(stmt)).toBe('');
	});
});

// ── buildSimpleDsp ──────────────────────────────────────────────

describe('buildSimpleDsp', () => {
	it('generates empty output for project with no descriptions', () => {
		const project = makeProject();
		const text = buildSimpleDsp(project);
		expect(text.trim()).toBe('');
	});

	it('generates @NS block for custom namespaces', () => {
		const project = makeProject({
			namespaces: { ex: 'http://example.org/' },
		});
		project.descriptions = [
			createDescription({
				name: 'MAIN',
				statements: [
					createStatement({
						label: 'Name',
						propertyId: 'foaf:name',
						valueType: 'literal',
					}),
				],
			}),
		];

		const text = buildSimpleDsp(project);
		expect(text).toContain('[@NS]');
		expect(text).toContain('ex\thttp://example.org/');
	});

	it('omits @NS block for standard-only prefixes', () => {
		const project = makeProject({
			namespaces: { foaf: 'http://xmlns.com/foaf/0.1/' },
		});
		project.descriptions = [
			createDescription({
				name: 'MAIN',
				statements: [createStatement({ label: 'Name', propertyId: 'foaf:name' })],
			}),
		];

		const text = buildSimpleDsp(project);
		expect(text).not.toContain('[@NS]');
	});

	it('includes @base in @NS block', () => {
		const project = makeProject({ base: 'http://example.org/base/' });
		project.descriptions = [
			createDescription({
				name: 'MAIN',
				statements: [createStatement({ label: 'x', propertyId: 'ex:x' })],
			}),
		];

		const text = buildSimpleDsp(project);
		expect(text).toContain('@base\thttp://example.org/base/');
	});

	it('uses [MAIN] for first description', () => {
		const project = makeProject();
		project.descriptions = [
			createDescription({
				name: 'Character',
				statements: [createStatement({ label: 'Name', propertyId: 'foaf:name' })],
			}),
		];

		const text = buildSimpleDsp(project);
		expect(text).toContain('[MAIN]');
		expect(text).not.toContain('[Character]');
	});

	it('uses description name for subsequent blocks', () => {
		const project = makeProject();
		project.descriptions = [
			createDescription({
				name: 'Character',
				statements: [createStatement({ label: 'Name', propertyId: 'foaf:name' })],
			}),
			createDescription({
				name: 'Agent',
				statements: [createStatement({ label: 'Type', propertyId: 'rdf:type' })],
			}),
		];

		const text = buildSimpleDsp(project);
		expect(text).toContain('[MAIN]');
		expect(text).toContain('[Agent]');
	});

	it('includes English header line', () => {
		const project = makeProject();
		project.descriptions = [
			createDescription({
				name: 'X',
				statements: [createStatement({ label: 'Y', propertyId: 'ex:y' })],
			}),
		];

		const text = buildSimpleDsp(project, { lang: 'en' });
		expect(text).toContain('#Name\tProperty\tMin\tMax\tValueType\tConstraint\tComment');
	});

	it('includes Japanese header line', () => {
		const project = makeProject();
		project.descriptions = [
			createDescription({
				name: 'X',
				statements: [createStatement({ label: 'Y', propertyId: 'ex:y' })],
			}),
		];

		const text = buildSimpleDsp(project, { lang: 'jp' });
		expect(text).toContain('#項目規則名\tプロパティ\t最小\t最大\t値タイプ\t値制約\tコメント');
	});

	it('translates value types to Japanese', () => {
		const project = makeProject();
		project.descriptions = [
			createDescription({
				name: 'X',
				statements: [
					createStatement({
						label: 'Name',
						propertyId: 'foaf:name',
						valueType: 'literal',
					}),
				],
			}),
		];

		const text = buildSimpleDsp(project, { lang: 'jp' });
		const lines = text.split('\n');
		const dataLine = lines.find((l) => l.startsWith('Name'));
		expect(dataLine).toContain('文字列');
	});

	it('generates ID row for targetClass', () => {
		const project = makeProject({ base: 'http://example.org/' });
		project.descriptions = [
			createDescription({
				name: 'Character',
				targetClass: 'foaf:Person',
				statements: [
					createStatement({
						label: 'Name',
						propertyId: 'foaf:name',
						valueType: 'literal',
					}),
				],
			}),
		];

		const text = buildSimpleDsp(project);
		expect(text).toContain('ID\tfoaf:Person\t1\t1\tID\thttp://example.org/');
	});

	it('generates correct cardinality', () => {
		const project = makeProject();
		project.descriptions = [
			createDescription({
				name: 'X',
				statements: [
					createStatement({
						label: 'Required',
						propertyId: 'ex:req',
						min: 1,
						max: 1,
					}),
					createStatement({
						label: 'Optional',
						propertyId: 'ex:opt',
						min: 0,
						max: null,
					}),
				],
			}),
		];

		const text = buildSimpleDsp(project);
		const lines = text.split('\n');
		const reqLine = lines.find((l) => l.startsWith('Required'));
		const optLine = lines.find((l) => l.startsWith('Optional'));
		expect(reqLine).toContain('1\t1');
		expect(optLine).toContain('0\t-');
	});

	it('uses cardinalityNote when present', () => {
		const project = makeProject();
		project.descriptions = [
			createDescription({
				name: 'X',
				statements: [
					createStatement({
						label: 'Rec',
						propertyId: 'ex:rec',
						cardinalityNote: '推奨',
					}),
				],
			}),
		];

		const text = buildSimpleDsp(project);
		const line = text.split('\n').find((l) => l.startsWith('Rec'));
		expect(line).toContain('推奨');
	});

	it('generates full output for a realistic project', () => {
		const project = makeProject({
			base: 'http://example.org/',
			namespaces: { ex: 'http://example.org/vocab/' },
		});
		project.descriptions = [
			createDescription({
				name: 'Book',
				targetClass: 'ex:Book',
				statements: [
					createStatement({
						label: 'Title',
						propertyId: 'dcterms:title',
						min: 1,
						max: 1,
						valueType: 'literal',
						datatype: 'xsd:string',
						note: 'Book title',
					}),
					createStatement({
						label: 'Author',
						propertyId: 'dcterms:creator',
						min: 0,
						max: null,
						shapeRefs: ['Person'],
						note: 'Author reference',
					}),
				],
			}),
			createDescription({
				name: 'Person',
				targetClass: 'foaf:Person',
				statements: [
					createStatement({
						label: 'Name',
						propertyId: 'foaf:name',
						min: 1,
						max: 1,
						valueType: 'literal',
					}),
				],
			}),
		];

		const text = buildSimpleDsp(project);
		expect(text).toContain('[@NS]');
		expect(text).toContain('[MAIN]');
		expect(text).toContain('[Person]');
		expect(text).toContain('ID\tex:Book');
		expect(text).toContain('Title\tdcterms:title\t1\t1\tliteral\txsd:string\tBook title');
		expect(text).toContain('Author\tdcterms:creator\t0\t-\tstructured\t#Person\tAuthor reference');
		expect(text).toContain('ID\tfoaf:Person');
	});
});

// ── Round-trip Test ─────────────────────────────────────────────

describe('round-trip (generate -> parse)', () => {
	it('preserves project structure through generate and parse', () => {
		const original = makeProject({
			base: 'http://example.org/',
			namespaces: { ex: 'http://example.org/vocab/' },
		});
		original.descriptions = [
			createDescription({
				name: 'Book',
				targetClass: 'ex:Book',
				statements: [
					createStatement({
						label: 'Title',
						propertyId: 'dcterms:title',
						min: 1,
						max: 1,
						valueType: 'literal',
						datatype: 'xsd:string',
						note: 'Book title',
					}),
					createStatement({
						label: 'Subject',
						propertyId: 'dcterms:subject',
						min: 0,
						max: null,
						valueType: 'iri',
						inScheme: ['skos:'],
					}),
				],
			}),
			createDescription({
				name: 'Agent',
				statements: [
					createStatement({
						label: 'Name',
						propertyId: 'foaf:name',
						min: 1,
						max: 1,
						valueType: 'literal',
					}),
				],
			}),
		];

		// Generate SimpleDSP text
		const text = buildSimpleDsp(original);

		// Parse it back
		const result = parseSimpleDsp(text);
		expect(result.errors).toHaveLength(0);

		const parsed = result.data;

		// Structural checks
		expect(parsed.base).toBe('http://example.org/');
		expect(parsed.namespaces['ex']).toBe('http://example.org/vocab/');
		expect(parsed.descriptions).toHaveLength(2);

		// First description
		const book = parsed.descriptions[0];
		expect(book.name).toBe('MAIN');
		expect(book.targetClass).toBe('ex:Book');
		expect(book.statements).toHaveLength(2);

		const title = book.statements[0];
		expect(title.label).toBe('Title');
		expect(title.propertyId).toBe('dcterms:title');
		expect(title.min).toBe(1);
		expect(title.max).toBe(1);
		expect(title.valueType).toBe('literal');
		expect(title.datatype).toBe('xsd:string');
		expect(title.note).toBe('Book title');

		const subject = book.statements[1];
		expect(subject.label).toBe('Subject');
		expect(subject.propertyId).toBe('dcterms:subject');
		expect(subject.min).toBe(0);
		expect(subject.max).toBeNull();
		expect(subject.valueType).toBe('iri');
		expect(subject.inScheme).toEqual(['skos:']);

		// Second description
		const agent = parsed.descriptions[1];
		expect(agent.name).toBe('Agent');
		expect(agent.statements).toHaveLength(1);
		expect(agent.statements[0].label).toBe('Name');
		expect(agent.statements[0].propertyId).toBe('foaf:name');
	});

	it('preserves shape references through round-trip', () => {
		const original = makeProject();
		original.descriptions = [
			createDescription({
				name: 'Main',
				statements: [
					createStatement({
						label: 'Creator',
						propertyId: 'dcterms:creator',
						min: 0,
						max: null,
						shapeRefs: ['Agent'],
					}),
				],
			}),
			createDescription({
				name: 'Agent',
				statements: [
					createStatement({
						label: 'Name',
						propertyId: 'foaf:name',
						min: 1,
						max: 1,
						valueType: 'literal',
					}),
				],
			}),
		];

		const text = buildSimpleDsp(original);
		const result = parseSimpleDsp(text);
		expect(result.errors).toHaveLength(0);

		const mainStmt = result.data.descriptions[0].statements[0];
		expect(mainStmt.shapeRefs).toEqual(['Agent']);
	});

	it('preserves quoted picklist values through round-trip', () => {
		const original = makeProject();
		original.descriptions = [
			createDescription({
				name: 'Item',
				statements: [
					createStatement({
						label: 'Status',
						propertyId: 'ex:status',
						valueType: 'literal',
						values: ['active', 'inactive', 'pending'],
					}),
				],
			}),
		];

		const text = buildSimpleDsp(original);
		const result = parseSimpleDsp(text);
		const stmt = result.data.descriptions[0].statements[0];
		expect(stmt.values).toEqual(['active', 'inactive', 'pending']);
	});
});
