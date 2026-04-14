/**
 * @fileoverview IRI expansion and compression utilities.
 *
 * Provides functions to convert between prefixed (CURIE) and full IRI
 * forms using a namespace map.
 *
 * @module utils/iri-utils
 */

import type { NamespaceMap } from '$lib/types';

// ── Expansion ───────────────────────────────────────────────────

/**
 * Expands a prefixed term (e.g. `foaf:name`) to a full IRI.
 *
 * Resolution order:
 *   1. Falsy input returns `null`.
 *   2. Already a full IRI (`http:`, `https:`, `urn:`) — returned as-is.
 *   3. Contains a colon — split on first `:` and look up the prefix.
 *   4. Fallback — prepend `base` if provided, otherwise return the term.
 *
 * @param term - The prefixed term or full IRI.
 * @param namespaces - Prefix-to-IRI namespace map.
 * @param base - Optional fallback base IRI for unprefixed terms.
 * @returns The expanded IRI, or `null` if `term` is falsy.
 *
 * @example
 * const ns = { foaf: 'http://xmlns.com/foaf/0.1/' };
 * expandPrefixed('foaf:name', ns);
 * // => 'http://xmlns.com/foaf/0.1/name'
 *
 * @example
 * expandPrefixed('localTerm', {}, 'http://example.org/');
 * // => 'http://example.org/localTerm'
 */
export function expandPrefixed(
	term: string | null | undefined,
	namespaces: NamespaceMap,
	base?: string
): string | null {
	if (!term) return null;
	if (/^(https?|urn):/.test(term)) return term;

	const colon = term.indexOf(':');
	if (colon >= 0) {
		const prefix = term.substring(0, colon);
		const local = term.substring(colon + 1);
		if (namespaces[prefix]) return namespaces[prefix] + local;
	}

	return base ? base + term : term;
}

// ── Compression ─────────────────────────────────────────────────

/**
 * Compresses a full IRI to prefixed form (CURIE) if a matching
 * namespace is found.
 *
 * Iterates over the namespace map and returns the first match where
 * the IRI starts with the namespace URI. If no match is found, the
 * original IRI is returned unchanged.
 *
 * @param iri - The full IRI to compress.
 * @param namespaces - Prefix-to-IRI namespace map.
 * @returns The compressed prefixed form, or the original IRI.
 *
 * @example
 * const ns = { foaf: 'http://xmlns.com/foaf/0.1/' };
 * compressPrefixed('http://xmlns.com/foaf/0.1/Person', ns);
 * // => 'foaf:Person'
 */
export function compressPrefixed(
	iri: string,
	namespaces: NamespaceMap
): string {
	for (const [prefix, ns] of Object.entries(namespaces)) {
		if (iri.startsWith(ns)) {
			return `${prefix}:${iri.substring(ns.length)}`;
		}
	}
	return iri;
}
