import { describe, it, expect } from 'vitest';
import { validateProject, validateStatement } from '$lib/utils/validation';
import { createProject, createDescription, createStatement } from '$lib/types/profile';

describe('validateProject', () => {
	it('returns no errors for a valid project', () => {
		const project = createProject({ name: 'Test', flavor: 'simpledsp' });
		project.descriptions = [
			createDescription({
				name: 'MAIN',
				statements: [
					createStatement({
						propertyId: 'dc:title',
						min: 1,
						max: 1,
						valueType: 'literal',
					}),
				],
			}),
		];
		const result = validateProject(project);
		expect(result.errors).toHaveLength(0);
	});

	it('warns on statements without propertyId', () => {
		const project = createProject({ name: 'Test', flavor: 'simpledsp' });
		project.descriptions = [
			createDescription({
				name: 'MAIN',
				statements: [createStatement({ label: 'Title' })],
			}),
		];
		const result = validateProject(project);
		expect(result.warnings.length).toBeGreaterThan(0);
		expect(result.warnings[0].message).toContain('no property ID');
	});

	it('errors on unknown prefix in propertyId', () => {
		const project = createProject({ name: 'Test', flavor: 'simpledsp' });
		project.descriptions = [
			createDescription({
				name: 'MAIN',
				statements: [createStatement({ propertyId: 'unknown:prop' })],
			}),
		];
		const result = validateProject(project);
		expect(result.errors.length).toBeGreaterThan(0);
		expect(result.errors[0].message).toContain('Unknown prefix "unknown"');
	});

	it('accepts known standard prefixes without declaration', () => {
		const project = createProject({ name: 'Test', flavor: 'simpledsp' });
		project.descriptions = [
			createDescription({
				name: 'MAIN',
				statements: [
					createStatement({ propertyId: 'foaf:name' }),
					createStatement({ propertyId: 'dcterms:title' }),
					createStatement({ propertyId: 'xsd:string', datatype: 'xsd:string' }),
				],
			}),
		];
		const result = validateProject(project);
		expect(result.errors).toHaveLength(0);
	});

	it('accepts declared custom prefixes', () => {
		const project = createProject({
			name: 'Test',
			flavor: 'simpledsp',
			namespaces: { ex: 'http://example.org/' },
		});
		project.descriptions = [
			createDescription({
				name: 'MAIN',
				statements: [createStatement({ propertyId: 'ex:thing' })],
			}),
		];
		const result = validateProject(project);
		expect(result.errors).toHaveLength(0);
	});

	it('errors on invalid cardinality (min > max)', () => {
		const project = createProject({ name: 'Test', flavor: 'simpledsp' });
		project.descriptions = [
			createDescription({
				name: 'MAIN',
				statements: [
					createStatement({ propertyId: 'dc:title', min: 5, max: 1 }),
				],
			}),
		];
		const result = validateProject(project);
		expect(result.errors.length).toBeGreaterThan(0);
		expect(result.errors[0].message).toContain('Invalid cardinality');
	});

	it('errors on broken shape reference', () => {
		const project = createProject({ name: 'Test', flavor: 'simpledsp' });
		project.descriptions = [
			createDescription({
				name: 'MAIN',
				statements: [
					createStatement({ propertyId: 'dc:creator', shapeRefs: ['NonExistent'] }),
				],
			}),
		];
		const result = validateProject(project);
		expect(result.errors.length).toBeGreaterThan(0);
		expect(result.errors[0].message).toContain('does not match any description');
	});

	it('accepts valid shape references', () => {
		const project = createProject({ name: 'Test', flavor: 'simpledsp' });
		project.descriptions = [
			createDescription({
				name: 'MAIN',
				statements: [
					createStatement({ propertyId: 'dc:creator', shapeRefs: ['Author'] }),
				],
			}),
			createDescription({
				name: 'Author',
				statements: [createStatement({ propertyId: 'foaf:name' })],
			}),
		];
		const result = validateProject(project);
		const shapeRefErrors = result.errors.filter((e) =>
			e.message.includes('does not match')
		);
		expect(shapeRefErrors).toHaveLength(0);
	});

	it('errors on any broken reference in a multi-shape list', () => {
		const project = createProject({ name: 'Test', flavor: 'dctap' });
		project.descriptions = [
			createDescription({
				name: 'Work',
				statements: [
					// Two refs: one valid, one broken.
					createStatement({
						propertyId: 'dcterms:creator',
						valueType: 'iri',
						shapeRefs: ['Person', 'Ghost'],
					}),
				],
			}),
			createDescription({ name: 'Person' }),
		];
		const result = validateProject(project);
		const brokenRefs = result.errors.filter((e) => e.message.includes('Ghost'));
		expect(brokenRefs).toHaveLength(1);
		// The valid one doesn't raise.
		expect(result.errors.some((e) => e.message.includes('"Person"'))).toBe(false);
	});

	it('accepts a full multi-shape disjunction when all refs resolve', () => {
		const project = createProject({ name: 'Test', flavor: 'dctap' });
		project.descriptions = [
			createDescription({
				name: 'Work',
				statements: [
					createStatement({
						propertyId: 'dcterms:creator',
						valueType: 'iri',
						shapeRefs: ['Person', 'Organization'],
					}),
				],
			}),
			createDescription({ name: 'Person' }),
			createDescription({ name: 'Organization' }),
		];
		const result = validateProject(project);
		const refErrors = result.errors.filter((e) => e.message.includes('does not match'));
		expect(refErrors).toHaveLength(0);
	});

	it('errors on duplicate description names', () => {
		const project = createProject({ name: 'Test', flavor: 'simpledsp' });
		project.descriptions = [
			createDescription({ name: 'MAIN', statements: [] }),
			createDescription({ name: 'MAIN', statements: [] }),
		];
		const result = validateProject(project);
		expect(result.errors.some((e) => e.message.includes('Duplicate'))).toBe(true);
	});

	it('warns on empty descriptions', () => {
		const project = createProject({ name: 'Test', flavor: 'simpledsp' });
		project.descriptions = [createDescription({ name: 'Empty' })];
		const result = validateProject(project);
		expect(result.warnings.some((w) => w.message.includes('no statements'))).toBe(
			true
		);
	});

	it('errors on unknown prefix in targetClass', () => {
		const project = createProject({ name: 'Test', flavor: 'simpledsp' });
		project.descriptions = [
			createDescription({
				name: 'MAIN',
				targetClass: 'custom:Thing',
				statements: [createStatement({ propertyId: 'dc:title' })],
			}),
		];
		const result = validateProject(project);
		expect(result.errors.some((e) => e.message.includes('Unknown prefix "custom"'))).toBe(true);
	});
});
