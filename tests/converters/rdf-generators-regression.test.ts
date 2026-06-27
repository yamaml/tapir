import { describe, it, expect } from 'vitest';
import { buildShacl } from '$lib/converters/shacl-generator';
import { buildOwlDsp } from '$lib/converters/owldsp-generator';
import { buildShExC } from '$lib/converters/shex-generator';
import { createProject, createDescription, createStatement } from '$lib/types/profile';
import type { TapirProject } from '$lib/types';
import type { GeneratorWarning } from '$lib/types/export';
import N3 from 'n3';

// ── Helpers ─────────────────────────────────────────────────────

function makeProject(overrides?: Partial<TapirProject>): TapirProject {
	return createProject({ name: 'Test', flavor: 'dctap', ...overrides });
}

function parseTurtle(ttl: string): N3.Quad[] {
	return new N3.Parser().parse(ttl);
}

/** IRIs whose value still looks like an unexpanded CURIE (`dct:title`). */
function garbageIris(quads: N3.Quad[]): string[] {
	const bad: string[] = [];
	for (const q of quads) {
		for (const term of [q.subject, q.predicate, q.object]) {
			if (term.termType !== 'NamedNode') continue;
			const v = term.value;
			// Unexpanded CURIE: scheme-like prefix that is not a real
			// URI scheme, or a full URI with an embedded `prefix:` tail.
			if (/^[A-Za-z][\w.-]*:(?!\/)/.test(v) && !/^(https?|urn|mailto|tag|file):/.test(v)) {
				bad.push(v);
			}
			if (/https?:\/\/.*[#/][A-Za-z][\w-]*:[^/]/.test(v)) {
				bad.push(v);
			}
		}
	}
	return bad;
}

// ── S1: standard prefix fallback ────────────────────────────────

describe('standard prefix fallback in RDF generators (S1)', () => {
	const project = makeProject(); // NO namespaces declared, like a DCTAP import
	project.base = 'http://example.org/ap#';
	project.descriptions = [
		createDescription({
			name: 'Person',
			targetClass: 'foaf:Person',
			statements: [
				createStatement({
					propertyId: 'dcterms:title',
					valueType: ['literal'],
					datatype: ['xsd:string'],
					min: 1,
					max: 1,
				}),
			],
		}),
	];

	it('SHACL expands undeclared standard prefixes instead of emitting garbage IRIs', async () => {
		const ttl = await buildShacl(project);
		const quads = parseTurtle(ttl);
		expect(garbageIris(quads)).toEqual([]);
		const iris = quads.flatMap((q) => [q.subject, q.predicate, q.object])
			.filter((t) => t.termType === 'NamedNode' || t.termType === 'Literal')
			.map((t) => (t.termType === 'Literal' ? t.datatype?.value ?? '' : t.value));
		expect(iris).toContain('http://www.w3.org/2001/XMLSchema#string');
		expect(iris).not.toContain('http://example.org/ap#xsd:string');
	});

	it('OWL-DSP expands all 10 standard prefixes (not just dsp/rdfs/owl/xsd)', async () => {
		const ttl = await buildOwlDsp(project);
		const quads = parseTurtle(ttl);
		expect(garbageIris(quads)).toEqual([]);
		const iris = quads.flatMap((q) => [q.subject, q.predicate, q.object])
			.filter((t) => t.termType === 'NamedNode')
			.map((t) => t.value);
		expect(iris).toContain('http://purl.org/dc/terms/title');
		expect(iris).toContain('http://xmlns.com/foaf/0.1/Person');
	});

	it('ShEx declares every used prefix', () => {
		const shex = buildShExC(project);
		expect(shex).toContain('PREFIX foaf: <http://xmlns.com/foaf/0.1/>');
		expect(shex).toContain('PREFIX dcterms: <http://purl.org/dc/terms/>');
		expect(shex).toContain('PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>');
	});

	it('user-declared prefixes override the standard table', async () => {
		const p = makeProject({
			namespaces: { foaf: 'http://example.org/custom-foaf/' },
		});
		p.descriptions = [
			createDescription({ name: 'S', targetClass: 'foaf:Person', statements: [] }),
		];
		const ttl = await buildShacl(p);
		const iris = parseTurtle(ttl).map((q) => q.object.value);
		expect(iris).toContain('http://example.org/custom-foaf/Person');
	});
});

// ── S4: IRI value sets ──────────────────────────────────────────

describe('IRI value sets (S4 / DECISION 5)', () => {
	it('SHACL emits sh:in members as IRI terms for iri-typed statements', async () => {
		const project = makeProject();
		project.descriptions = [
			createDescription({
				name: 'S',
				statements: [
					createStatement({
						propertyId: 'dcterms:type',
						valueType: ['iri'],
						values: ['foaf:Person', 'http://example.org/Agent'],
					}),
				],
			}),
		];
		const ttl = await buildShacl(project);
		const quads = parseTurtle(ttl);

		// Find the sh:in list members.
		const first = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#first';
		const members = quads.filter((q) => q.predicate.value === first).map((q) => q.object);
		const iriMembers = members.filter((m) => m.termType === 'NamedNode').map((m) => m.value);
		expect(iriMembers).toContain('http://xmlns.com/foaf/0.1/Person');
		expect(iriMembers).toContain('http://example.org/Agent');
		expect(members.every((m) => m.termType === 'NamedNode')).toBe(true);
	});

	it('SHACL keeps literal value sets as literals', async () => {
		const project = makeProject();
		project.descriptions = [
			createDescription({
				name: 'S',
				statements: [
					createStatement({
						propertyId: 'ex:status',
						valueType: ['literal'],
						values: ['active', 'inactive'],
					}),
				],
			}),
		];
		const ttl = await buildShacl(project, 'turtle');
		expect(ttl).toContain('"active"');
		expect(ttl).toContain('"inactive"');
	});
});

// ── SHACL constraint coverage ───────────────────────────────────

describe('SHACL constraint mapping coverage', () => {
	it('maps classConstraint to sh:class', async () => {
		const project = makeProject();
		project.descriptions = [
			createDescription({
				name: 'S',
				statements: [
					createStatement({
						propertyId: 'dcterms:creator',
						classConstraint: ['foaf:Agent'],
					}),
				],
			}),
		];
		const ttl = await buildShacl(project);
		const quads = parseTurtle(ttl);
		const classQuads = quads.filter(
			(q) => q.predicate.value === 'http://www.w3.org/ns/shacl#class'
		);
		expect(classQuads).toHaveLength(1);
		expect(classQuads[0].object.value).toBe('http://xmlns.com/foaf/0.1/Agent');
	});

	it('maps MinLength/MaxLength/MinExclusive/MaxExclusive facets', async () => {
		const project = makeProject();
		project.descriptions = [
			createDescription({
				name: 'S',
				statements: [
					createStatement({
						propertyId: 'ex:code',
						facets: { MinLength: 2, MaxLength: 8, MinExclusive: 0, MaxExclusive: 100 },
					}),
				],
			}),
		];
		const ttl = await buildShacl(project);
		expect(ttl).toContain('sh:minLength');
		expect(ttl).toContain('sh:maxLength');
		expect(ttl).toContain('sh:minExclusive');
		expect(ttl).toContain('sh:maxExclusive');
	});

	it('maps languageTag constraints to sh:languageIn, not sh:in', async () => {
		const project = makeProject();
		project.descriptions = [
			createDescription({
				name: 'S',
				statements: [
					createStatement({
						propertyId: 'dcterms:language',
						values: ['en', 'fr'],
						constraintType: 'languageTag',
					}),
				],
			}),
		];
		const ttl = await buildShacl(project);
		expect(ttl).toContain('sh:languageIn');
		expect(ttl).not.toMatch(/sh:in\b/);
	});

	it('maps inScheme stems to anchored sh:pattern constraints', async () => {
		const project = makeProject({
			namespaces: { ndlsh: 'http://id.ndl.go.jp/auth/ndlsh/' },
		});
		project.descriptions = [
			createDescription({
				name: 'S',
				statements: [
					createStatement({
						propertyId: 'dcterms:subject',
						valueType: ['iri'],
						inScheme: ['ndlsh:'],
					}),
				],
			}),
		];
		const ttl = await buildShacl(project);
		expect(ttl).toContain('sh:pattern');
		expect(ttl).toContain('^http://id\\\\.ndl\\\\.go\\\\.jp/auth/ndlsh/');
	});

	it('warns when a description name is not IRI-safe', async () => {
		const project = makeProject();
		project.base = 'http://example.org/';
		project.descriptions = [createDescription({ name: 'My Shape', statements: [] })];
		const warnings: GeneratorWarning[] = [];
		await buildShacl(project, 'turtle', warnings);
		expect(warnings.some((w) => w.message.includes('My Shape'))).toBe(true);
	});
});

// ── DECISION 22: OWL-DSP statement IRI collisions ───────────────

describe('OWL-DSP statement IRIs (DECISION 22)', () => {
	it('mints distinct IRIs for statements sharing a label', async () => {
		const project = makeProject();
		project.base = 'http://example.org/ap#';
		project.descriptions = [
			createDescription({
				name: 'MAIN',
				statements: [
					createStatement({
						label: 'Creator',
						propertyId: 'dcterms:creator',
						valueType: ['iri'],
					}),
					createStatement({
						label: 'Creator',
						propertyId: 'dcterms:creator',
						valueType: ['literal'],
					}),
				],
			}),
		];

		const ttl = await buildOwlDsp(project);
		const quads = parseTurtle(ttl);
		const stmtNodes = quads
			.filter(
				(q) =>
					q.predicate.value === 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type' &&
					q.object.value === 'http://purl.org/metainfo/terms/dsp#StatementTemplate'
			)
			.map((q) => q.subject.value);
		expect(new Set(stmtNodes).size).toBe(2);
		expect(stmtNodes).toContain('http://example.org/ap#MAIN-Creator');
		expect(stmtNodes).toContain('http://example.org/ap#MAIN-Creator-2');
	});

	it('sanitises IRI-hostile characters in minted statement keys', async () => {
		const project = makeProject();
		project.base = 'http://example.org/ap#';
		project.descriptions = [
			createDescription({
				name: 'MAIN',
				statements: [
					createStatement({ label: 'has part: special', propertyId: 'dcterms:hasPart' }),
				],
			}),
		];
		const ttl = await buildOwlDsp(project);
		const quads = parseTurtle(ttl);
		expect(garbageIris(quads)).toEqual([]);
	});
});

// ── ShEx structural validity ────────────────────────────────────

describe('ShEx structural validity', () => {
	it('never emits the unlexable //pattern// form', () => {
		const project = makeProject();
		project.descriptions = [
			createDescription({
				name: 'S',
				statements: [
					createStatement({ propertyId: 'ex:code', pattern: '^[A-Z]+$' }),
				],
			}),
		];
		const shex = buildShExC(project);
		expect(shex).toContain('/^[A-Z]+$/');
		// `//` may legitimately appear in comments and inside <IRI>s; it
		// must never appear in constraint syntax.
		const syntaxLines = shex
			.split('\n')
			.filter((l) => !l.trimStart().startsWith('#'))
			.map((l) => l.replace(/<[^>]*>/g, ''));
		expect(syntaxLines.some((l) => l.includes('//'))).toBe(false);
	});

	it('wraps full-IRI predicates and classes in angle brackets', () => {
		const project = makeProject();
		project.descriptions = [
			createDescription({
				name: 'S',
				targetClass: 'http://example.org/Type',
				statements: [
					createStatement({ propertyId: 'http://example.org/prop', valueType: ['literal'] }),
				],
			}),
		];
		const shex = buildShExC(project);
		expect(shex).toContain('a [<http://example.org/Type>]');
		expect(shex).toContain('<http://example.org/prop> LITERAL');
	});

	it('warns about prefixes that cannot be resolved', () => {
		const project = makeProject();
		project.descriptions = [
			createDescription({
				name: 'S',
				statements: [createStatement({ propertyId: 'mystery:prop' })],
			}),
		];
		const warnings: GeneratorWarning[] = [];
		buildShExC(project, warnings);
		expect(warnings.some((w) => w.message.includes('mystery'))).toBe(true);
	});

	it('treats absent cardinality as unconstrained (*) per YAMAML §4.3', () => {
		const project = makeProject();
		project.descriptions = [
			createDescription({
				name: 'S',
				statements: [createStatement({ propertyId: 'dcterms:title', valueType: ['literal'] })],
			}),
		];
		const shex = buildShExC(project);
		expect(shex).toContain('dcterms:title LITERAL *');
	});
});
