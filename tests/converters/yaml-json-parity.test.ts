import { describe, it, expect } from 'vitest';
import { buildYamaYaml, buildYamaDocumentObject } from '$lib/converters/yaml-generator';
import { buildYamaJson } from '$lib/converters/json-generator';
import { parseYamaYaml } from '$lib/converters/yaml-parser';
import { createProject, createDescription, createStatement } from '$lib/types/profile';
import type { TapirProject } from '$lib/types';

// ── Helpers ─────────────────────────────────────────────────────

function richProject(): TapirProject {
	const project = createProject({ name: 'Rich', flavor: 'simpledsp' });
	project.base = 'http://example.org/ap#';
	project.namespaces = { ex: 'http://example.org/vocab/' };
	project.descriptions = [
		createDescription({
			name: 'Work',
			targetClass: 'ex:Work',
			label: 'A Work',
			note: 'Documented',
			closed: true,
			idPrefix: 'works',
			statements: [
				createStatement({
					id: 'lang',
					propertyId: 'dcterms:language',
					values: ['en', 'fr'],
					constraintType: 'languageTag',
				}),
				createStatement({
					id: 'desc',
					propertyId: 'dcterms:description',
					min: 0,
					cardinalityNote: '推奨',
				}),
				createStatement({
					id: 'creator',
					propertyId: 'dcterms:creator',
					classConstraint: ['foaf:Agent'],
					inScheme: ['ex:'],
				}),
			],
		}),
	];
	return project;
}

// ── D13: cardinalityNote + languageTag through YAML ─────────────

describe('YAML round-trip of cardinalityNote and languageTag (D13)', () => {
	it('serialises cardinalityNote and reads it back', () => {
		const yaml = buildYamaYaml(richProject());
		expect(yaml).toContain('cardinalityNote: 推奨');

		const parsed = parseYamaYaml(yaml);
		const stmt = parsed.data.descriptions[0].statements.find((s) => s.id === 'desc');
		expect(stmt?.cardinalityNote).toBe('推奨');
	});

	it('serialises languageTag (not values) and reads it back', () => {
		const yaml = buildYamaYaml(richProject());
		expect(yaml).toContain('languageTag');

		const parsed = parseYamaYaml(yaml);
		const stmt = parsed.data.descriptions[0].statements.find((s) => s.id === 'lang');
		expect(stmt?.values).toEqual(['en', 'fr']);
		expect(stmt?.constraintType).toBe('languageTag');
	});

	it('emits a scalar languageTag for a single tag', () => {
		const project = createProject({ name: 'T', flavor: 'dctap' });
		project.descriptions = [
			createDescription({
				name: 'S',
				statements: [
					createStatement({
						id: 'lang',
						propertyId: 'dcterms:language',
						values: ['en'],
						constraintType: 'languageTag',
					}),
				],
			}),
		];
		const yaml = buildYamaYaml(project);
		expect(yaml).toContain('languageTag: en');
		const parsed = parseYamaYaml(yaml);
		expect(parsed.data.descriptions[0].statements[0].values).toEqual(['en']);
	});
});

// ── Loss warnings for deferred YAMAML features ──────────────────

describe('YAML parser loss warnings', () => {
	it('warns when defaults/data/mapping blocks are dropped', () => {
		const yaml = `
defaults:
  source: data.csv
data:
  - id: 1
descriptions:
  work:
    mapping:
      path: works.csv
    statements:
      title:
        property: dcterms:title
        mapping:
          path: title
`;
		const result = parseYamaYaml(yaml);
		const messages = result.warnings.map((w) => w.message).join('\n');
		expect(messages).toContain("'defaults:'");
		expect(messages).toContain("'data:'");
		expect(messages).toContain("'mapping:'");
	});
});

// ── JSON parity with YAML (D9) ──────────────────────────────────

describe('JSON export parity with YAML', () => {
	it('produces the identical document object as the YAML export', () => {
		const project = richProject();
		const fromJson = JSON.parse(buildYamaJson(project));
		expect(fromJson).toEqual(JSON.parse(JSON.stringify(buildYamaDocumentObject(project))));
	});

	it('includes a, inScheme, closed, cardinalityNote, and languageTag', () => {
		const json = JSON.parse(buildYamaJson(richProject()));
		const work = json.descriptions.Work;
		expect(work.a).toBe('ex:Work');
		expect(work.closed).toBe(true);
		expect(work.statements.creator.a).toBe('foaf:Agent');
		expect(work.statements.creator.inScheme).toBe('ex:');
		expect(work.statements.desc.cardinalityNote).toBe('推奨');
		expect(work.statements.lang.languageTag).toEqual(['en', 'fr']);
	});

	it('omits unset min/max fields entirely', () => {
		const json = JSON.parse(buildYamaJson(richProject()));
		const lang = json.descriptions.Work.statements.lang;
		expect('min' in lang).toBe(false);
		expect('max' in lang).toBe(false);
	});
});
