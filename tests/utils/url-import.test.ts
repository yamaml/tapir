import { describe, it, expect } from 'vitest';
import { UrlImportError, rewriteForgeBlobUrl } from '$lib/utils/url-import';

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

describe('rewriteForgeBlobUrl — GitHub', () => {
	it('rewrites a github.com blob URL to raw.githubusercontent.com', () => {
		const result = rewriteForgeBlobUrl(
			'https://github.com/foo/bar/blob/main/profiles/x.yaml',
		);
		expect(result).toEqual({
			rewritten:
				'https://raw.githubusercontent.com/foo/bar/main/profiles/x.yaml',
			forge: 'github',
		});
	});

	it('passes a raw.githubusercontent.com URL through unchanged', () => {
		const url =
			'https://raw.githubusercontent.com/foo/bar/main/profiles/x.yaml';
		const result = rewriteForgeBlobUrl(url);
		expect(result).toEqual({ rewritten: url, forge: null });
	});

	it('passes a malformed URL through unchanged without throwing', () => {
		const result = rewriteForgeBlobUrl('not a url');
		expect(result).toEqual({ rewritten: 'not a url', forge: null });
	});
});

describe('rewriteForgeBlobUrl — GitLab', () => {
	it('rewrites a gitlab.com blob URL', () => {
		const result = rewriteForgeBlobUrl(
			'https://gitlab.com/group/project/-/blob/main/profile.yaml',
		);
		expect(result).toEqual({
			rewritten:
				'https://gitlab.com/group/project/-/raw/main/profile.yaml',
			forge: 'gitlab',
		});
	});

	it('rewrites a self-hosted GitLab blob URL', () => {
		const result = rewriteForgeBlobUrl(
			'https://git.example.org/team/repo/-/blob/v1.0/x.csv',
		);
		expect(result).toEqual({
			rewritten:
				'https://git.example.org/team/repo/-/raw/v1.0/x.csv',
			forge: 'gitlab',
		});
	});

	it('passes a GitLab raw URL through unchanged', () => {
		const url =
			'https://gitlab.com/group/project/-/raw/main/profile.yaml';
		const result = rewriteForgeBlobUrl(url);
		expect(result).toEqual({ rewritten: url, forge: null });
	});
});
