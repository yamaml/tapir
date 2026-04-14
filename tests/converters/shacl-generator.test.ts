import { describe, it, expect } from 'vitest';
import {
	buildShacl,
	buildShaclQuads,
	buildPropertyShape,
	buildRdfList,
	resolveNodeKind,
} from '$lib/converters/shacl-generator';
import { createProject, createDescription, createStatement } from '$lib/types/profile';
import type { TapirProject, NamespaceMap } from '$lib/types';
import N3 from 'n3';

const { DataFactory } = N3;
const { namedNode, literal, blankNode, quad } = DataFactory;

// ── Helpers ─────────────────────────────────────────────────────

function makeProject(overrides?: Partial<TapirProject>): TapirProject {
	return createProject({
		name: 'Test',
		flavor: 'dctap',
		...overrides,
	});
}

const SH = 'http://www.w3.org/ns/shacl#';
const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';

// ── resolveNodeKind ─────────────────────────────────────────────

describe('resolveNodeKind', () => {
	it('maps iri to sh:IRI', () => {
		const result = resolveNodeKind('iri');
		expect(result?.value).toBe(`${SH}IRI`);
	});

	it('maps literal to sh:Literal', () => {
		const result = resolveNodeKind('literal');
		expect(result?.value).toBe(`${SH}Literal`);
	});

	it('maps bnode to sh:BlankNodeOrIRI', () => {
		const result = resolveNodeKind('bnode');
		expect(result?.value).toBe(`${SH}BlankNodeOrIRI`);
	});

	it('returns null for empty or unknown', () => {
		expect(resolveNodeKind('')).toBeNull();
		expect(resolveNodeKind('unknown')).toBeNull();
	});
});

// ── buildRdfList ────────────────────────────────────────────────

describe('buildRdfList', () => {
	it('returns rdf:nil for empty list', () => {
		const quads: N3.Quad[] = [];
		const head = buildRdfList([], quads);
		expect(head.value).toBe(`${RDF}nil`);
		expect(quads).toHaveLength(0);
	});

	it('builds single-element list', () => {
		const quads: N3.Quad[] = [];
		const item = literal('hello');
		const head = buildRdfList([item], quads);

		expect(head.termType).toBe('BlankNode');
		expect(quads).toHaveLength(2); // rdf:first + rdf:rest
		expect(quads[0].predicate.value).toBe(`${RDF}first`);
		expect(quads[0].object.value).toBe('hello');
		expect(quads[1].predicate.value).toBe(`${RDF}rest`);
		expect(quads[1].object.value).toBe(`${RDF}nil`);
	});

	it('builds multi-element list', () => {
		const quads: N3.Quad[] = [];
		const items = [literal('a'), literal('b'), literal('c')];
		const head = buildRdfList(items, quads);

		expect(head.termType).toBe('BlankNode');
		// 3 items: 3 rdf:first + 3 rdf:rest = 6 quads
		expect(quads).toHaveLength(6);

		// Last rest should be rdf:nil
		const restQuads = quads.filter((q) => q.predicate.value === `${RDF}rest`);
		expect(restQuads[restQuads.length - 1].object.value).toBe(`${RDF}nil`);
	});
});

// ── buildPropertyShape ──────────────────────────────────────────

describe('buildPropertyShape', () => {
	const ns: NamespaceMap = { foaf: 'http://xmlns.com/foaf/0.1/' };
	const base = 'http://example.org/';

	it('creates basic property shape', () => {
		const quads: N3.Quad[] = [];
		const shapeNode = namedNode('http://example.org/PersonShape');
		const stmt = createStatement({
			propertyId: 'foaf:name',
			label: 'Name',
			note: 'Full name',
		});

		buildPropertyShape(shapeNode, stmt, ns, base, quads);

		const predicates = quads.map((q) => q.predicate.value);
		expect(predicates).toContain(`${RDF}type`);
		expect(predicates).toContain(`${SH}property`);
		expect(predicates).toContain(`${SH}path`);
		expect(predicates).toContain(`${SH}name`);
		expect(predicates).toContain(`${SH}description`);

		// Check sh:path value
		const pathQuad = quads.find((q) => q.predicate.value === `${SH}path`);
		expect(pathQuad?.object.value).toBe('http://xmlns.com/foaf/0.1/name');
	});

	it('adds sh:minCount and sh:maxCount', () => {
		const quads: N3.Quad[] = [];
		const shapeNode = namedNode('http://example.org/S');
		const stmt = createStatement({
			propertyId: 'foaf:name',
			min: 1,
			max: 3,
		});

		buildPropertyShape(shapeNode, stmt, ns, base, quads);

		const minQ = quads.find((q) => q.predicate.value === `${SH}minCount`);
		expect(minQ?.object.value).toBe('1');
		const maxQ = quads.find((q) => q.predicate.value === `${SH}maxCount`);
		expect(maxQ?.object.value).toBe('3');
	});

	it('adds sh:datatype', () => {
		const quads: N3.Quad[] = [];
		const xsd: NamespaceMap = { xsd: 'http://www.w3.org/2001/XMLSchema#' };
		const shapeNode = namedNode('http://example.org/S');
		const stmt = createStatement({
			propertyId: 'foaf:name',
			datatype: 'xsd:string',
		});

		buildPropertyShape(shapeNode, stmt, { ...ns, ...xsd }, base, quads);

		const dtQ = quads.find((q) => q.predicate.value === `${SH}datatype`);
		expect(dtQ?.object.value).toBe('http://www.w3.org/2001/XMLSchema#string');
	});

	it('adds sh:nodeKind when no datatype', () => {
		const quads: N3.Quad[] = [];
		const shapeNode = namedNode('http://example.org/S');
		const stmt = createStatement({
			propertyId: 'foaf:name',
			valueType: 'iri',
		});

		buildPropertyShape(shapeNode, stmt, ns, base, quads);

		const nkQ = quads.find((q) => q.predicate.value === `${SH}nodeKind`);
		expect(nkQ?.object.value).toBe(`${SH}IRI`);
	});

	it('omits sh:nodeKind when datatype is present', () => {
		const quads: N3.Quad[] = [];
		const xsd: NamespaceMap = { xsd: 'http://www.w3.org/2001/XMLSchema#' };
		const shapeNode = namedNode('http://example.org/S');
		const stmt = createStatement({
			propertyId: 'foaf:name',
			valueType: 'literal',
			datatype: 'xsd:string',
		});

		buildPropertyShape(shapeNode, stmt, { ...ns, ...xsd }, base, quads);

		const nkQ = quads.find((q) => q.predicate.value === `${SH}nodeKind`);
		expect(nkQ).toBeUndefined();
	});

	it('adds sh:node for shape reference', () => {
		const quads: N3.Quad[] = [];
		const shapeNode = namedNode('http://example.org/S');
		const stmt = createStatement({
			propertyId: 'foaf:name',
			shapeRefs: ['AgentShape'],
		});

		buildPropertyShape(shapeNode, stmt, ns, base, quads);

		const nodeQ = quads.find((q) => q.predicate.value === `${SH}node`);
		expect(nodeQ?.object.value).toBe('http://example.org/AgentShape');
	});

	it('adds facets (minInclusive, maxInclusive)', () => {
		const quads: N3.Quad[] = [];
		const shapeNode = namedNode('http://example.org/S');
		const stmt = createStatement({
			propertyId: 'foaf:name',
			facets: { MinInclusive: 0, MaxInclusive: 100 },
		});

		buildPropertyShape(shapeNode, stmt, ns, base, quads);

		const minQ = quads.find((q) => q.predicate.value === `${SH}minInclusive`);
		expect(minQ?.object.value).toBe('0');
		const maxQ = quads.find((q) => q.predicate.value === `${SH}maxInclusive`);
		expect(maxQ?.object.value).toBe('100');
	});

	it('adds sh:pattern', () => {
		const quads: N3.Quad[] = [];
		const shapeNode = namedNode('http://example.org/S');
		const stmt = createStatement({
			propertyId: 'foaf:name',
			pattern: '^[A-Z]',
		});

		buildPropertyShape(shapeNode, stmt, ns, base, quads);

		const patQ = quads.find((q) => q.predicate.value === `${SH}pattern`);
		expect(patQ?.object.value).toBe('^[A-Z]');
	});

	it('adds sh:in for enumerated values', () => {
		const quads: N3.Quad[] = [];
		const shapeNode = namedNode('http://example.org/S');
		const stmt = createStatement({
			propertyId: 'foaf:name',
			values: ['red', 'green', 'blue'],
		});

		buildPropertyShape(shapeNode, stmt, ns, base, quads);

		const inQ = quads.find((q) => q.predicate.value === `${SH}in`);
		expect(inQ).toBeDefined();
	});

	it('skips property with empty propertyId', () => {
		const quads: N3.Quad[] = [];
		const shapeNode = namedNode('http://example.org/S');
		const stmt = createStatement({ propertyId: '' });

		buildPropertyShape(shapeNode, stmt, ns, base, quads);

		expect(quads).toHaveLength(0);
	});
});

// ── buildShaclQuads ─────────────────────────────────────────────

describe('buildShaclQuads', () => {
	const ns: NamespaceMap = {
		sh: SH,
		foaf: 'http://xmlns.com/foaf/0.1/',
	};

	it('creates NodeShape for each description', () => {
		const project = makeProject({ base: 'http://example.org/' });
		project.descriptions = [
			createDescription({ name: 'PersonShape' }),
			createDescription({ name: 'BookShape' }),
		];

		const quads = buildShaclQuads(project, ns, 'http://example.org/');

		const typeQuads = quads.filter(
			(q) =>
				q.predicate.value === `${RDF}type` &&
				q.object.value === `${SH}NodeShape`
		);
		expect(typeQuads).toHaveLength(2);
	});

	it('adds sh:targetClass from targetClass', () => {
		const project = makeProject({ base: 'http://example.org/' });
		project.descriptions = [
			createDescription({
				name: 'PersonShape',
				targetClass: 'foaf:Person',
			}),
		];

		const quads = buildShaclQuads(project, ns, 'http://example.org/');

		const tcQ = quads.find((q) => q.predicate.value === `${SH}targetClass`);
		expect(tcQ?.object.value).toBe('http://xmlns.com/foaf/0.1/Person');
	});

	it('adds sh:name from label', () => {
		const project = makeProject({ base: 'http://example.org/' });
		project.descriptions = [
			createDescription({
				name: 'PersonShape',
				label: 'Person',
			}),
		];

		const quads = buildShaclQuads(project, ns, 'http://example.org/');

		const nameQ = quads.find(
			(q) =>
				q.subject.value === 'http://example.org/PersonShape' &&
				q.predicate.value === `${SH}name`
		);
		expect(nameQ?.object.value).toBe('Person');
	});

	it('adds sh:description from note', () => {
		const project = makeProject({ base: 'http://example.org/' });
		project.descriptions = [
			createDescription({
				name: 'PersonShape',
				note: 'A person shape',
			}),
		];

		const quads = buildShaclQuads(project, ns, 'http://example.org/');

		const descQ = quads.find(
			(q) =>
				q.subject.value === 'http://example.org/PersonShape' &&
				q.predicate.value === `${SH}description`
		);
		expect(descQ?.object.value).toBe('A person shape');
	});

	it('adds sh:closed and sh:ignoredProperties for closed shapes', () => {
		const project = makeProject({ base: 'http://example.org/' });
		project.descriptions = [
			createDescription({
				name: 'ClosedShape',
				closed: true,
			}),
		];

		const quads = buildShaclQuads(project, ns, 'http://example.org/');

		const closedQ = quads.find((q) => q.predicate.value === `${SH}closed`);
		expect(closedQ?.object.value).toBe('true');

		const ignoredQ = quads.find(
			(q) => q.predicate.value === `${SH}ignoredProperties`
		);
		expect(ignoredQ).toBeDefined();
	});

	it('generates property shapes for statements', () => {
		const project = makeProject({ base: 'http://example.org/' });
		project.descriptions = [
			createDescription({
				name: 'PersonShape',
				statements: [
					createStatement({
						propertyId: 'foaf:name',
						min: 1,
						max: 1,
						valueType: 'literal',
					}),
				],
			}),
		];

		const quads = buildShaclQuads(project, ns, 'http://example.org/');

		const propQ = quads.find((q) => q.predicate.value === `${SH}property`);
		expect(propQ).toBeDefined();

		const pathQ = quads.find((q) => q.predicate.value === `${SH}path`);
		expect(pathQ?.object.value).toBe('http://xmlns.com/foaf/0.1/name');
	});
});

// ── buildShacl (serialization) ──────────────────────────────────

describe('buildShacl', () => {
	it('serializes to Turtle by default', async () => {
		const project = makeProject({
			base: 'http://example.org/',
			namespaces: { foaf: 'http://xmlns.com/foaf/0.1/' },
		});
		project.descriptions = [
			createDescription({
				name: 'PersonShape',
				targetClass: 'foaf:Person',
				label: 'Person',
				statements: [
					createStatement({
						propertyId: 'foaf:name',
						label: 'Name',
						min: 1,
						max: 1,
						valueType: 'literal',
					}),
				],
			}),
		];

		const turtle = await buildShacl(project);

		// Should contain Turtle syntax
		expect(turtle).toContain('sh:NodeShape');
		expect(turtle).toContain('sh:targetClass');
		expect(turtle).toContain('sh:path');
		expect(turtle).toContain('sh:minCount');
		expect(turtle).toContain('sh:maxCount');
	});

	it('serializes to N-Triples', async () => {
		const project = makeProject({
			base: 'http://example.org/',
			namespaces: { foaf: 'http://xmlns.com/foaf/0.1/' },
		});
		project.descriptions = [
			createDescription({
				name: 'PersonShape',
				statements: [
					createStatement({
						propertyId: 'foaf:name',
						valueType: 'literal',
					}),
				],
			}),
		];

		const ntriples = await buildShacl(project, 'ntriples');

		// N-Triples uses full IRIs, no prefixes
		expect(ntriples).toContain('<http://www.w3.org/ns/shacl#NodeShape>');
		expect(ntriples).toContain('<http://example.org/PersonShape>');
	});

	it('handles empty project', async () => {
		const project = makeProject();
		const turtle = await buildShacl(project);
		expect(turtle).toBeDefined();
		// N3.Writer always emits prefix declarations; no shape triples present
		expect(turtle).not.toContain('sh:NodeShape');
	});

	it('includes sh:in list for enumerated values', async () => {
		const project = makeProject({
			base: 'http://example.org/',
			namespaces: {},
		});
		project.descriptions = [
			createDescription({
				name: 'S',
				statements: [
					createStatement({
						propertyId: 'http://example.org/color',
						values: ['red', 'green'],
					}),
				],
			}),
		];

		const turtle = await buildShacl(project);
		expect(turtle).toContain('sh:in');
		expect(turtle).toContain('"red"');
		expect(turtle).toContain('"green"');
	});

	it('includes sh:pattern', async () => {
		const project = makeProject({
			base: 'http://example.org/',
			namespaces: {},
		});
		project.descriptions = [
			createDescription({
				name: 'S',
				statements: [
					createStatement({
						propertyId: 'http://example.org/code',
						pattern: '^[A-Z]+$',
					}),
				],
			}),
		];

		const turtle = await buildShacl(project);
		expect(turtle).toContain('sh:pattern');
		expect(turtle).toContain('^[A-Z]+$');
	});

	it('includes sh:node for shape reference', async () => {
		const project = makeProject({
			base: 'http://example.org/',
			namespaces: {},
		});
		project.descriptions = [
			createDescription({
				name: 'BookShape',
				statements: [
					createStatement({
						propertyId: 'http://example.org/author',
						shapeRefs: ['PersonShape'],
					}),
				],
			}),
		];

		const turtle = await buildShacl(project);
		expect(turtle).toContain('sh:node');
	});

	it('emits sh:or for multi-shape disjunctions', async () => {
		const project = makeProject({
			base: 'http://example.org/',
			namespaces: {},
		});
		project.descriptions = [
			createDescription({
				name: 'WorkShape',
				statements: [
					createStatement({
						propertyId: 'http://example.org/creator',
						valueType: 'iri',
						shapeRefs: ['PersonShape', 'OrganizationShape'],
					}),
				],
			}),
			createDescription({ name: 'PersonShape' }),
			createDescription({ name: 'OrganizationShape' }),
		];

		const turtle = await buildShacl(project);
		expect(turtle).toContain('sh:or');
		expect(turtle).toContain('PersonShape');
		expect(turtle).toContain('OrganizationShape');
	});
});
