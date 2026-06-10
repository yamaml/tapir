import { describe, it, expect } from 'vitest';
import { parseCsv, parseCsvRecords } from '$lib/converters/csv';

// ── parseCsv ────────────────────────────────────────────────────

describe('parseCsv', () => {
	it('parses simple rows', () => {
		expect(parseCsv('a,b,c\n1,2,3')).toEqual([
			['a', 'b', 'c'],
			['1', '2', '3'],
		]);
	});

	it('keeps quoted newlines inside a field (RFC 4180)', () => {
		const rows = parseCsv('a,"line one\nline two",c');
		expect(rows).toEqual([['a', 'line one\nline two', 'c']]);
	});

	it('keeps quoted CRLF newlines inside a field', () => {
		const rows = parseCsv('a,"x\r\ny",c\r\n1,2,3');
		expect(rows).toEqual([
			['a', 'x\r\ny', 'c'],
			['1', '2', '3'],
		]);
	});

	it('decodes doubled quotes', () => {
		expect(parseCsv('"say ""hi""",b')).toEqual([['say "hi"', 'b']]);
	});

	it('keeps delimiters inside quoted fields', () => {
		expect(parseCsv('"a,b",c')).toEqual([['a,b', 'c']]);
	});

	it('handles CRLF row terminators', () => {
		expect(parseCsv('a,b\r\nc,d\r\n')).toEqual([
			['a', 'b'],
			['c', 'd'],
		]);
	});

	it('handles lone-CR row terminators', () => {
		expect(parseCsv('a,b\rc,d')).toEqual([
			['a', 'b'],
			['c', 'd'],
		]);
	});

	it('strips a leading BOM', () => {
		expect(parseCsv('\uFEFF' + 'a,b')).toEqual([['a', 'b']]);
	});

	it('trims unquoted cells but preserves whitespace in quoted cells', () => {
		expect(parseCsv('  x  ," padded ",y')).toEqual([['x', ' padded ', 'y']]);
	});

	it('supports tab delimiter', () => {
		expect(parseCsv('a\tb\t"c\nd"', { delimiter: '\t' })).toEqual([['a', 'b', 'c\nd']]);
	});

	it('returns empty array for empty input', () => {
		expect(parseCsv('')).toEqual([]);
	});

	it('handles a trailing newline without an extra row', () => {
		expect(parseCsv('a,b\n')).toEqual([['a', 'b']]);
	});

	it('handles empty cells', () => {
		expect(parseCsv('a,,c\n,,')).toEqual([
			['a', '', 'c'],
			['', '', ''],
		]);
	});
});

// ── parseCsvRecords ─────────────────────────────────────────────

describe('parseCsvRecords', () => {
	it('keys rows by header names', () => {
		expect(parseCsvRecords('a,b\n1,2')).toEqual([{ a: '1', b: '2' }]);
	});

	it('skips all-empty rows', () => {
		expect(parseCsvRecords('a,b\n,,\n1,2')).toEqual([{ a: '1', b: '2' }]);
	});

	it('keeps quoted newlines inside record values', () => {
		const records = parseCsvRecords('a,b\n"multi\nline",x');
		expect(records).toEqual([{ a: 'multi\nline', b: 'x' }]);
	});

	it('fills missing trailing cells with empty strings', () => {
		expect(parseCsvRecords('a,b,c\n1,2')).toEqual([{ a: '1', b: '2', c: '' }]);
	});

	it('returns empty array when only a header is present', () => {
		expect(parseCsvRecords('a,b\n')).toEqual([]);
	});
});
