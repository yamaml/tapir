/**
 * @fileoverview Shared prefix-resolution utilities for the generators.
 *
 * Implements the SimpleDSP §7 / YAMAML §2.2 standard-prefix fallback:
 * CURIEs whose prefix is not declared in the project's namespaces
 * resolve against the 10-entry standard table. User declarations
 * always win.
 *
 * @module converters/prefix-utils
 */

import type { TapirProject, NamespaceMap } from '$lib/types';
import type { GeneratorWarning } from '$lib/types/export';
import N3 from 'n3';

// ── Standard Prefixes ───────────────────────────────────────────

/**
 * Standard prefixes (Table 19 from the SimpleDSP spec + `schema:`
 * extension).
 *
 * These are implicitly recognised: generators use them as a fallback
 * when resolving CURIEs, and the SimpleDSP exporter omits them from
 * `[@NS]` unless overridden with a different URI.
 */
export const STANDARD_PREFIXES: NamespaceMap = {
	dc: 'http://purl.org/dc/elements/1.1/',
	dcterms: 'http://purl.org/dc/terms/',
	foaf: 'http://xmlns.com/foaf/0.1/',
	skos: 'http://www.w3.org/2004/02/skos/core#',
	xl: 'http://www.w3.org/2008/05/skos-xl#',
	rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
	rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
	owl: 'http://www.w3.org/2002/07/owl#',
	xsd: 'http://www.w3.org/2001/XMLSchema#',
	schema: 'https://schema.org/',
};

// ── Resolution Map ──────────────────────────────────────────────

/**
 * Builds the CURIE-resolution map for a project: the standard prefix
 * table as a fallback, overridden by the project's own declarations
 * (SimpleDSP §7 resolution rule — the user's `[@NS]` wins).
 *
 * @param project - The project whose namespaces take precedence.
 * @param extra - Vocabulary prefixes the generator itself needs
 *   (e.g. `sh`, `dsp`) — lowest precedence after standard prefixes.
 * @returns The merged prefix-to-URI map.
 *
 * @example
 * const ns = buildResolutionMap(project, { sh: 'http://www.w3.org/ns/shacl#' });
 */
export function buildResolutionMap(
	project: TapirProject,
	extra: NamespaceMap = {}
): NamespaceMap {
	return { ...extra, ...STANDARD_PREFIXES, ...(project.namespaces || {}) };
}

// ── Used-Prefix Collection ──────────────────────────────────────

/**
 * Returns the subset of `candidates` whose namespace URI actually
 * occurs in the given quads, so RDF serializations declare every
 * prefix in use and no spurious ones.
 *
 * @param quads - The quads about to be serialized.
 * @param candidates - Prefix-to-URI map to filter.
 * @returns Prefix map restricted to namespaces present in the data.
 */
export function collectUsedPrefixes(
	quads: N3.Quad[],
	candidates: NamespaceMap
): NamespaceMap {
	const iris = new Set<string>();
	for (const q of quads) {
		for (const term of [q.subject, q.predicate, q.object, q.graph]) {
			if (term.termType === 'NamedNode') iris.add(term.value);
			if (term.termType === 'Literal' && term.datatype) iris.add(term.datatype.value);
		}
	}

	const used: NamespaceMap = {};
	for (const [prefix, uri] of Object.entries(candidates)) {
		for (const iri of iris) {
			if (iri.startsWith(uri) && iri.length > uri.length) {
				used[prefix] = uri;
				break;
			}
		}
	}
	return used;
}

// ── IRI-Name Sanity Check ───────────────────────────────────────

/** Characters that may not appear in an IRI (RFC 3987 exclusions). */
const ILLEGAL_IRI_CHARS = /[\s<>"{}|\\^`]/;

/**
 * Warns when a description name contains characters that are illegal
 * in IRIs. Generators mint shape IRIs by string concatenation
 * (`base + name`, matching yama-cli); a name with spaces or angle
 * brackets produces a syntactically invalid IRI in the output.
 *
 * @param name - The description name about to be concatenated.
 * @param warnings - Optional warning accumulator.
 * @returns True when the name is IRI-safe.
 */
export function warnIfIllegalIriName(
	name: string,
	warnings?: GeneratorWarning[]
): boolean {
	if (!ILLEGAL_IRI_CHARS.test(name)) return true;
	warnings?.push({
		message: `Description name "${name}" contains characters that are illegal in IRIs; the generated shape IRI will not be valid. Rename the description (e.g. use CamelCase) before publishing.`,
	});
	return false;
}
