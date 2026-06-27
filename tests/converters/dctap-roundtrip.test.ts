import { describe, it, expect } from 'vitest';
import { buildDctapRows, DCTAP_COLUMNS, type DctapOutputRow } from '$lib/converters/dctap-generator';
import { dctapRowsToTapir, type DctapRow } from '$lib/converters/dctap-parser';
import { parseCsvRows } from '$lib/components/editor/import-handler';
import { createProject, createDescription, createStatement } from '$lib/types/profile';
import type { TapirProject } from '$lib/types';

// ── Helpers ─────────────────────────────────────────────────────

function makeProject(overrides?: Partial<TapirProject>): TapirProject {
	return createProject({ name: 'Test', flavor: 'dctap', ...overrides });
}

/** Serialises DCTAP rows to CSV text the way the exporters do. */
function rowsToCsv(rows: DctapOutputRow[]): string {
	const header = DCTAP_COLUMNS.join(',');
	const body = rows
		.map((row) =>
			DCTAP_COLUMNS.map((col) => {
				const val = row[col] || '';
				if (val.includes(',') || val.includes('"') || val.includes('\n')) {
					return `"${val.replace(/"/g, '""')}"`;
				}
				return val;
			}).join(',')
		)
		.join('\n');
	return `${header}\n${body}\n`;
}

/** Full text-level round trip: project → rows → CSV → rows → project. */
function roundTrip(project: TapirProject): TapirProject {
	const csv = rowsToCsv(buildDctapRows(project));
	const rows = parseCsvRows(csv, ',') as DctapRow[];
	return dctapRowsToTapir(rows).data;
}

// ── Cardinality: all 9 mandatory × repeatable combinations ──────

describe('DCTAP cardinality round-trip (9 combinations)', () => {
	const cases: Array<{ mandatory: string; repeatable: string }> = [];
	for (const mandatory of ['', 'TRUE', 'FALSE']) {
		for (const repeatable of ['', 'TRUE', 'FALSE']) {
			cases.push({ mandatory, repeatable });
		}
	}

	for (const { mandatory, repeatable } of cases) {
		it(`mandatory="${mandatory}" repeatable="${repeatable}" survives import → export`, () => {
			const imported = dctapRowsToTapir([
				{
					shapeID: 'S',
					propertyID: 'dcterms:title',
					mandatory,
					repeatable,
				},
			]);
			expect(imported.errors).toHaveLength(0);

			const reExported = buildDctapRows(imported.data);
			expect(reExported).toHaveLength(1);
			expect(reExported[0].mandatory).toBe(mandatory);
			expect(reExported[0].repeatable).toBe(repeatable);
		});
	}

	it('mandatory TRUE alone does not fabricate repeatable TRUE', () => {
		const imported = dctapRowsToTapir([
			{ shapeID: 'S', propertyID: 'ex:p', mandatory: 'TRUE' },
		]);
		const rows = buildDctapRows(imported.data);
		expect(rows[0].mandatory).toBe('TRUE');
		expect(rows[0].repeatable).toBe('');
	});

	it('repeatable TRUE alone is not lost', () => {
		const imported = dctapRowsToTapir([
			{ shapeID: 'S', propertyID: 'ex:p', repeatable: 'TRUE' },
		]);
		const stmt = imported.data.descriptions[0].statements[0];
		expect(stmt.min).toBeUndefined();
		expect(stmt.max).toBeNull(); // explicitly unbounded

		const rows = buildDctapRows(imported.data);
		expect(rows[0].mandatory).toBe('');
		expect(rows[0].repeatable).toBe('TRUE');
	});
});

// ── S5/D7: shape rows ───────────────────────────────────────────

describe('DCTAP shape header rows (S5/DECISION 7)', () => {
	it('keeps the shape attached when its first statement has no property', () => {
		const project = makeProject();
		project.descriptions = [
			createDescription({
				name: 'First',
				statements: [createStatement({ propertyId: 'ex:a' })],
			}),
			createDescription({
				name: 'Second',
				statements: [
					createStatement({ propertyId: '' }), // skipped on export
					createStatement({ propertyId: 'ex:b' }),
				],
			}),
		];

		const parsed = roundTrip(project);
		expect(parsed.descriptions.map((d) => d.name)).toEqual(['First', 'Second']);
		expect(parsed.descriptions[1].statements.map((s) => s.propertyId)).toEqual(['ex:b']);
	});

	it('emits a dedicated header row so a description note survives', () => {
		const project = makeProject();
		project.descriptions = [
			createDescription({
				name: 'Person',
				label: 'A Person',
				note: 'Shape-level documentation',
				statements: [createStatement({ propertyId: 'foaf:name', note: 'stmt note' })],
			}),
		];

		const rows = buildDctapRows(project);
		expect(rows).toHaveLength(2);
		expect(rows[0].shapeID).toBe('Person');
		expect(rows[0].propertyID).toBe('');
		expect(rows[0].note).toBe('Shape-level documentation');
		expect(rows[1].shapeID).toBe('');
		expect(rows[1].note).toBe('stmt note');

		const parsed = roundTrip(project);
		expect(parsed.descriptions[0].note).toBe('Shape-level documentation');
		expect(parsed.descriptions[0].label).toBe('A Person');
		expect(parsed.descriptions[0].statements[0].note).toBe('stmt note');
	});
});

// ── S8: quoted newlines in CSV ──────────────────────────────────

describe('DCTAP CSV round-trip with quoted newlines (S8)', () => {
	it('re-imports its own export when a note contains a newline', () => {
		const project = makeProject();
		project.descriptions = [
			createDescription({
				name: 'S',
				statements: [
					createStatement({
						propertyId: 'dcterms:description',
						note: 'line one\nline two',
					}),
					createStatement({ propertyId: 'dcterms:title', note: 'after' }),
				],
			}),
		];

		const parsed = roundTrip(project);
		expect(parsed.descriptions).toHaveLength(1);
		const stmts = parsed.descriptions[0].statements;
		expect(stmts).toHaveLength(2);
		expect(stmts[0].note).toBe('line one\nline two');
		expect(stmts[1].propertyId).toBe('dcterms:title');
	});

	it('re-imports values containing quotes and commas', () => {
		const project = makeProject();
		project.descriptions = [
			createDescription({
				name: 'S',
				statements: [
					createStatement({
						propertyId: 'ex:p',
						note: 'He said "hello", twice',
					}),
				],
			}),
		];

		const parsed = roundTrip(project);
		expect(parsed.descriptions[0].statements[0].note).toBe('He said "hello", twice');
	});
});

// ── Parser warnings ─────────────────────────────────────────────

describe('DCTAP parser warnings', () => {
	it('keeps every token of a multi-token valueNodeType without warning', () => {
		const result = dctapRowsToTapir([
			{ shapeID: 'S', propertyID: 'dcterms:creator', valueNodeType: 'IRI BNODE' },
		]);
		expect(result.data.descriptions[0].statements[0].valueType).toEqual(['iri', 'bnode']);
		// No more lossy "keeping the first token" warning — the model holds
		// all node kinds now.
		expect(result.warnings.some((w) => w.message.includes('IRI BNODE'))).toBe(false);
	});

	it('merges later-row shapeLabel into a label-less shape', () => {
		const result = dctapRowsToTapir([
			{ shapeID: 'S', propertyID: 'ex:a' },
			{ shapeID: 'S', shapeLabel: 'Late label', propertyID: 'ex:b' },
		]);
		expect(result.data.descriptions).toHaveLength(1);
		expect(result.data.descriptions[0].label).toBe('Late label');
	});

	it('warns on conflicting later-row shapeLabel', () => {
		const result = dctapRowsToTapir([
			{ shapeID: 'S', shapeLabel: 'First', propertyID: 'ex:a' },
			{ shapeID: 'S', shapeLabel: 'Second', propertyID: 'ex:b' },
		]);
		expect(result.data.descriptions[0].label).toBe('First');
		expect(result.warnings.some((w) => w.message.includes('conflicts'))).toBe(true);
	});
});

// ── Multi-value valueNodeType round-trip ────────────────────────

describe('DCTAP multi-value valueNodeType round-trip', () => {
	// Tapir normalises casing on export: IRI uppercase, literal/bnode
	// lowercase (the long-standing single-value convention). DCTAP is
	// case-insensitive on read, so an authored "IRI BNODE" round-trips
	// to the canonical "IRI bnode".
	const cases: Array<{ input: string; canonical: string }> = [
		{ input: 'IRI BNODE', canonical: 'IRI bnode' },
		{ input: 'IRI bnode', canonical: 'IRI bnode' },
		{ input: 'IRI literal', canonical: 'IRI literal' },
	];
	for (const { input, canonical } of cases) {
		it(`re-emits "${input}" as "${canonical}" through a full round-trip`, () => {
			const imported = dctapRowsToTapir([
				{ shapeID: 'S', propertyID: 'dcterms:creator', valueNodeType: input },
			]);
			expect(imported.errors).toHaveLength(0);
			const rows = buildDctapRows(imported.data);
			expect(rows[0].valueNodeType).toBe(canonical);
		});
	}

	it('preserves the value-type list through a text-level round-trip', () => {
		const project = makeProject();
		project.descriptions = [
			createDescription({
				name: 'S',
				statements: [
					createStatement({ propertyId: 'dcterms:creator', valueType: ['iri', 'bnode'] }),
				],
			}),
		];
		const back = roundTrip(project);
		expect(back.descriptions[0].statements[0].valueType).toEqual(['iri', 'bnode']);
	});
});
