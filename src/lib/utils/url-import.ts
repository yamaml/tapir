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
