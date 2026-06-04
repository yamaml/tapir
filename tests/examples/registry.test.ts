import { describe, it, expect } from 'vitest';
import { EXAMPLES, getExample, exampleToFile, type ExampleId } from '$lib/examples';
import { parseSimpleDsp } from '$lib/converters/simpledsp-parser';
import { parseCsvRows, isDctapFormat } from '$lib/components/editor/import-handler';
import { dctapRowsToTapir, type DctapRow } from '$lib/converters/dctap-parser';
import { buildDiagram } from '$lib/converters/diagram-generator';

// ── Registry shape ──────────────────────────────────────────────

describe('EXAMPLES registry', () => {
	it('contains at least one SimpleDSP and one DCTAP example', () => {
		expect(EXAMPLES.some((e) => e.flavor === 'simpledsp')).toBe(true);
		expect(EXAMPLES.some((e) => e.flavor === 'dctap')).toBe(true);
	});

	it('offers both Big Bang Theory and SRAP for both flavors', () => {
		for (const flavor of ['simpledsp', 'dctap'] as const) {
			const titles = EXAMPLES.filter((e) => e.flavor === flavor).map((e) => e.title);
			expect(titles).toContain('Big Bang Theory characters');
			expect(titles).toContain('SRAP — Scholarly Resource AP');
		}
	});

	it('every example has a unique id and non-empty text fields', () => {
		const ids = EXAMPLES.map((e) => e.id);
		expect(new Set(ids).size).toBe(ids.length);
		for (const e of EXAMPLES) {
			expect(e.raw.trim().length).toBeGreaterThan(0);
			expect(e.title.length).toBeGreaterThan(0);
			expect(e.shortLabel.length).toBeGreaterThan(0);
			expect(e.description.length).toBeGreaterThan(0);
		}
	});

	it('every example fileName extension matches its flavor', () => {
		for (const e of EXAMPLES) {
			if (e.flavor === 'simpledsp') expect(e.fileName.endsWith('.tsv')).toBe(true);
			if (e.flavor === 'dctap') expect(e.fileName.endsWith('.csv')).toBe(true);
		}
	});
});

// ── getExample ──────────────────────────────────────────────────

describe('getExample', () => {
	it('returns the matching example by id', () => {
		expect(getExample('tbbt-simpledsp')).toBe(
			EXAMPLES.find((e) => e.id === 'tbbt-simpledsp')
		);
	});

	it('returns undefined for an unknown id', () => {
		expect(getExample('does-not-exist' as ExampleId)).toBeUndefined();
	});
});

// ── exampleToFile ───────────────────────────────────────────────

describe('exampleToFile', () => {
	it('builds a File carrying the example fileName and raw content', async () => {
		const ex = EXAMPLES[0];
		const file = exampleToFile(ex);
		expect(file).toBeInstanceOf(File);
		expect(file.name).toBe(ex.fileName);
		expect(await file.text()).toBe(ex.raw);
	});
});

// ── Parse any example into a project ────────────────────────────
// Routes an example through the same converter its flavor uses, so the
// relationship/parse checks below cover every registry entry uniformly.

function parseExample(ex: (typeof EXAMPLES)[number]) {
	if (ex.flavor === 'simpledsp') {
		return parseSimpleDsp(ex.raw, ex.title);
	}
	const rows = parseCsvRows(ex.raw, ',');
	const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
	expect(isDctapFormat(headers)).toBe(true);
	return dctapRowsToTapir(rows as DctapRow[], ex.title);
}

// ── Each example parses through its converter ───────────────────

describe('example content is parseable', () => {
	for (const ex of EXAMPLES) {
		it(`${ex.id} parses without errors`, () => {
			const { data, errors } = parseExample(ex);
			expect(errors).toHaveLength(0);
			expect(data.descriptions.length).toBeGreaterThan(0);
		});
	}
});

// ── Examples demonstrate inter-shape relationships ──────────────
// An example with no edges is a poor showcase. Every example must
// encode at least one shape-to-shape reference (SimpleDSP via
// `structured` + `#block` → shapeRefs; DCTAP via the valueShape
// column → shapeRefs), resolve all refs to real blocks, and render at
// least one diagram edge.

describe('every example encodes relationships that draw diagram edges', () => {
	for (const ex of EXAMPLES) {
		it(`${ex.id} has resolved shape references and renders edges`, () => {
			const { data } = parseExample(ex);

			const allRefs = data.descriptions.flatMap((d) =>
				d.statements.flatMap((s) => s.shapeRefs ?? [])
			);
			expect(allRefs.length).toBeGreaterThan(0);

			// No dangling targets — every ref names a real block.
			const names = new Set(data.descriptions.map((d) => d.name));
			for (const ref of allRefs) expect(names.has(ref)).toBe(true);

			// The diagram must actually draw edges (DOT uses `->`).
			expect(buildDiagram(data)).toContain('->');
		});
	}
});
