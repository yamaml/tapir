import { describe, it, expect } from 'vitest';
import { EXAMPLES } from '$lib/examples';
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

function parseExample(ex: (typeof EXAMPLES)[number]): TapirProject {
	if (ex.flavor === 'simpledsp') return parseSimpleDsp(ex.raw, ex.title).data;
	const rows = parseCsvRows(ex.raw, ',');
	return dctapRowsToTapir(rows as DctapRow[], ex.title).data;
}

const nonEmpty = (s: string) => typeof s === 'string' && s.trim().length > 0;

describe('every export generator runs on every example', () => {
	for (const ex of EXAMPLES) {
		describe(ex.id, () => {
			const p = parseExample(ex);

			it('SimpleDSP', () => expect(nonEmpty(buildSimpleDsp(p))).toBe(true));
			it('DCTAP rows', () => {
				const rows = buildDctapRows(p);
				expect(Array.isArray(rows) && rows.length > 0).toBe(true);
			});
			it('SHACL (valid Turtle)', async () => {
				const ttl = await buildShacl(p);
				expect(nonEmpty(ttl)).toBe(true);
				expect(ttl).toMatch(/@prefix|PREFIX/);
				expect(ttl).toContain('sh:'); // SHACL vocabulary present
			});
			it('ShEx', () => {
				const shex = buildShExC(p);
				expect(nonEmpty(shex)).toBe(true);
			});
			it('OWL-DSP (valid Turtle)', async () => {
				const ttl = await buildOwlDsp(p);
				expect(nonEmpty(ttl)).toBe(true);
				expect(ttl).toMatch(/@prefix|PREFIX/);
			});
			it('YAMA JSON (parses)', () => {
				const json = buildYamaJson(p);
				expect(() => JSON.parse(json)).not.toThrow();
				const obj = JSON.parse(json);
				expect(obj).toBeTypeOf('object');
			});
			it('Frictionless data package (parses)', () => {
				const dp = buildDataPackage(p);
				expect(() => JSON.parse(dp)).not.toThrow();
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
