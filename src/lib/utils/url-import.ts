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
