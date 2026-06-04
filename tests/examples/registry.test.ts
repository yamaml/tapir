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

	it('every example has a unique id and non-empty raw content', () => {
		const ids = EXAMPLES.map((e) => e.id);
		expect(new Set(ids).size).toBe(ids.length);
		for (const e of EXAMPLES) {
			expect(e.raw.trim().length).toBeGreaterThan(0);
			expect(e.title.length).toBeGreaterThan(0);
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
		expect(getExample('tbbt')).toBe(EXAMPLES.find((e) => e.id === 'tbbt'));
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

// ── Each example parses through its converter ───────────────────

describe('example content is parseable', () => {
	it('the SimpleDSP example parses without errors', () => {
		const ex = EXAMPLES.find((e) => e.flavor === 'simpledsp');
		expect(ex).toBeDefined();
		if (!ex) return;
		const { data, errors } = parseSimpleDsp(ex.raw, ex.title);
		expect(errors).toHaveLength(0);
		expect(data.descriptions.length).toBeGreaterThan(0);
	});

	it('the DCTAP example parses without errors', () => {
		const ex = EXAMPLES.find((e) => e.flavor === 'dctap');
		expect(ex).toBeDefined();
		if (!ex) return;
		const rows = parseCsvRows(ex.raw, ',');
		const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
		expect(isDctapFormat(headers)).toBe(true);
		const { data, errors } = dctapRowsToTapir(rows as DctapRow[], ex.title);
		expect(errors).toHaveLength(0);
		expect(data.descriptions.length).toBeGreaterThan(0);
	});
});

// ── Examples demonstrate inter-shape relationships ──────────────
// An example with no edges is a poor showcase. Both examples must
// encode at least one shape-to-shape reference (SimpleDSP via
// `structured` + `#block` → shapeRefs; DCTAP via the valueShape
// column → shapeRefs) and render at least one diagram edge.

describe('examples have relationships that draw diagram edges', () => {
	it('the SimpleDSP example encodes shape references and renders edges', () => {
		const ex = EXAMPLES.find((e) => e.flavor === 'simpledsp');
		expect(ex).toBeDefined();
		if (!ex) return;
		const { data } = parseSimpleDsp(ex.raw, ex.title);

		// Some statement somewhere must reference another (or its own) block.
		const allRefs = data.descriptions.flatMap((d) =>
			d.statements.flatMap((s) => s.shapeRefs ?? [])
		);
		expect(allRefs.length).toBeGreaterThan(0);

		// Every ref must resolve to a real description name (no dangling targets).
		const names = new Set(data.descriptions.map((d) => d.name));
		for (const ref of allRefs) expect(names.has(ref)).toBe(true);

		// The diagram must actually draw edges (DOT uses `->` for edges).
		const dot = buildDiagram(data);
		expect(dot).toContain('->');
	});

	it('the DCTAP example encodes shape references and renders edges', () => {
		const ex = EXAMPLES.find((e) => e.flavor === 'dctap');
		expect(ex).toBeDefined();
		if (!ex) return;
		const rows = parseCsvRows(ex.raw, ',');
		const { data } = dctapRowsToTapir(rows as DctapRow[], ex.title);

		const allRefs = data.descriptions.flatMap((d) =>
			d.statements.flatMap((s) => s.shapeRefs ?? [])
		);
		expect(allRefs.length).toBeGreaterThan(0);

		const dot = buildDiagram(data);
		expect(dot).toContain('->');
	});
});
