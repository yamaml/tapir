import { describe, it, expect } from 'vitest';
import { buildOwlDsp } from '$lib/converters/owldsp-generator';
import { createProject, createDescription, createStatement } from '$lib/types/profile';
import type { TapirProject } from '$lib/types';

function makeProject(overrides?: Partial<TapirProject>): TapirProject {
	return createProject({
		name: 'Test',
		flavor: 'simpledsp',
		...overrides,
	});
}

describe('buildOwlDsp', () => {
	it('emits dsp:DescriptionTemplate for each description', async () => {
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
						propertyId: 'foaf:name',
						min: 1,
						max: 1,
						valueType: 'literal',
						datatype: 'xsd:string',
					}),
				],
			}),
		];
		const turtle = await buildOwlDsp(project);
		expect(turtle).toContain('dsp:DescriptionTemplate');
		expect(turtle).toContain('dsp:StatementTemplate');
		expect(turtle).toContain('foaf:Person');
	});

	it('emits owl:onClass with a direct IRI for single-shape reference', async () => {
		const project = makeProject({ base: 'http://example.org/' });
		project.descriptions = [
			createDescription({
				name: 'Work',
				statements: [
					createStatement({
						propertyId: 'dcterms:creator',
						valueType: 'iri',
						shapeRefs: ['Person'],
					}),
				],
			}),
			createDescription({ name: 'Person' }),
		];
		const turtle = await buildOwlDsp(project);
		expect(turtle).toContain('owl:onClass');
		expect(turtle).not.toContain('owl:unionOf');
	});

	it('wraps multi-shape references in owl:unionOf', async () => {
		const project = makeProject({ base: 'http://example.org/' });
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
		const turtle = await buildOwlDsp(project);
		expect(turtle).toContain('owl:unionOf');
		expect(turtle).toContain('Person');
		expect(turtle).toContain('Organization');
	});
});
