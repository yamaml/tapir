import { describe, it, expect } from 'vitest';
import { UrlImportError } from '$lib/utils/url-import';

// ── Tests ───────────────────────────────────────────────────────

describe('UrlImportError', () => {
	it('carries the kind and message', () => {
		const err = new UrlImportError('invalid-url', 'bad URL');
		expect(err).toBeInstanceOf(Error);
		expect(err.kind).toBe('invalid-url');
		expect(err.message).toBe('bad URL');
		expect(err.name).toBe('UrlImportError');
	});
});
