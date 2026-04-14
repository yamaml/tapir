import { describe, it, expect } from 'vitest';
import {
	buildDot,
	buildOverviewDot,
	buildDiagram,
	compactIRI,
	esc,
	dotEsc,
	formatCard,
	typeLabel,
	COLOR_PALETTE,
	BW_PALETTE,
} from '$lib/converters/diagram-generator';
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

// ── compactIRI ──────────────────────────────────────────────────

describe('compactIRI', () => {
	const ns = {
		foaf: 'http://xmlns.com/foaf/0.1/',
		schema: 'http://schema.org/',
	};

	it('returns empty string for undefined', () => {
		expect(compactIRI(undefined, ns)).toBe('');
	});

	it('returns already-compact IRI unchanged', () => {
		expect(compactIRI('foaf:Person', ns)).toBe('foaf:Person');
	});

	it('compacts a full IRI', () => {
		expect(compactIRI('http://xmlns.com/foaf/0.1/Person', ns)).toBe('foaf:Person');
	});

	it('returns full IRI unchanged when no matching namespace', () => {
		expect(compactIRI('http://unknown.org/term', ns)).toBe('http://unknown.org/term');
	});
});

// ── esc ─────────────────────────────────────────────────────────

describe('esc', () => {
	it('returns empty for undefined', () => {
		expect(esc(undefined)).toBe('');
	});

	it('escapes ampersand', () => {
		expect(esc('a&b')).toBe('a&amp;b');
	});

	it('escapes angle brackets', () => {
		expect(esc('<div>')).toBe('&lt;div&gt;');
	});

	it('escapes double quotes', () => {
		expect(esc('say "hi"')).toBe('say &quot;hi&quot;');
	});
});

// ── dotEsc ──────────────────────────────────────────────────────

describe('dotEsc', () => {
	it('returns empty for undefined', () => {
		expect(dotEsc(undefined)).toBe('');
	});

	it('escapes backslashes', () => {
		expect(dotEsc('a\\b')).toBe('a\\\\b');
	});

	it('escapes double quotes', () => {
		expect(dotEsc('say "hi"')).toBe('say \\"hi\\"');
	});
});

// ── formatCard ──────────────────────────────────────────────────

describe('formatCard', () => {
	it('returns 0..* for null/null', () => {
		expect(formatCard(null, null)).toBe('0..*');
	});

	it('returns exact value when min equals max', () => {
		expect(formatCard(1, 1)).toBe('1');
	});

	it('returns range', () => {
		expect(formatCard(0, 3)).toBe('0..3');
	});

	it('returns 1..* for 1/null', () => {
		expect(formatCard(1, null)).toBe('1..*');
	});
});

// ── typeLabel ───────────────────────────────────────────────────

describe('typeLabel', () => {
	const ns = { xsd: 'http://www.w3.org/2001/XMLSchema#' };

	it('returns shapeRef when present', () => {
		const stmt = createStatement({ shapeRefs: ['Person'] });
		expect(typeLabel(stmt, ns)).toBe('Person');
	});

	it('returns compacted datatype', () => {
		const stmt = createStatement({ datatype: 'xsd:string' });
		expect(typeLabel(stmt, ns)).toBe('xsd:string');
	});

	it('returns URI for iri valueType', () => {
		const stmt = createStatement({ valueType: 'iri' });
		expect(typeLabel(stmt, ns)).toBe('URI');
	});

	it('returns Literal for literal valueType', () => {
		const stmt = createStatement({ valueType: 'literal' });
		expect(typeLabel(stmt, ns)).toBe('Literal');
	});

	it('returns NBSP for empty type', () => {
		const stmt = createStatement();
		expect(typeLabel(stmt, {})).toBe('\u00A0');
	});
});

// ── Color Palettes ──────────────────────────────────────────────

describe('palettes', () => {
	it('COLOR_PALETTE has multiple header colors', () => {
		expect(COLOR_PALETTE.headers.length).toBeGreaterThan(1);
	});

	it('BW_PALETTE has single header color', () => {
		expect(BW_PALETTE.headers).toHaveLength(1);
	});
});

// ── buildDot ────────────────────────────────────────────────────

describe('buildDot', () => {
	it('generates valid DOT digraph', () => {
		const project = makeProject();
		project.descriptions = [
			createDescription({
				name: 'Person',
				targetClass: 'foaf:Person',
				label: 'Person',
				statements: [
					createStatement({
						id: 'name',
						propertyId: 'foaf:name',
						valueType: 'literal',
						datatype: 'xsd:string',
						min: 1,
						max: 1,
					}),
				],
			}),
		];

		const dot = buildDot(project);
		expect(dot).toContain('digraph YAMA {');
		expect(dot).toContain('}');
		expect(dot).toContain('"Person"');
		expect(dot).toContain('Person');
	});

	it('uses LR rankdir when edges exist', () => {
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
			createDescription({
				name: 'Person',
				statements: [],
			}),
		];

		const dot = buildDot(project);
		expect(dot).toContain('rankdir=LR');
	});

	it('uses TB rankdir when no edges', () => {
		const project = makeProject();
		project.descriptions = [
			createDescription({
				name: 'Thing',
				statements: [
					createStatement({
						id: 'name',
						propertyId: 'ex:name',
						valueType: 'literal',
					}),
				],
			}),
		];

		const dot = buildDot(project);
		expect(dot).toContain('rankdir=TB');
	});

	it('shows "no properties" for empty descriptions', () => {
		const project = makeProject();
		project.descriptions = [
			createDescription({ name: 'Empty', statements: [] }),
		];

		const dot = buildDot(project);
		expect(dot).toContain('no properties');
	});

	it('generates edge for cross-reference', () => {
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
			createDescription({
				name: 'Person',
				statements: [],
			}),
		];

		const dot = buildDot(project);
		expect(dot).toContain('"Book":"author":e -> "Person":"_header":w');
	});

	it('does not generate edge for self-reference', () => {
		const project = makeProject();
		project.descriptions = [
			createDescription({
				name: 'Person',
				statements: [
					createStatement({
						id: 'knows',
						propertyId: 'foaf:knows',
						shapeRefs: ['Person'],
					}),
				],
			}),
		];

		const dot = buildDot(project);
		// Self-ref should show rotation arrow in cell, not generate an edge
		expect(dot).toContain('&#x21BA;');
		expect(dot).not.toContain('"Person":"knows":e -> "Person"');
	});

	it('uses BW palette when mode is bw', () => {
		const project = makeProject();
		project.descriptions = [
			createDescription({
				name: 'Thing',
				statements: [],
			}),
		];

		const dot = buildDot(project, { mode: 'bw' });
		expect(dot).toContain(BW_PALETTE.border);
	});

	it('shows targetClass in header', () => {
		const project = makeProject({
			namespaces: { foaf: 'http://xmlns.com/foaf/0.1/' },
		});
		project.descriptions = [
			createDescription({
				name: 'Person',
				targetClass: 'foaf:Person',
				statements: [],
			}),
		];

		const dot = buildDot(project);
		expect(dot).toContain('foaf:Person');
	});
});

// ── buildOverviewDot ────────────────────────────────────────────

describe('buildOverviewDot', () => {
	it('generates valid DOT digraph', () => {
		const project = makeProject();
		project.descriptions = [
			createDescription({
				name: 'Person',
				label: 'Person',
				statements: [],
			}),
		];

		const dot = buildOverviewDot(project);
		expect(dot).toContain('digraph YAMA {');
		expect(dot).toContain('}');
	});

	it('always uses LR rankdir', () => {
		const project = makeProject();
		project.descriptions = [
			createDescription({ name: 'Thing', statements: [] }),
		];

		const dot = buildOverviewDot(project);
		expect(dot).toContain('rankdir=LR');
	});

	it('shows self-references inline', () => {
		const project = makeProject();
		project.descriptions = [
			createDescription({
				name: 'Person',
				statements: [
					createStatement({
						id: 'knows',
						propertyId: 'foaf:knows',
						shapeRefs: ['Person'],
						min: 0,
						max: null,
					}),
				],
			}),
		];

		const dot = buildOverviewDot(project);
		expect(dot).toContain('&#x21BA;');
		expect(dot).toContain('foaf:knows');
	});

	it('generates edges for cross-references', () => {
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
			createDescription({ name: 'Person', statements: [] }),
		];

		const dot = buildOverviewDot(project);
		expect(dot).toContain('"Book" -> "Person"');
	});

	it('merges multiple edges to the same target', () => {
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
					createStatement({
						id: 'editor',
						propertyId: 'dcterms:editor',
						shapeRefs: ['Person'],
					}),
				],
			}),
			createDescription({ name: 'Person', statements: [] }),
		];

		const dot = buildOverviewDot(project);
		// Should only have one edge from Book to Person (merged)
		const edgeMatches = dot.match(/"Book" -> "Person"/g);
		expect(edgeMatches).toHaveLength(1);
		// But both labels should be present
		expect(dot).toContain('dcterms:creator');
		expect(dot).toContain('dcterms:editor');
	});
});

// ── buildDiagram (convenience) ──────────────────────────────────

describe('buildDiagram', () => {
	const project = makeProject();
	project.descriptions = [
		createDescription({
			name: 'Thing',
			statements: [
				createStatement({
					id: 'name',
					propertyId: 'ex:name',
					valueType: 'literal',
				}),
			],
		}),
	];

	it('returns detail diagram for "color"', () => {
		const dot = buildDiagram(project, 'color');
		expect(dot).toContain('digraph YAMA');
		expect(dot).toContain(COLOR_PALETTE.bodyBg);
	});

	it('returns detail BW diagram for "bw"', () => {
		const dot = buildDiagram(project, 'bw');
		expect(dot).toContain(BW_PALETTE.border);
	});

	it('returns overview diagram for "overview"', () => {
		const dot = buildDiagram(project, 'overview');
		expect(dot).toContain('rankdir=LR');
		// Overview doesn't have HR separator row or CELLBORDER="0" TABLE in same way
		expect(dot).toContain('digraph YAMA');
	});

	it('returns overview BW diagram for "overview-bw"', () => {
		const dot = buildDiagram(project, 'overview-bw');
		expect(dot).toContain(BW_PALETTE.border);
		expect(dot).toContain('rankdir=LR');
	});
});
