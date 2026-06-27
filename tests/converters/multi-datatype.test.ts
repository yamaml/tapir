/**
 * Multi-valued `valueDataType` cross-format coverage.
 *
 * Pins the round-trip and per-format serialisation contracts for
 * `Statement.datatype: string[]`. The convention is space-separated
 * tokens on disk, with format-specific renderings for RDF targets
 * (sh:or, OR-disjunction, owl:unionOf). Spec citations live in
 * `src/lib/types/profile.ts` and the per-format generator docstrings.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { createProject, createDescription, createStatement } from '$lib/types/profile';
import { parseCsvRows } from '$lib/components/editor/import-handler';
import { dctapRowsToTapir, type DctapRow } from '$lib/converters/dctap-parser';
import { buildDctapRows } from '$lib/converters/dctap-generator';
import { parseSimpleDsp } from '$lib/converters/simpledsp-parser';
import { buildSimpleDsp } from '$lib/converters/simpledsp-generator';
import { parseYamaYaml } from '$lib/converters/yaml-parser';
import { buildYamaYaml } from '$lib/converters/yaml-generator';
import { buildYamaJson } from '$lib/converters/json-generator';
import { buildShacl } from '$lib/converters/shacl-generator';
import { buildShExC } from '$lib/converters/shex-generator';
import { buildOwlDsp } from '$lib/converters/owldsp-generator';
import { buildDataPackageObject } from '$lib/converters/datapackage-generator';

const HERE = dirname(fileURLToPath(import.meta.url));

function projectWithMultiDatatype(): ReturnType<typeof createProject> {
	const stmt = createStatement({
		propertyId: 'dct:date',
		valueType: ['literal'],
		datatype: ['xsd:gYear', 'xsd:gYearMonth', 'xsd:date'],
	});
	const desc = createDescription({ name: 'Resource', statements: [stmt] });
	const proj = createProject({ name: 'multi-dt', flavor: 'dctap' });
	proj.descriptions = [desc];
	proj.namespaces = {
		xsd: 'http://www.w3.org/2001/XMLSchema#',
		dct: 'http://purl.org/dc/terms/',
	};
	return proj;
}

// ── DCTAP ───────────────────────────────────────────────────────

describe('DCTAP multi-datatype', () => {
	it('round-trips xsd:gYear xsd:gYearMonth xsd:date through the SRAP fixture', () => {
		const csv = readFileSync(resolve(HERE, '../fixtures/srap-april-model.csv'), 'utf-8');
		const rows = parseCsvRows(csv);
		const result = dctapRowsToTapir(rows as DctapRow[], 'SRAP');

		const find = (prop: string) => {
			for (const d of result.data.descriptions) {
				for (const s of d.statements) if (s.propertyId === prop) return s;
			}
			return undefined;
		};

		expect(find('dct:date')?.datatype).toEqual([
			'xsd:gYear',
			'xsd:gYearMonth',
			'xsd:date',
		]);
		expect(find('dct:issued')?.datatype).toEqual([
			'xsd:gYear',
			'xsd:gYearMonth',
			'xsd:date',
		]);
		expect(find('srap:embargoDateRange')?.datatype).toEqual(['edtf:EDTF']);
	});

	it('emits space-separated valueDataType on export', () => {
		const rows = buildDctapRows(projectWithMultiDatatype());
		const dateRow = rows.find((r) => r.propertyID === 'dct:date');
		expect(dateRow?.valueDataType).toBe('xsd:gYear xsd:gYearMonth xsd:date');
	});
});

// ── SimpleDSP ───────────────────────────────────────────────────

describe('SimpleDSP multi-datatype', () => {
	it('parses the spec example `xsd:decimal xsd:integer`', () => {
		// SimpleDSP §4.6 Table 16, literal-constraint row 3.
		const tsv = [
			'[MAIN]',
			'#Name\tProperty\tMin\tMax\tValueType\tConstraint\tComment',
			'value\tex:amount\t0\t1\tliteral\txsd:decimal xsd:integer\t',
		].join('\n');
		const result = parseSimpleDsp(tsv, 'spec-example');
		const stmt = result.data.descriptions[0].statements[0];
		expect(stmt.datatype).toEqual(['xsd:decimal', 'xsd:integer']);
	});

	it('emits space-separated multi-datatype on export', () => {
		const proj = projectWithMultiDatatype();
		proj.flavor = 'simpledsp';
		const tsv = buildSimpleDsp(proj);
		expect(tsv).toContain('xsd:gYear xsd:gYearMonth xsd:date');
	});
});

// ── YAMA YAML ───────────────────────────────────────────────────

describe('YAMA YAML multi-datatype', () => {
	it('emits a YAML sequence even for a single datatype (always-list)', () => {
		const proj = createProject({ name: 'one', flavor: 'simpledsp' });
		proj.descriptions = [
			createDescription({
				name: 'X',
				statements: [
					createStatement({ propertyId: 'foaf:name', datatype: ['xsd:string'] }),
				],
			}),
		];
		const yaml = buildYamaYaml(proj);
		expect(yaml).toMatch(/datatype:\s*\n\s+- xsd:string/);
	});

	it('parses both scalar (legacy) and array YAML datatype forms', () => {
		const scalar = `descriptions:\n  X:\n    statements:\n      a:\n        property: ex:p\n        type: literal\n        datatype: xsd:string\n`;
		const list = `descriptions:\n  X:\n    statements:\n      a:\n        property: ex:p\n        type: literal\n        datatype:\n          - xsd:gYear\n          - xsd:date\n`;
		expect(parseYamaYaml(scalar).data.descriptions[0].statements[0].datatype).toEqual(['xsd:string']);
		expect(parseYamaYaml(list).data.descriptions[0].statements[0].datatype).toEqual([
			'xsd:gYear',
			'xsd:date',
		]);
	});
});

// ── JSON ────────────────────────────────────────────────────────

describe('JSON multi-datatype', () => {
	it('emits datatype as an array', () => {
		const out = JSON.parse(buildYamaJson(projectWithMultiDatatype()));
		const stmtKey = Object.keys(out.descriptions.Resource.statements)[0];
		expect(out.descriptions.Resource.statements[stmtKey].datatype).toEqual([
			'xsd:gYear',
			'xsd:gYearMonth',
			'xsd:date',
		]);
	});
});

// ── OWL-DSP ─────────────────────────────────────────────────────

describe('OWL-DSP multi-datatype', () => {
	it('emits owl:unionOf for multi-datatype', async () => {
		const ttl = await buildOwlDsp(projectWithMultiDatatype());
		expect(ttl).toContain('owl:unionOf');
		expect(ttl).toContain('owl:onDataRange');
	});

	it('emits a plain owl:onDataRange for single datatype', async () => {
		const proj = projectWithMultiDatatype();
		proj.descriptions[0].statements[0].datatype = ['xsd:date'];
		const ttl = await buildOwlDsp(proj);
		expect(ttl).toContain('owl:onDataRange');
		expect(ttl).not.toContain('owl:unionOf');
	});
});

// ── SHACL ───────────────────────────────────────────────────────

describe('SHACL multi-datatype', () => {
	it('emits sh:or of nested sh:datatype blank nodes', async () => {
		const ttl = await buildShacl(projectWithMultiDatatype());
		expect(ttl).toContain('sh:or');
		expect(ttl).toContain('sh:datatype');
		// All three datatypes appear.
		expect(ttl).toContain('xsd:gYear');
		expect(ttl).toContain('xsd:gYearMonth');
		expect(ttl).toContain('xsd:date');
	});

	it('emits a single sh:datatype (no sh:or) for one datatype', async () => {
		const proj = projectWithMultiDatatype();
		proj.descriptions[0].statements[0].datatype = ['xsd:date'];
		const ttl = await buildShacl(proj);
		expect(ttl).toContain('sh:datatype');
		expect(ttl).not.toContain('sh:or');
	});
});

// ── ShEx ────────────────────────────────────────────────────────

describe('ShEx multi-datatype', () => {
	it('emits parenthesised OR disjunction for multi-datatype', () => {
		const shex = buildShExC(projectWithMultiDatatype());
		expect(shex).toMatch(/\(\s*xsd:gYear\s+OR\s+xsd:gYearMonth\s+OR\s+xsd:date\s*\)/);
	});

	it('emits a bare datatype for single datatype', () => {
		const proj = projectWithMultiDatatype();
		proj.descriptions[0].statements[0].datatype = ['xsd:date'];
		const shex = buildShExC(proj);
		expect(shex).toContain('xsd:date');
		expect(shex).not.toContain(' OR ');
	});
});

// ── Frictionless Data Package ───────────────────────────────────

describe('Frictionless multi-datatype', () => {
	it('emits the first datatype only (one type per field)', () => {
		const pkg = buildDataPackageObject(projectWithMultiDatatype());
		const resource = pkg.resources[0];
		const field = resource.schema.fields.find((f) => f.name === 'dct:date');
		// xsd:gYear → Frictionless `year`
		expect(field?.type).toBe('year');
	});
});
