/**
 * @fileoverview URL-based profile import for Tapir.
 *
 * Validates a user-pasted URL, rewrites known forge blob URLs to their
 * raw equivalents (GitHub, GitLab, Bitbucket), fetches the body via
 * `fetch()`, and wraps it as a `File` so the existing `importFile()`
 * pipeline can dispatch by extension as usual.
 *
 * @module utils/url-import
 */

// ── Types ───────────────────────────────────────────────────────

/** Failure modes surfaced to the dialog for user-facing messages. */
export type UrlImportErrorKind =
	| 'invalid-url'
	| 'unsupported-scheme'
	| 'cors-or-network'
	| 'http-error'
	| 'empty-response';

/** Error thrown by `loadProfileFromUrl`. */
export class UrlImportError extends Error {
	constructor(
		public readonly kind: UrlImportErrorKind,
		message: string,
	) {
		super(message);
		this.name = 'UrlImportError';
	}
}

/** Forge whose blob URL was rewritten, or `null` if no rewrite happened. */
export type Forge = 'github' | 'gitlab' | 'bitbucket' | null;

// ── Forge Rewriting ─────────────────────────────────────────────

/**
 * Rewrites known forge blob URLs to their raw equivalents so the
 * subsequent `fetch()` returns the file body rather than the forge's
 * HTML page wrapper. Best-effort: unrecognised hosts and malformed
 * URLs pass through unchanged (the caller's `fetch()` will deal with
 * them). Pure function — no I/O, safe for unit tests.
 *
 * @param input - The user-pasted URL string.
 * @returns The (possibly rewritten) URL plus the recognised forge.
 *
 * @example
 * rewriteForgeBlobUrl('https://github.com/foo/bar/blob/main/x.yaml')
 * // → { rewritten: 'https://raw.githubusercontent.com/foo/bar/main/x.yaml',
 * //     forge: 'github' }
 */
export function rewriteForgeBlobUrl(input: string): {
	rewritten: string;
	forge: Forge;
} {
	let url: URL;
	try {
		url = new URL(input);
	} catch {
		return { rewritten: input, forge: null };
	}

	// GitHub: github.com/{owner}/{repo}/blob/{ref}/{path…}
	//      → raw.githubusercontent.com/{owner}/{repo}/{ref}/{path…}
	if (url.hostname === 'github.com') {
		const m = url.pathname.match(/^\/([^/]+)\/([^/]+)\/blob\/(.+)$/);
		if (m) {
			const [, owner, repo, refAndPath] = m;
			return {
				rewritten: `https://raw.githubusercontent.com/${owner}/${repo}/${refAndPath}`,
				forge: 'github',
			};
		}
	}

	// Bitbucket: bitbucket.org/{owner}/{repo}/src/{ref}/{path…}
	//         →  bitbucket.org/{owner}/{repo}/raw/{ref}/{path…}
	if (url.hostname === 'bitbucket.org') {
		const m = url.pathname.match(/^\/([^/]+)\/([^/]+)\/src\/(.+)$/);
		if (m) {
			const [, owner, repo, refAndPath] = m;
			return {
				rewritten: `https://bitbucket.org/${owner}/${repo}/raw/${refAndPath}`,
				forge: 'bitbucket',
			};
		}
	}

	// GitLab (gitlab.com or self-hosted): {host}/…/-/blob/{ref}/{path…}
	//                                  →  {host}/…/-/raw/{ref}/{path…}
	// Self-hosted GitLab uses arbitrary hostnames, so we match on the
	// `/-/blob/` segment rather than a specific host. We replace only
	// the first occurrence to avoid breaking pathological paths that
	// contain `-/blob/` literally inside a filename.
	if (url.pathname.includes('/-/blob/')) {
		const rewrittenPath = url.pathname.replace('/-/blob/', '/-/raw/');
		return {
			rewritten: `${url.protocol}//${url.host}${rewrittenPath}${url.search}${url.hash}`,
			forge: 'gitlab',
		};
	}

	return { rewritten: input, forge: null };
}

// ── Loading ─────────────────────────────────────────────────────

/**
 * Fetches a profile URL and returns it as a `File` ready for the
 * existing `importFile()` pipeline. Validates the input URL, rewrites
 * known forge blob URLs, and surfaces failures as `UrlImportError`
 * with a discriminated `kind` so the caller can render specific
 * messages.
 *
 * Uses `mode: 'cors'` and no custom headers — non-simple headers
 * trigger CORS preflight, which most arbitrary hosts don't allow.
 *
 * @param input - The user-pasted URL string.
 * @returns A `File` whose name is derived from the URL path.
 * @throws {UrlImportError}
 *
 * @example
 * const file = await loadProfileFromUrl(
 *   'https://github.com/foo/bar/blob/main/x.yaml',
 * );
 * // file.name === 'x.yaml'
 */
export async function loadProfileFromUrl(input: string): Promise<File> {
	let url: URL;
	try {
		url = new URL(input);
	} catch {
		throw new UrlImportError('invalid-url', `Invalid URL: ${input}`);
	}

	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new UrlImportError(
			'unsupported-scheme',
			`Only http and https URLs are supported (got ${url.protocol}).`,
		);
	}

	const { rewritten } = rewriteForgeBlobUrl(input);

	let response: Response;
	try {
		response = await fetch(rewritten, {
			mode: 'cors',
			redirect: 'follow',
			cache: 'default',
			referrerPolicy: 'no-referrer',
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		throw new UrlImportError(
			'cors-or-network',
			`Network or CORS failure: ${message}`,
		);
	}

	if (!response.ok) {
		throw new UrlImportError(
			'http-error',
			`${response.status} ${response.statusText}`,
		);
	}

	// Read as ArrayBuffer rather than wrapping a Blob inside the File.
	// `new File([blob], …)` is valid in real browsers but jsdom (used by
	// our tests) serialises the inner Blob as `[object Blob]` when text
	// is read back, so unit tests can't verify content. ArrayBuffer
	// works in both environments and the resulting File reads correctly
	// via FileReader (used by the existing import pipeline) and via
	// `text()` / `arrayBuffer()`.
	const buffer = await response.arrayBuffer();
	if (buffer.byteLength === 0) {
		throw new UrlImportError(
			'empty-response',
			'The URL returned an empty response.',
		);
	}

	const filename = deriveFilename(url);
	const contentType = response.headers.get('Content-Type') ?? '';
	return new File([buffer], filename, { type: contentType });
}

/**
 * Derives a filename from a URL by taking the last non-empty path
 * segment. Returns `imported-profile` if no segment is available.
 */
function deriveFilename(url: URL): string {
	const segments = url.pathname.split('/').filter((s) => s.length > 0);
	const last = segments[segments.length - 1];
	return last && last.length > 0 ? last : 'imported-profile';
}
