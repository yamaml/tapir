import { describe, it, expect } from 'vitest';
import {
	buildShExC,
	formatCardinality,
	formatNodeConstraint,
} from '$lib/converters/shex-generator';
import { createProject, createDescription, createStatement } from '$lib/types/profile';
import type { TapirProject } from '$lib/types';

// ── Helpers ─────────────────────────────────────────────────────

function makeProject(overrides?: Partial<TapirProject>): TapirProject {
	return createProject({
		name: 'Test',
		flavor: 'dctap',
		...overrides,
	});
}

// ── formatCardinality ───────────────────────────────────────────

describe('formatCardinality', () => {
	it('returns empty string when both null', () => {
		expect(formatCardinality(null, null)).toBe('');
	});

	it('returns * for 0..unbounded', () => {
		expect(formatCardinality(0, -1)).toBe(' *');
	});

	it('returns + for 1..unbounded', () => {
		expect(formatCardinality(1, -1)).toBe(' +');
	});

	it('returns ? for 0..1', () => {
		expect(formatCardinality(0, 1)).toBe(' ?');
	});

	it('returns {m,} for min-only', () => {
		expect(formatCardinality(2, undefined)).toBe(' {2,}');
	});

	it('returns {n} for exact', () => {
		expect(formatCardinality(3, 3)).toBe(' {3}');
	});

	it('returns {m,n} for range', () => {
		expect(formatCardinality(2, 5)).toBe(' {2,5}');
	});
});

// ── formatNodeConstraint ────────────────────────────────────────

describe('formatNodeConstraint', () => {
	it('returns shape reference', () => {
		const stmt = createStatement({ shapeRefs: ['Person'] });
		expect(formatNodeConstraint(stmt)).toBe('@<Person>');
	});

	it('returns disjunction for multiple shape references', () => {
		const stmt = createStatement({ shapeRefs: ['Person', 'Organization'] });
		expect(formatNodeConstraint(stmt)).toBe('(@<Person> OR @<Organization>)');
	});

	it('returns datatype', () => {
		const stmt = createStatement({ datatype: 'xsd:string' });
		expect(formatNodeConstraint(stmt)).toBe('xsd:string');
	});

	it('returns value set', () => {
		const stmt = createStatement({ values: ['red', 'green', 'blue'] });
		expect(formatNodeConstraint(stmt)).toBe('["red" "green" "blue"]');
	});

	it('returns IRI for iri valueType', () => {
		const stmt = createStatement({ valueType: 'iri' });
		expect(formatNodeConstraint(stmt)).toBe('IRI');
	});

	it('returns LITERAL for literal valueType', () => {
		const stmt = createStatement({ valueType: 'literal' });
		expect(formatNodeConstraint(stmt)).toBe('LITERAL');
	});

	it('returns BNODE for bnode valueType', () => {
		const stmt = createStatement({ valueType: 'bnode' });
		expect(formatNodeConstraint(stmt)).toBe('BNODE');
	});

	it('defaults to LITERAL when no type specified', () => {
		const stmt = createStatement();
		expect(formatNodeConstraint(stmt)).toBe('LITERAL');
	});

	it('appends pattern facet', () => {
		const stmt = createStatement({
			datatype: 'xsd:string',
			pattern: '^[A-Z]',
		});
		expect(formatNodeConstraint(stmt)).toBe('xsd:string //^[A-Z]//');
	});

	it('appends numeric facets', () => {
		const stmt = createStatement({
			datatype: 'xsd:integer',
			facets: { MinInclusive: 0, MaxInclusive: 100 },
		});
		expect(formatNodeConstraint(stmt)).toBe(
			'xsd:integer MinInclusive 0 MaxInclusive 100'
		);
	});

	it('shape reference takes precedence over datatype', () => {
		const stmt = createStatement({
			shapeRefs: ['Person'],
			datatype: 'xsd:string',
		});
		expect(formatNodeConstraint(stmt)).toBe('@<Person>');
	});
});

// ── buildShExC ──────────────────────────────────────────────────

describe('buildShExC', () => {
	it('generates header comment', () => {
		const project = makeProject();
		const shex = buildShExC(project);
		expect(shex).toContain('# Generated with YAMA');
		expect(shex).toContain('# https://www.yamaml.org');
	});

	it('generates PREFIX declarations', () => {
		const project = makeProject({
			namespaces: {
				foaf: 'http://xmlns.com/foaf/0.1/',
				xsd: 'http://www.w3.org/2001/XMLSchema#',
			},
		});
		const shex = buildShExC(project);
		expect(shex).toContain('PREFIX foaf: <http://xmlns.com/foaf/0.1/>');
		expect(shex).toContain('PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>');
	});

	it('generates BASE declaration', () => {
		const project = makeProject({ base: 'http://example.org/' });
		const shex = buildShExC(project);
		expect(shex).toContain('BASE <http://example.org/>');
	});

	it('omits BASE when empty', () => {
		const project = makeProject();
		const shex = buildShExC(project);
		expect(shex).not.toContain('BASE');
	});

	it('generates shape with EXTRA a for targetClass', () => {
		const project = makeProject();
		project.descriptions = [
			createDescription({
				name: 'Person',
				targetClass: 'foaf:Person',
				statements: [],
			}),
		];
		const shex = buildShExC(project);
		expect(shex).toContain('<Person> EXTRA a {');
		expect(shex).toContain('a [foaf:Person]');
	});

	it('generates shape without EXTRA a when no targetClass', () => {
		const project = makeProject();
		project.descriptions = [
			createDescription({
				name: 'Thing',
				statements: [],
			}),
		];
		const shex = buildShExC(project);
		expect(shex).toContain('<Thing> {');
		expect(shex).not.toContain('EXTRA a');
	});

	it('generates triple constraints with cardinality', () => {
		const project = makeProject();
		project.descriptions = [
			createDescription({
				name: 'Person',
				statements: [
					createStatement({
						propertyId: 'foaf:name',
						valueType: 'literal',
						datatype: 'xsd:string',
						min: 1,
						max: 1,
					}),
					createStatement({
						propertyId: 'foaf:knows',
						shapeRefs: ['Person'],
						min: 0,
						max: -1,
					}),
				],
			}),
		];
		const shex = buildShExC(project);
		expect(shex).toContain('foaf:name xsd:string');
		expect(shex).toContain('foaf:knows @<Person> *');
	});

	it('joins triple constraints with semicolons', () => {
		const project = makeProject();
		project.descriptions = [
			createDescription({
				name: 'Person',
				statements: [
					createStatement({ propertyId: 'foaf:name', valueType: 'literal' }),
					createStatement({ propertyId: 'foaf:age', datatype: 'xsd:integer' }),
				],
			}),
		];
		const shex = buildShExC(project);
		expect(shex).toContain(' ;\n');
	});

	it('skips statements without propertyId', () => {
		const project = makeProject();
		project.descriptions = [
			createDescription({
				name: 'Thing',
				statements: [
					createStatement({ propertyId: '', valueType: 'literal' }),
					createStatement({ propertyId: 'foaf:name', valueType: 'literal' }),
				],
			}),
		];
		const shex = buildShExC(project);
		expect(shex).toContain('foaf:name');
		// Should only have one triple constraint (the one with propertyId)
		const lines = shex.split('\n');
		const constraintLines = lines.filter((l) => l.trimStart().startsWith('foaf:'));
		expect(constraintLines).toHaveLength(1);
	});

	it('generates complete output for realistic project', () => {
		const project = makeProject({
			base: 'http://example.org/',
			namespaces: {
				foaf: 'http://xmlns.com/foaf/0.1/',
				xsd: 'http://www.w3.org/2001/XMLSchema#',
			},
		});
		project.descriptions = [
			createDescription({
				name: 'Person',
				targetClass: 'foaf:Person',
				statements: [
					createStatement({
						propertyId: 'foaf:name',
						datatype: 'xsd:string',
						min: 1,
						max: 1,
					}),
					createStatement({
						propertyId: 'foaf:knows',
						shapeRefs: ['Person'],
						min: 0,
						max: -1,
					}),
				],
			}),
		];

		const shex = buildShExC(project);
		expect(shex).toContain('PREFIX foaf: <http://xmlns.com/foaf/0.1/>');
		expect(shex).toContain('BASE <http://example.org/>');
		expect(shex).toContain('<Person> EXTRA a {');
		expect(shex).toContain('a [foaf:Person]');
		expect(shex).toContain('foaf:name xsd:string');
		expect(shex).toContain('foaf:knows @<Person> *');
	});
});
