import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	UrlImportError,
	rewriteForgeBlobUrl,
	loadProfileFromUrl,
} from '$lib/utils/url-import';

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

describe('rewriteForgeBlobUrl — Bitbucket', () => {
	it('rewrites a bitbucket.org src URL to raw', () => {
		const result = rewriteForgeBlobUrl(
			'https://bitbucket.org/team/repo/src/main/profile.csv',
		);
		expect(result).toEqual({
			rewritten:
				'https://bitbucket.org/team/repo/raw/main/profile.csv',
			forge: 'bitbucket',
		});
	});

	it('passes a Bitbucket raw URL through unchanged', () => {
		const url =
			'https://bitbucket.org/team/repo/raw/main/profile.csv';
		const result = rewriteForgeBlobUrl(url);
		expect(result).toEqual({ rewritten: url, forge: null });
	});
});

describe('rewriteForgeBlobUrl — unrelated host', () => {
	it('passes a plain HTTPS URL through unchanged', () => {
		const url = 'https://example.org/profiles/x.yaml';
		const result = rewriteForgeBlobUrl(url);
		expect(result).toEqual({ rewritten: url, forge: null });
	});
});

describe('loadProfileFromUrl — validation', () => {
	it('throws invalid-url for a malformed URL', async () => {
		await expect(loadProfileFromUrl('not a url')).rejects.toMatchObject({
			kind: 'invalid-url',
		});
	});

	it('throws unsupported-scheme for a file:// URL', async () => {
		await expect(
			loadProfileFromUrl('file:///etc/passwd'),
		).rejects.toMatchObject({ kind: 'unsupported-scheme' });
	});

	it('throws unsupported-scheme for a ftp:// URL', async () => {
		await expect(
			loadProfileFromUrl('ftp://example.org/x.yaml'),
		).rejects.toMatchObject({ kind: 'unsupported-scheme' });
	});
});

describe('loadProfileFromUrl — filename derivation', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it('uses the last path segment as filename', async () => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
			new Response('key: value\n', {
				status: 200,
				headers: { 'Content-Type': 'text/yaml' },
			}),
		);
		const file = await loadProfileFromUrl(
			'https://example.org/profiles/sample.yaml',
		);
		expect(file.name).toBe('sample.yaml');
	});

	it('falls back to "imported-profile" for a root URL', async () => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
			new Response('key: value\n', { status: 200 }),
		);
		const file = await loadProfileFromUrl('https://example.org/');
		expect(file.name).toBe('imported-profile');
	});

	it('falls back to "imported-profile" for a URL with no path', async () => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
			new Response('key: value\n', { status: 200 }),
		);
		const file = await loadProfileFromUrl('https://example.org');
		expect(file.name).toBe('imported-profile');
	});

	it('keeps a path segment with no extension as-is', async () => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
			new Response('key: value\n', { status: 200 }),
		);
		const file = await loadProfileFromUrl(
			'https://example.org/api/profile',
		);
		expect(file.name).toBe('profile');
	});
});

describe('loadProfileFromUrl — fetch errors', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it('maps a rejected fetch to cors-or-network', async () => {
		vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(
			new TypeError('Failed to fetch'),
		);
		await expect(
			loadProfileFromUrl('https://example.org/x.yaml'),
		).rejects.toMatchObject({ kind: 'cors-or-network' });
	});

	it('maps a 404 response to http-error', async () => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
			new Response('not found', {
				status: 404,
				statusText: 'Not Found',
			}),
		);
		await expect(
			loadProfileFromUrl('https://example.org/x.yaml'),
		).rejects.toMatchObject({ kind: 'http-error' });
	});

	it('maps an empty body to empty-response', async () => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
			new Response('', { status: 200 }),
		);
		await expect(
			loadProfileFromUrl('https://example.org/x.yaml'),
		).rejects.toMatchObject({ kind: 'empty-response' });
	});

	it('returns a File with the response body on success', async () => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
			new Response('hello\n', { status: 200 }),
		);
		const file = await loadProfileFromUrl(
			'https://example.org/x.yaml',
		);
		expect(file).toBeInstanceOf(File);
		const text = await file.text();
		expect(text).toBe('hello\n');
	});
});
