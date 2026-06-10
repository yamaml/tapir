import { describe, it, expect } from 'vitest';
import { buildDctapLines } from '$lib/utils/dctap-lines';
import { buildDctapRows, dctapShapeNeedsHeaderRow } from '$lib/converters/dctap-generator';
import { createProject, createDescription, createStatement } from '$lib/types';

// ── Fixtures ────────────────────────────────────────────────────

function project(descs: Parameters<typeof createDescription>[0][]) {
	return createProject({
		name: 'T',
		flavor: 'dctap',
		descriptions: descs.map((d) => createDescription(d)),
	});
}

// ── Tests ───────────────────────────────────────────────────────

describe('buildDctapLines', () => {
	it('keeps a first statement with empty propertyID editable (stmtIndex 0)', () => {
		const p = project([
			{
				name: 'Book',
				statements: [
					createStatement({ propertyId: '' }), // freshly added placeholder
					createStatement({ propertyId: 'dcterms:title' }),
				],
			},
		]);
		const lines = buildDctapLines(p);
		expect(lines).toHaveLength(2);
		expect(lines[0]).toMatchObject({ kind: 'data', descIndex: 0, stmtIndex: 0, carriesShape: true });
		expect(lines[1]).toMatchObject({ kind: 'data', descIndex: 0, stmtIndex: 1, carriesShape: false });
		// The second row must map to the dcterms:title statement, not shift.
		expect(lines[1].cells[2]).toBe('dcterms:title'); // propertyID column
	});

	it('emits a dedicated header row when the shape has a note', () => {
		const p = project([
			{
				name: 'Book',
				note: 'A bibliographic record',
				statements: [createStatement({ propertyId: 'dcterms:title' })],
			},
		]);
		const lines = buildDctapLines(p);
		expect(lines).toHaveLength(2);
		expect(lines[0]).toMatchObject({ kind: 'header', descIndex: 0, carriesShape: true });
		expect(lines[0].stmtIndex).toBeUndefined();
		expect(lines[0].cells[0]).toBe('Book'); // shapeID
		expect(lines[0].cells[11]).toBe('A bibliographic record'); // note
		// Statement row follows without shapeID and with correct index.
		expect(lines[1]).toMatchObject({ kind: 'data', descIndex: 0, stmtIndex: 0, carriesShape: false });
		expect(lines[1].cells[2]).toBe('dcterms:title');
	});

	it('emits a header row for an empty shape', () => {
		const p = project([{ name: 'Empty' }]);
		const lines = buildDctapLines(p);
		expect(lines).toHaveLength(1);
		expect(lines[0]).toMatchObject({ kind: 'header', descIndex: 0, carriesShape: true });
	});

	it('keeps statement indices aligned across multiple shapes', () => {
		const p = project([
			{
				name: 'A',
				note: 'noted', // forces a header row
				statements: [
					createStatement({ propertyId: 'ex:p1' }),
					createStatement({ propertyId: '' }),
				],
			},
			{
				name: 'B',
				statements: [createStatement({ propertyId: 'ex:p2' })],
			},
		]);
		const lines = buildDctapLines(p);
		expect(lines.map((l) => [l.kind, l.descIndex, l.stmtIndex])).toEqual([
			['header', 0, undefined],
			['data', 0, 0],
			['data', 0, 1],
			['data', 1, 0],
		]);
		// Shape B's row carries its shapeID and the right property.
		expect(lines[3].carriesShape).toBe(true);
		expect(lines[3].cells[0]).toBe('B');
		expect(lines[3].cells[2]).toBe('ex:p2');
	});
});

// ── Header-row predicate parity ─────────────────────────────────
//
// `buildDctapRows` and `buildDctapLines` must agree on when a shape
// gets a dedicated header row — a drift of one shifts every later
// raw-table line off its statement. Both now call
// `dctapShapeNeedsHeaderRow`; these tests pin the agreement for the
// three structurally distinct shapes.

describe('dctapShapeNeedsHeaderRow parity', () => {
	const cases: Array<{
		title: string;
		desc: Parameters<typeof createDescription>[0];
	}> = [
		{
			title: 'shape with a note',
			desc: {
				name: 'Noted',
				note: 'has a note',
				statements: [createStatement({ propertyId: 'ex:p' })],
			},
		},
		{
			title: 'empty shape (no statements)',
			desc: { name: 'Empty' },
		},
		{
			title: 'normal shape (statements, no note)',
			desc: {
				name: 'Normal',
				statements: [createStatement({ propertyId: 'dcterms:title' })],
			},
		},
	];

	for (const { title, desc } of cases) {
		it(`generator rows and raw-table lines agree for a ${title}`, () => {
			const p = project([desc]);
			const expected = dctapShapeNeedsHeaderRow(p.descriptions[0], true);

			// Generator path: a header row is a shape-carrying row with
			// no propertyID, emitted before any statement rows.
			const rows = buildDctapRows(p, { includeEmptyStatements: true });
			const generatorHasHeader = rows[0].shapeID !== '' && rows[0].propertyID === '';

			// Raw-table path: the first line is tagged 'header'.
			const lines = buildDctapLines(p);
			const linesHaveHeader = lines[0].kind === 'header';

			expect(generatorHasHeader).toBe(expected);
			expect(linesHaveHeader).toBe(expected);
		});
	}
});
