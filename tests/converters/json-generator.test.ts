import { describe, it, expect } from 'vitest';
import { buildYamaJson } from '$lib/converters/json-generator';
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

// ── buildYamaJson ───────────────────────────────────────────────

describe('buildYamaJson', () => {
	it('generates valid JSON', () => {
		const project = makeProject({ base: 'http://example.org/' });
		const json = buildYamaJson(project);
		expect(() => JSON.parse(json)).not.toThrow();
	});

	it('includes base IRI', () => {
		const project = makeProject({ base: 'http://example.org/' });
		project.descriptions = [
			createDescription({ name: 'Thing', statements: [] }),
		];
		const json = buildYamaJson(project);
		const obj = JSON.parse(json);
		expect(obj.base).toBe('http://example.org/');
	});

	it('omits base when empty', () => {
		const project = makeProject();
		const json = buildYamaJson(project);
		const obj = JSON.parse(json);
		expect(obj.base).toBeUndefined();
	});

	it('includes namespaces', () => {
		const project = makeProject({
			namespaces: { foaf: 'http://xmlns.com/foaf/0.1/' },
		});
		project.descriptions = [
			createDescription({ name: 'Thing', statements: [] }),
		];
		const json = buildYamaJson(project);
		const obj = JSON.parse(json);
		expect(obj.namespaces.foaf).toBe('http://xmlns.com/foaf/0.1/');
	});

	it('includes description with targetClass as "a"', () => {
		const project = makeProject();
		project.descriptions = [
			createDescription({
				name: 'Person',
				targetClass: 'foaf:Person',
				label: 'A Person',
				note: 'Test note',
				statements: [],
			}),
		];
		const json = buildYamaJson(project);
		const obj = JSON.parse(json);
		expect(obj.descriptions.Person.a).toBe('foaf:Person');
		expect(obj.descriptions.Person.label).toBe('A Person');
		expect(obj.descriptions.Person.note).toBe('Test note');
	});

	it('includes statement properties', () => {
		const project = makeProject();
		project.descriptions = [
			createDescription({
				name: 'Person',
				statements: [
					createStatement({
						id: 'name',
						propertyId: 'foaf:name',
						label: 'Name',
						min: 1,
						max: 1,
						valueType: 'literal',
						datatype: 'xsd:string',
					}),
				],
			}),
		];
		const json = buildYamaJson(project);
		const obj = JSON.parse(json);
		const stmt = obj.descriptions.Person.statements.name;
		expect(stmt.property).toBe('foaf:name');
		expect(stmt.label).toBe('Name');
		expect(stmt.min).toBe(1);
		expect(stmt.max).toBe(1);
		expect(stmt.type).toBe('literal');
		expect(stmt.datatype).toBe('xsd:string');
	});

	it('includes shape reference as "description"', () => {
		const project = makeProject();
		project.descriptions = [
			createDescription({
				name: 'Book',
				statements: [
					createStatement({
						id: 'author',
						propertyId: 'dcterms:creator',
						shapeRefs: ['Person'],
					}),
				],
			}),
		];
		const json = buildYamaJson(project);
		const obj = JSON.parse(json);
		expect(obj.descriptions.Book.statements.author.description).toBe('Person');
	});

	it('includes values array', () => {
		const project = makeProject();
		project.descriptions = [
			createDescription({
				name: 'Item',
				statements: [
					createStatement({
						id: 'status',
						propertyId: 'ex:status',
						values: ['active', 'inactive'],
					}),
				],
			}),
		];
		const json = buildYamaJson(project);
		const obj = JSON.parse(json);
		expect(obj.descriptions.Item.statements.status.values).toEqual([
			'active',
			'inactive',
		]);
	});

	it('includes facets', () => {
		const project = makeProject();
		project.descriptions = [
			createDescription({
				name: 'Item',
				statements: [
					createStatement({
						id: 'count',
						propertyId: 'ex:count',
						facets: { MinInclusive: 0, MaxInclusive: 100 },
					}),
				],
			}),
		];
		const json = buildYamaJson(project);
		const obj = JSON.parse(json);
		expect(obj.descriptions.Item.statements.count.facets.MinInclusive).toBe(0);
		expect(obj.descriptions.Item.statements.count.facets.MaxInclusive).toBe(100);
	});

	it('omits empty/default fields', () => {
		const project = makeProject();
		project.descriptions = [
			createDescription({
				name: 'Thing',
				statements: [
					createStatement({
						id: 'prop',
						propertyId: 'ex:prop',
					}),
				],
			}),
		];
		const json = buildYamaJson(project);
		const obj = JSON.parse(json);
		const stmt = obj.descriptions.Thing.statements.prop;
		expect(stmt.note).toBeUndefined();
		expect(stmt.label).toBeUndefined();
		expect(stmt.datatype).toBeUndefined();
		expect(stmt.pattern).toBeUndefined();
		expect(stmt.values).toBeUndefined();
		expect(stmt.facets).toBeUndefined();
	});

	it('respects custom indent', () => {
		const project = makeProject({ base: 'http://example.org/' });
		project.descriptions = [
			createDescription({ name: 'Thing', statements: [] }),
		];
		const json4 = buildYamaJson(project, 4);
		expect(json4).toContain('    '); // 4-space indent
	});

	it('generates parseable output for round-trip', () => {
		const project = makeProject({
			base: 'http://example.org/',
			namespaces: { foaf: 'http://xmlns.com/foaf/0.1/' },
		});
		project.descriptions = [
			createDescription({
				name: 'Person',
				targetClass: 'foaf:Person',
				statements: [
					createStatement({
						id: 'name',
						propertyId: 'foaf:name',
						min: 1,
						max: 1,
						valueType: 'literal',
						datatype: 'xsd:string',
					}),
				],
			}),
		];

		const json = buildYamaJson(project);
		const obj = JSON.parse(json);

		expect(obj.base).toBe('http://example.org/');
		expect(obj.namespaces.foaf).toBe('http://xmlns.com/foaf/0.1/');
		expect(obj.descriptions.Person).toBeDefined();
		expect(obj.descriptions.Person.a).toBe('foaf:Person');
		expect(obj.descriptions.Person.statements.name.property).toBe('foaf:name');
	});
});
