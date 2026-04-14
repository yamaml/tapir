import { describe, it, expect } from 'vitest';
import {
	parseCsvRows,
	isDctapFormat,
} from '$lib/components/editor/import-handler';

// ── parseCsvRows ────────────────────────────────────────────────

describe('parseCsvRows', () => {
	it('parses simple CSV', () => {
		const csv = 'name,age\nAlice,30\nBob,25';
		const rows = parseCsvRows(csv, ',');
		expect(rows).toHaveLength(2);
		expect(rows[0]).toEqual({ name: 'Alice', age: '30' });
		expect(rows[1]).toEqual({ name: 'Bob', age: '25' });
	});

	it('handles quoted fields with commas', () => {
		const csv = 'name,note\nAlice,"has a comma, here"\nBob,simple';
		const rows = parseCsvRows(csv, ',');
		expect(rows[0].note).toBe('has a comma, here');
		expect(rows[1].note).toBe('simple');
	});

	it('handles escaped quotes in quoted fields', () => {
		const csv = 'name,note\nAlice,"said ""hello"""\nBob,ok';
		const rows = parseCsvRows(csv, ',');
		expect(rows[0].note).toBe('said "hello"');
	});

	it('handles tab delimiter', () => {
		const tsv = 'name\tage\nAlice\t30';
		const rows = parseCsvRows(tsv, '\t');
		expect(rows).toHaveLength(1);
		expect(rows[0]).toEqual({ name: 'Alice', age: '30' });
	});

	it('skips empty lines', () => {
		const csv = 'name,age\nAlice,30\n\nBob,25\n';
		const rows = parseCsvRows(csv, ',');
		expect(rows).toHaveLength(2);
	});

	it('returns empty array for single-line input', () => {
		const csv = 'name,age';
		const rows = parseCsvRows(csv, ',');
		expect(rows).toHaveLength(0);
	});

	it('returns empty array for empty input', () => {
		const rows = parseCsvRows('', ',');
		expect(rows).toHaveLength(0);
	});

	it('trims header names', () => {
		const csv = ' name , age \nAlice,30';
		const rows = parseCsvRows(csv, ',');
		expect(rows[0]).toHaveProperty('name');
		expect(rows[0]).toHaveProperty('age');
	});
});

// ── isDctapFormat ───────────────────────────────────────────────

describe('isDctapFormat', () => {
	it('detects DCTAP format with standard headers', () => {
		expect(isDctapFormat(['shapeID', 'shapeLabel', 'propertyID', 'propertyLabel'])).toBe(true);
	});

	it('detects DCTAP format case-insensitively', () => {
		expect(isDctapFormat(['ShapeID', 'PropertyID', 'note'])).toBe(true);
	});

	it('rejects non-DCTAP headers', () => {
		expect(isDctapFormat(['Name', 'Property', 'Min', 'Max'])).toBe(false);
	});

	it('rejects empty headers', () => {
		expect(isDctapFormat([])).toBe(false);
	});

	it('requires both shapeID and propertyID', () => {
		expect(isDctapFormat(['shapeID', 'note'])).toBe(false);
		expect(isDctapFormat(['propertyID', 'note'])).toBe(false);
	});
});
