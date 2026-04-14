import { describe, it, expect } from 'vitest';
import {
	buildDataPackage,
	buildDataPackageObject,
} from '$lib/converters/datapackage-generator';
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

// ── buildDataPackageObject ──────────────────────────────────────

describe('buildDataPackageObject', () => {
	it('sets package id from base', () => {
		const project = makeProject({ base: 'http://example.org/' });
		const pkg = buildDataPackageObject(project);
		expect(pkg.id).toBe('http://example.org/');
	});

	it('omits id when base is empty', () => {
		const project = makeProject();
		const pkg = buildDataPackageObject(project);
		expect(pkg.id).toBeUndefined();
	});

	it('creates one resource per description', () => {
		const project = makeProject();
		project.descriptions = [
			createDescription({ name: 'Person', statements: [] }),
			createDescription({ name: 'Book', statements: [] }),
		];
		const pkg = buildDataPackageObject(project);
		expect(pkg.resources).toHaveLength(2);
		expect(pkg.resources[0].name).toBe('Person');
		expect(pkg.resources[1].name).toBe('Book');
	});

	it('sets resource title from description label', () => {
		const project = makeProject();
		project.descriptions = [
			createDescription({
				name: 'Person',
				label: 'A Person',
				statements: [],
			}),
		];
		const pkg = buildDataPackageObject(project);
		expect(pkg.resources[0].title).toBe('A Person');
	});

	it('sets resource description from description note', () => {
		const project = makeProject();
		project.descriptions = [
			createDescription({
				name: 'Person',
				note: 'Person entity',
				statements: [],
			}),
		];
		const pkg = buildDataPackageObject(project);
		expect(pkg.resources[0].description).toBe('Person entity');
	});

	it('maps string datatype to string type', () => {
		const project = makeProject();
		project.descriptions = [
			createDescription({
				name: 'Person',
				statements: [
					createStatement({
						propertyId: 'foaf:name',
						datatype: 'xsd:string',
					}),
				],
			}),
		];
		const pkg = buildDataPackageObject(project);
		const field = pkg.resources[0].schema.fields[0];
		expect(field.type).toBe('string');
	});

	it('maps integer datatype to integer type', () => {
		const project = makeProject();
		project.descriptions = [
			createDescription({
				name: 'Person',
				statements: [
					createStatement({
						propertyId: 'foaf:age',
						datatype: 'xsd:integer',
					}),
				],
			}),
		];
		const pkg = buildDataPackageObject(project);
		const field = pkg.resources[0].schema.fields[0];
		expect(field.type).toBe('integer');
	});

	it('maps date datatype to date type', () => {
		const project = makeProject();
		project.descriptions = [
			createDescription({
				name: 'Person',
				statements: [
					createStatement({
						propertyId: 'schema:birthDate',
						datatype: 'xsd:date',
					}),
				],
			}),
		];
		const pkg = buildDataPackageObject(project);
		const field = pkg.resources[0].schema.fields[0];
		expect(field.type).toBe('date');
	});

	it('maps boolean datatype to boolean type', () => {
		const project = makeProject();
		project.descriptions = [
			createDescription({
				name: 'Item',
				statements: [
					createStatement({
						propertyId: 'ex:active',
						datatype: 'xsd:boolean',
					}),
				],
			}),
		];
		const pkg = buildDataPackageObject(project);
		expect(pkg.resources[0].schema.fields[0].type).toBe('boolean');
	});

	it('maps IRI valueType to string+uri format', () => {
		const project = makeProject();
		project.descriptions = [
			createDescription({
				name: 'Person',
				statements: [
					createStatement({
						propertyId: 'foaf:homepage',
						valueType: 'iri',
					}),
				],
			}),
		];
		const pkg = buildDataPackageObject(project);
		const field = pkg.resources[0].schema.fields[0];
		expect(field.type).toBe('string');
		expect(field.format).toBe('uri');
	});

	it('defaults to string type when no datatype or valueType', () => {
		const project = makeProject();
		project.descriptions = [
			createDescription({
				name: 'Thing',
				statements: [
					createStatement({ propertyId: 'ex:unknown' }),
				],
			}),
		];
		const pkg = buildDataPackageObject(project);
		expect(pkg.resources[0].schema.fields[0].type).toBe('string');
	});

	it('sets field title from statement label', () => {
		const project = makeProject();
		project.descriptions = [
			createDescription({
				name: 'Person',
				statements: [
					createStatement({
						propertyId: 'foaf:name',
						label: 'Full Name',
					}),
				],
			}),
		];
		const pkg = buildDataPackageObject(project);
		expect(pkg.resources[0].schema.fields[0].title).toBe('Full Name');
	});

	it('sets field description from statement note', () => {
		const project = makeProject();
		project.descriptions = [
			createDescription({
				name: 'Person',
				statements: [
					createStatement({
						propertyId: 'foaf:name',
						note: 'Person full name',
					}),
				],
			}),
		];
		const pkg = buildDataPackageObject(project);
		expect(pkg.resources[0].schema.fields[0].description).toBe('Person full name');
	});

	it('sets required constraint when min >= 1', () => {
		const project = makeProject();
		project.descriptions = [
			createDescription({
				name: 'Person',
				statements: [
					createStatement({
						propertyId: 'foaf:name',
						min: 1,
					}),
				],
			}),
		];
		const pkg = buildDataPackageObject(project);
		expect(pkg.resources[0].schema.fields[0].constraints?.required).toBe(true);
	});

	it('does not set required when min is 0', () => {
		const project = makeProject();
		project.descriptions = [
			createDescription({
				name: 'Person',
				statements: [
					createStatement({
						propertyId: 'foaf:name',
						min: 0,
					}),
				],
			}),
		];
		const pkg = buildDataPackageObject(project);
		expect(pkg.resources[0].schema.fields[0].constraints).toBeUndefined();
	});

	it('sets enum constraint from values', () => {
		const project = makeProject();
		project.descriptions = [
			createDescription({
				name: 'Item',
				statements: [
					createStatement({
						propertyId: 'ex:status',
						values: ['active', 'inactive'],
					}),
				],
			}),
		];
		const pkg = buildDataPackageObject(project);
		expect(pkg.resources[0].schema.fields[0].constraints?.enum).toEqual([
			'active',
			'inactive',
		]);
	});

	it('sets pattern constraint', () => {
		const project = makeProject();
		project.descriptions = [
			createDescription({
				name: 'Person',
				statements: [
					createStatement({
						propertyId: 'foaf:mbox',
						pattern: '^mailto:',
					}),
				],
			}),
		];
		const pkg = buildDataPackageObject(project);
		expect(pkg.resources[0].schema.fields[0].constraints?.pattern).toBe('^mailto:');
	});

	it('sets numeric facet constraints', () => {
		const project = makeProject();
		project.descriptions = [
			createDescription({
				name: 'Item',
				statements: [
					createStatement({
						propertyId: 'ex:score',
						datatype: 'xsd:integer',
						facets: { MinInclusive: 0, MaxInclusive: 100 },
					}),
				],
			}),
		];
		const pkg = buildDataPackageObject(project);
		const constraints = pkg.resources[0].schema.fields[0].constraints;
		expect(constraints?.minimum).toBe(0);
		expect(constraints?.maximum).toBe(100);
	});

	it('sets length facet constraints', () => {
		const project = makeProject();
		project.descriptions = [
			createDescription({
				name: 'Item',
				statements: [
					createStatement({
						propertyId: 'ex:code',
						facets: { MinLength: 3, MaxLength: 10 },
					}),
				],
			}),
		];
		const pkg = buildDataPackageObject(project);
		const constraints = pkg.resources[0].schema.fields[0].constraints;
		expect(constraints?.minLength).toBe(3);
		expect(constraints?.maxLength).toBe(10);
	});

	it('uses propertyId as field name', () => {
		const project = makeProject();
		project.descriptions = [
			createDescription({
				name: 'Person',
				statements: [
					createStatement({ propertyId: 'foaf:name' }),
				],
			}),
		];
		const pkg = buildDataPackageObject(project);
		expect(pkg.resources[0].schema.fields[0].name).toBe('foaf:name');
	});

	it('falls back to statement id when propertyId is empty', () => {
		const project = makeProject();
		project.descriptions = [
			createDescription({
				name: 'Thing',
				statements: [
					createStatement({ id: 'myField', propertyId: '' }),
				],
			}),
		];
		const pkg = buildDataPackageObject(project);
		expect(pkg.resources[0].schema.fields[0].name).toBe('myField');
	});
});

// ── buildDataPackage (JSON string) ──────────────────────────────

describe('buildDataPackage', () => {
	it('returns valid JSON string', () => {
		const project = makeProject();
		project.descriptions = [
			createDescription({
				name: 'Person',
				statements: [createStatement({ propertyId: 'foaf:name' })],
			}),
		];
		const json = buildDataPackage(project);
		expect(() => JSON.parse(json)).not.toThrow();
	});

	it('generates complete data package for realistic project', () => {
		const project = makeProject({
			base: 'http://example.org/',
		});
		project.descriptions = [
			createDescription({
				name: 'Person',
				label: 'Person',
				note: 'A person',
				statements: [
					createStatement({
						propertyId: 'foaf:name',
						label: 'Name',
						min: 1,
						max: 1,
						datatype: 'xsd:string',
					}),
					createStatement({
						propertyId: 'foaf:age',
						label: 'Age',
						datatype: 'xsd:integer',
						facets: { MinInclusive: 0 },
					}),
				],
			}),
		];

		const json = buildDataPackage(project);
		const pkg = JSON.parse(json);

		expect(pkg.id).toBe('http://example.org/');
		expect(pkg.resources).toHaveLength(1);
		expect(pkg.resources[0].name).toBe('Person');
		expect(pkg.resources[0].title).toBe('Person');
		expect(pkg.resources[0].schema.fields).toHaveLength(2);
		expect(pkg.resources[0].schema.fields[0].type).toBe('string');
		expect(pkg.resources[0].schema.fields[0].constraints.required).toBe(true);
		expect(pkg.resources[0].schema.fields[1].type).toBe('integer');
		expect(pkg.resources[0].schema.fields[1].constraints.minimum).toBe(0);
	});
});
