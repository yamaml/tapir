import { describe, it, expect } from 'vitest';
import { getMimeType, MIME_TYPES } from '$lib/utils/file-io';

// ── Tests ───────────────────────────────────────────────────────

describe('file-io', () => {
	describe('MIME_TYPES', () => {
		it('maps common extensions', () => {
			expect(MIME_TYPES['.tsv']).toBe('text/tab-separated-values');
			expect(MIME_TYPES['.csv']).toBe('text/csv');
			expect(MIME_TYPES['.yaml']).toBe('text/yaml');
			expect(MIME_TYPES['.json']).toBe('application/json');
			expect(MIME_TYPES['.ttl']).toBe('text/turtle');
			expect(MIME_TYPES['.shex']).toBe('text/shex');
			expect(MIME_TYPES['.svg']).toBe('image/svg+xml');
			expect(MIME_TYPES['.dot']).toBe('text/vnd.graphviz');
			expect(MIME_TYPES['.png']).toBe('image/png');
		});
	});

	describe('getMimeType', () => {
		it('returns correct MIME type for known extensions', () => {
			expect(getMimeType('export.tsv')).toBe('text/tab-separated-values');
			expect(getMimeType('profile.yaml')).toBe('text/yaml');
			expect(getMimeType('diagram.svg')).toBe('image/svg+xml');
			expect(getMimeType('schema.json')).toBe('application/json');
		});

		it('returns octet-stream for unknown extensions', () => {
			expect(getMimeType('data.xyz')).toBe('application/octet-stream');
			expect(getMimeType('file.unknown')).toBe('application/octet-stream');
		});

		it('handles filenames with multiple dots', () => {
			expect(getMimeType('my.profile.yaml')).toBe('text/yaml');
			expect(getMimeType('export.dctap.csv')).toBe('text/csv');
		});
	});
});
