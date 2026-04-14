import { describe, it, expect } from 'vitest';
import { buildYamaYaml } from '$lib/converters/yaml-generator';
import { parseYamaYaml } from '$lib/converters/yaml-parser';
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

// ── buildYamaYaml ───────────────────────────────────────────────

describe('buildYamaYaml', () => {
	it('generates empty YAML for empty project', () => {
		const project = makeProject();
		const yaml = buildYamaYaml(project);
		// Empty project produces minimal YAML object
		expect(yaml.trim()).toBe('{}');
	});

	it('includes base IRI', () => {
		const project = makeProject({ base: 'http://example.org/' });
		project.descriptions = [
			createDescription({ name: 'Thing', statements: [] }),
		];
		const yaml = buildYamaYaml(project);
		expect(yaml).toContain('base: http://example.org/');
	});

	it('includes namespaces', () => {
		const project = makeProject({
			namespaces: {
				foaf: 'http://xmlns.com/foaf/0.1/',
			},
		});
		project.descriptions = [
			createDescription({ name: 'Thing', statements: [] }),
		];
		const yaml = buildYamaYaml(project);
		expect(yaml).toContain('foaf: http://xmlns.com/foaf/0.1/');
	});

	it('includes description with targetClass', () => {
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
		const yaml = buildYamaYaml(project);
		expect(yaml).toContain('Person:');
		expect(yaml).toContain('a: foaf:Person');
		expect(yaml).toContain('label: A Person');
		expect(yaml).toContain('note: Test note');
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
						note: 'Full name',
					}),
				],
			}),
		];
		const yaml = buildYamaYaml(project);
		expect(yaml).toContain('property: foaf:name');
		expect(yaml).toContain('label: Name');
		expect(yaml).toContain('min: 1');
		expect(yaml).toContain('max: 1');
		expect(yaml).toContain('type: literal');
		expect(yaml).toContain('datatype: xsd:string');
		expect(yaml).toContain('note: Full name');
	});

	it('includes shape reference as description', () => {
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
		const yaml = buildYamaYaml(project);
		expect(yaml).toContain('description: Person');
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
		const yaml = buildYamaYaml(project);
		expect(yaml).toContain('active');
		expect(yaml).toContain('inactive');
	});

	it('includes pattern', () => {
		const project = makeProject();
		project.descriptions = [
			createDescription({
				name: 'Item',
				statements: [
					createStatement({
						id: 'email',
						propertyId: 'foaf:mbox',
						pattern: '^[a-z]+@',
					}),
				],
			}),
		];
		const yaml = buildYamaYaml(project);
		expect(yaml).toContain('pattern:');
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
		const yaml = buildYamaYaml(project);
		// Should not contain fields that are empty/default
		expect(yaml).not.toContain('note:');
		expect(yaml).not.toContain('label:');
		expect(yaml).not.toContain('datatype:');
		expect(yaml).not.toContain('pattern:');
	});
});

// ── Round-trip Test ─────────────────────────────────────────────

describe('round-trip (generate -> parse)', () => {
	it('preserves project structure through YAML round-trip', () => {
		const original = makeProject({
			base: 'http://example.org/',
			namespaces: {
				foaf: 'http://xmlns.com/foaf/0.1/',
				xsd: 'http://www.w3.org/2001/XMLSchema#',
			},
		});
		original.descriptions = [
			createDescription({
				name: 'Person',
				targetClass: 'foaf:Person',
				label: 'A Person',
				note: 'Person description',
				statements: [
					createStatement({
						id: 'name',
						propertyId: 'foaf:name',
						label: 'Name',
						min: 1,
						max: 1,
						valueType: 'literal',
						datatype: 'xsd:string',
						note: 'Full name',
					}),
					createStatement({
						id: 'knows',
						propertyId: 'foaf:knows',
						valueType: 'iri',
						shapeRefs: ['Person'],
						min: 0,
						max: -1,
					}),
				],
			}),
		];

		const yaml = buildYamaYaml(original);
		const result = parseYamaYaml(yaml);
		expect(result.errors).toHaveLength(0);

		const parsed = result.data;
		expect(parsed.base).toBe('http://example.org/');
		expect(parsed.namespaces['foaf']).toBe('http://xmlns.com/foaf/0.1/');
		expect(parsed.descriptions).toHaveLength(1);

		const desc = parsed.descriptions[0];
		expect(desc.name).toBe('Person');
		expect(desc.targetClass).toBe('foaf:Person');
		expect(desc.label).toBe('A Person');
		expect(desc.note).toBe('Person description');
		expect(desc.statements).toHaveLength(2);

		const nameStmt = desc.statements[0];
		expect(nameStmt.id).toBe('name');
		expect(nameStmt.propertyId).toBe('foaf:name');
		expect(nameStmt.min).toBe(1);
		expect(nameStmt.max).toBe(1);
		expect(nameStmt.datatype).toBe('xsd:string');

		const knowsStmt = desc.statements[1];
		expect(knowsStmt.shapeRefs).toEqual(['Person']);
		expect(knowsStmt.min).toBe(0);
		expect(knowsStmt.max).toBe(-1);
	});

	it('preserves values through round-trip', () => {
		const original = makeProject();
		original.descriptions = [
			createDescription({
				name: 'Item',
				statements: [
					createStatement({
						id: 'status',
						propertyId: 'ex:status',
						values: ['active', 'inactive', 'pending'],
					}),
				],
			}),
		];

		const yaml = buildYamaYaml(original);
		const result = parseYamaYaml(yaml);
		const stmt = result.data.descriptions[0].statements[0];
		expect(stmt.values).toEqual(['active', 'inactive', 'pending']);
	});

	it('emits `description:` as a scalar for single shape ref', () => {
		const project = makeProject();
		project.descriptions = [
			createDescription({
				name: 'Work',
				statements: [
					createStatement({
						id: 'creator',
						propertyId: 'dcterms:creator',
						valueType: 'iri',
						shapeRefs: ['Person'],
					}),
				],
			}),
		];
		const yaml = buildYamaYaml(project);
		expect(yaml).toMatch(/description:\s*Person\b/);
	});

	it('emits `description:` as a list for multi-shape ref and round-trips', () => {
		const project = makeProject();
		project.descriptions = [
			createDescription({
				name: 'Work',
				statements: [
					createStatement({
						id: 'creator',
						propertyId: 'dcterms:creator',
						valueType: 'iri',
						shapeRefs: ['Person', 'Organization'],
					}),
				],
			}),
		];
		const yaml = buildYamaYaml(project);
		expect(yaml).toContain('Person');
		expect(yaml).toContain('Organization');
		const parsed = parseYamaYaml(yaml).data;
		expect(parsed.descriptions[0].statements[0].shapeRefs).toEqual([
			'Person',
			'Organization',
		]);
	});
});
