import { describe, it, expect } from 'vitest';
import { EXAMPLES, getExample } from '$lib/examples';
import { parseSimpleDsp } from '$lib/converters/simpledsp-parser';
import { parseCsvRows } from '$lib/components/editor/import-handler';
import { dctapRowsToTapir, type DctapRow } from '$lib/converters/dctap-parser';
import { buildSimpleDsp } from '$lib/converters/simpledsp-generator';
import { buildDctapRows } from '$lib/converters/dctap-generator';
import { buildShacl } from '$lib/converters/shacl-generator';
import { buildShExC } from '$lib/converters/shex-generator';
import { buildOwlDsp } from '$lib/converters/owldsp-generator';
import { buildYamaJson } from '$lib/converters/json-generator';
import { buildDataPackage } from '$lib/converters/datapackage-generator';
import { buildDiagram } from '$lib/converters/diagram-generator';
import { generateHtmlReport } from '$lib/converters/report-generator';
import type { TapirProject } from '$lib/types';
import N3 from 'n3';

function parseExample(ex: (typeof EXAMPLES)[number]): TapirProject {
	if (ex.flavor === 'simpledsp') return parseSimpleDsp(ex.raw, ex.title).data;
	const rows = parseCsvRows(ex.raw, ',');
	return dctapRowsToTapir(rows as DctapRow[], ex.title).data;
}

const nonEmpty = (s: string) => typeof s === 'string' && s.trim().length > 0;

// ── Turtle/ShEx validation helpers ──────────────────────────────

/** Parses Turtle strictly; throws on syntax errors. */
function parseTurtle(ttl: string): N3.Quad[] {
	return new N3.Parser().parse(ttl);
}

/**
 * IRIs that are really unexpanded CURIEs (e.g. `<dct:title>` or
 * `<http://…/ap#xsd:string>`) — the S1 garbage class.
 */
function garbageIris(quads: N3.Quad[]): string[] {
	const bad: string[] = [];
	for (const q of quads) {
		for (const term of [q.subject, q.predicate, q.object]) {
			if (term.termType === 'Literal' && term.datatype) {
				const dt = term.datatype.value;
				if (!/^(https?|urn):/.test(dt)) bad.push(dt);
				continue;
			}
			if (term.termType !== 'NamedNode') continue;
			const v = term.value;
			if (/^[A-Za-z][\w.-]*:(?!\/)/.test(v) && !/^(https?|urn|mailto|tag|file):/.test(v)) {
				bad.push(v);
			}
			if (/https?:\/\/.*[#/][A-Za-z][\w-]*:[^/:]/.test(v)) {
				bad.push(v);
			}
		}
	}
	return bad;
}

/** Asserts every prefixed name used in ShExC has a PREFIX declaration. */
function assertShexPrefixesDeclared(shex: string): void {
	const declared = new Set<string>();
	for (const m of shex.matchAll(/^PREFIX\s+([\w-]+):/gm)) {
		declared.add(m[1]);
	}
	// Scan constraint lines (not comments/PREFIX/BASE) for prefixed names.
	const lines = shex
		.split('\n')
		.filter(
			(l) =>
				!l.trimStart().startsWith('#') &&
				!l.startsWith('PREFIX') &&
				!l.startsWith('BASE')
		)
		.map((l) => l.replace(/<[^>]*>/g, '').replace(/"(?:[^"\\]|\\.)*"/g, ''));
	for (const line of lines) {
		for (const m of line.matchAll(/(?:^|[\s([])([A-Za-z][\w-]*):[\w-]/g)) {
			expect(declared, `prefix "${m[1]}" used but not declared`).toContain(m[1]);
		}
	}
}

/** ShExC must never contain `//` in constraint syntax. */
function assertNoDoubleSlash(shex: string): void {
	const syntaxLines = shex
		.split('\n')
		.filter((l) => !l.trimStart().startsWith('#'))
		.map((l) => l.replace(/<[^>]*>/g, ''));
	expect(syntaxLines.some((l) => l.includes('//'))).toBe(false);
}

// ── Generator smoke tests on every example ──────────────────────

describe('every export generator runs on every example', () => {
	for (const ex of EXAMPLES) {
		describe(ex.id, () => {
			const p = parseExample(ex);

			it('SimpleDSP', () => expect(nonEmpty(buildSimpleDsp(p))).toBe(true));
			it('DCTAP rows', () => {
				const rows = buildDctapRows(p);
				expect(Array.isArray(rows) && rows.length > 0).toBe(true);
			});
			it('SHACL parses as Turtle', async () => {
				const ttl = await buildShacl(p);
				expect(nonEmpty(ttl)).toBe(true);
				const quads = parseTurtle(ttl); // throws on invalid Turtle
				expect(quads.length).toBeGreaterThan(0);
			});
			it('ShEx is structurally sound', () => {
				const shex = buildShExC(p);
				expect(nonEmpty(shex)).toBe(true);
				assertNoDoubleSlash(shex);
			});
			it('OWL-DSP parses as Turtle', async () => {
				const ttl = await buildOwlDsp(p);
				expect(nonEmpty(ttl)).toBe(true);
				const quads = parseTurtle(ttl);
				expect(quads.length).toBeGreaterThan(0);
			});
			it('YAMA JSON (parses)', () => {
				const json = buildYamaJson(p);
				expect(() => JSON.parse(json)).not.toThrow();
				const obj = JSON.parse(json);
				expect(obj).toBeTypeOf('object');
			});
			it('Frictionless data package (parses, names conform)', () => {
				const dp = buildDataPackage(p);
				expect(() => JSON.parse(dp)).not.toThrow();
				const pkg = JSON.parse(dp) as { resources: Array<{ name: string }> };
				for (const r of pkg.resources) {
					expect(r.name).toMatch(/^[a-z0-9._-]+$/);
				}
			});
			it('Diagram DOT', () => {
				const dot = buildDiagram(p);
				expect(nonEmpty(dot)).toBe(true);
				expect(dot).toMatch(/digraph/);
			});
			it('HTML report', () => {
				const html = generateHtmlReport(p);
				expect(nonEmpty(html)).toBe(true);
				expect(html.toLowerCase()).toContain('<html');
			});
		});
	}
});

// ── SRAP smoke tests (S1 verification) ──────────────────────────

describe('SRAP SimpleDSP example exports valid RDF/ShEx (S1)', () => {
	// The SimpleDSP SRAP example carries a full [@NS] block, so every
	// CURIE must resolve — any garbage IRI is a generator bug.
	const ex = getExample('srap-simpledsp')!;
	const project = parseSimpleDsp(ex.raw, ex.title).data;

	it('SHACL has no garbage IRIs', async () => {
		const quads = parseTurtle(await buildShacl(project));
		expect(garbageIris(quads)).toEqual([]);
	});

	it('OWL-DSP has no garbage IRIs', async () => {
		const quads = parseTurtle(await buildOwlDsp(project));
		expect(garbageIris(quads)).toEqual([]);
	});

	it('ShEx declares every used prefix and contains no //', () => {
		const shex = buildShExC(project);
		assertShexPrefixesDeclared(shex);
		assertNoDoubleSlash(shex);
	});

	it('OWL-DSP keeps the two Creator statements distinct (DECISION 22)', async () => {
		const quads = parseTurtle(await buildOwlDsp(project));
		const stmtIris = quads
			.filter(
				(q) =>
					q.predicate.value === 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type' &&
					q.object.value === 'http://purl.org/metainfo/terms/dsp#StatementTemplate'
			)
			.map((q) => q.subject.value);
		// Every statement template must have its own IRI (no merges).
		expect(new Set(stmtIris).size).toBe(stmtIris.length);
		const creators = stmtIris.filter((iri) => /Creator/i.test(iri));
		expect(creators.length).toBeGreaterThanOrEqual(2);
	});
});

describe('SRAP DCTAP example exports (S1, declared prefixes pending)', () => {
	// The DCTAP example ships no namespace declarations; standard
	// prefixes (xsd, dcterms…) must still resolve. Profile-specific
	// prefixes (dct, srap, bibo…) resolve once the user declares them —
	// here we declare them as the editor's prefix banner would.
	const ex = getExample('srap-dctap')!;
	const rows = parseCsvRows(ex.raw, ',') as DctapRow[];
	const project = dctapRowsToTapir(rows, ex.title).data;
	project.namespaces = {
		dct: 'http://purl.org/dc/terms/',
		bibo: 'http://purl.org/ontology/bibo/',
		srap: 'http://example.org/srap/',
		edtf: 'http://id.loc.gov/datatypes/EDTFScheme/',
		rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
	};

	it('SHACL parses with no garbage IRIs', async () => {
		const quads = parseTurtle(await buildShacl(project));
		expect(garbageIris(quads)).toEqual([]);
		// xsd: resolves via the standard table without any declaration.
		const dts = quads
			.filter((q) => q.object.termType === 'Literal')
			.map((q) => (q.object as N3.Literal).datatype.value);
		expect(dts.every((d) => !d.includes('xsd:'))).toBe(true);
	});

	it('OWL-DSP parses with no garbage IRIs', async () => {
		const quads = parseTurtle(await buildOwlDsp(project));
		expect(garbageIris(quads)).toEqual([]);
	});

	it('ShEx declares every used prefix', () => {
		const shex = buildShExC(project);
		assertShexPrefixesDeclared(shex);
		assertNoDoubleSlash(shex);
	});

	it('xsd: resolves through the standard table even with zero declarations', async () => {
		const bare = dctapRowsToTapir(rows, ex.title).data; // namespaces: {}
		const ttl = await buildShacl(bare);
		const quads = parseTurtle(ttl);
		const dts = quads
			.filter((q) => q.object.termType === 'Literal' && (q.object as N3.Literal).datatype)
			.map((q) => (q.object as N3.Literal).datatype.value);
		expect(dts.some((d) => d === 'http://www.w3.org/2001/XMLSchema#string')).toBe(true);
		expect(dts.every((d) => !d.startsWith('xsd:'))).toBe(true);
	});
});
