/**
 * @fileoverview Vocabulary-aware semantic validation (Tier 2).
 *
 * Adds property-range / property-domain coherence checks that read
 * the `r` (range) and `d` (domain) fields the bundled vocabulary
 * chunks already carry. Strictly additive: every check emits
 * **warnings** only and silently skips when any required piece of
 * vocabulary information is unavailable, so:
 *
 * - Profiles using custom vocabularies see no new noise.
 * - Profiles that don't load the relevant vocab chunk see no new noise.
 * - The `validateProject` / `validateStatement` contract is unchanged
 *   for callers that don't pass a `VocabLookup`.
 *
 * Three checks ship in this module:
 *
 * 1. **Domain ↔ targetClass** — if the property's domain is class `C`
 *    and the owning shape's `targetClass` is unrelated to `C` (not
 *    equal, not a subclass), warn.
 * 2. **Range ↔ valueDataType** — if the property's range is a literal
 *    datatype and the statement declares an incompatible
 *    `valueDataType`, warn.
 * 3. **Range-class ↔ valueNodeType** — if the property's range is a
 *    class but the statement declares `valueNodeType: literal` (or the
 *    range is a literal/datatype and the statement declares `IRI`),
 *    warn.
 *
 * Subclass relationships are honoured one level at a time (using the
 * bundled `sc` field). Multi-vocabulary subclass chains and
 * cross-vocab references are intentionally not resolved here: the
 * goal is "high-confidence warnings", not exhaustive reasoning.
 *
 * @module utils/vocab-validation
 */

import type { Statement, Description } from '$lib/types';
import type { ParseMessage } from '$lib/types/export';
import type { VocabChunk, VocabTerm } from '$lib/types';

// ── Public types ────────────────────────────────────────────────

/**
 * Read-only view over the cached vocabulary store. Decouples the
 * validator from `vocab-loader` so the unit tests can inject a
 * lightweight fake without touching the IndexedDB / fetch layer.
 */
export interface VocabLookup {
	getCachedVocab(prefix: string): VocabChunk | undefined;
}

// ── Helpers ─────────────────────────────────────────────────────

const XSD_LITERAL_TYPES = new Set([
	'string', 'integer', 'decimal', 'float', 'double', 'boolean',
	'date', 'dateTime', 'time', 'gYear', 'gYearMonth', 'anyURI',
	'Literal',
]);

interface PrefixedName {
	prefix: string;
	local: string;
}

/** Splits `prefix:local` into parts; returns null if not prefixed. */
function splitPrefixed(term: string): PrefixedName | null {
	if (!term) return null;
	const i = term.indexOf(':');
	if (i <= 0 || i === term.length - 1) return null;
	const prefix = term.slice(0, i);
	const local = term.slice(i + 1);
	if (prefix.includes('/') || prefix.includes('#')) return null;
	return { prefix, local };
}

/** Looks up a term by prefixed name; returns null on any miss. */
function resolveTerm(
	prefixed: string,
	vocabs: VocabLookup,
): { chunk: VocabChunk; localName: string; term: VocabTerm } | null {
	const parts = splitPrefixed(prefixed);
	if (!parts) return null;
	const chunk = vocabs.getCachedVocab(parts.prefix);
	if (!chunk) return null;
	const term = chunk.terms[parts.local];
	if (!term) return null;
	return { chunk, localName: parts.local, term };
}

/**
 * Returns true if `candidate` is `target` or a (recursive) subclass of
 * `target`, walking the bundled `sc` chain. Both inputs are local
 * names within the same vocabulary chunk; cross-vocab subclass chains
 * are ignored to keep the check conservative.
 *
 * A small visited-set guards against pathological cycles in the data.
 */
function isSubClassOrSelf(
	candidateLocal: string,
	targetLocal: string,
	chunk: VocabChunk,
): boolean {
	if (candidateLocal === targetLocal) return true;
	const visited = new Set<string>();
	const queue = [candidateLocal];
	while (queue.length > 0) {
		const cur = queue.shift()!;
		if (visited.has(cur)) continue;
		visited.add(cur);
		const term = chunk.terms[cur];
		if (!term?.sc) continue;
		for (const parent of term.sc) {
			if (parent === targetLocal) return true;
			if (!visited.has(parent)) queue.push(parent);
		}
	}
	return false;
}

/** Range value classifier. `class` covers every non-literal IRI term. */
function classifyRange(rangeLocal: string, chunk: VocabChunk): 'literal' | 'class' | 'unknown' {
	if (XSD_LITERAL_TYPES.has(rangeLocal)) return 'literal';
	const term = chunk.terms[rangeLocal];
	if (!term) return 'unknown';
	if (term.t === 'C') return 'class';
	return 'unknown';
}

// ── Public API ──────────────────────────────────────────────────

/**
 * Runs Tier-2 vocabulary-aware checks on a single statement. Returns
 * an empty array when the property isn't found in the bundled vocabs,
 * when it carries no `r`/`d` annotations, or when the statement
 * itself is too sparse to compare.
 *
 * @param stmt - The statement to check.
 * @param desc - The owning description (for `targetClass`).
 * @param fieldKey - Pre-computed `descName.label` key for messages.
 * @param vocabs - Cached-vocab lookup (typically `vocab-loader`).
 * @returns Warning messages; never errors.
 *
 * @example
 * const ws = validateStatementVocab(
 *   stmt, desc, 'MAIN.age',
 *   { getCachedVocab: (p) => cache.get(p) },
 * );
 */
export function validateStatementVocab(
	stmt: Statement,
	desc: Description,
	fieldKey: string,
	vocabs: VocabLookup,
): ParseMessage[] {
	const warnings: ParseMessage[] = [];
	if (!stmt.propertyId) return warnings;
	const propResolved = resolveTerm(stmt.propertyId, vocabs);
	if (!propResolved) return warnings;
	const { chunk: propChunk, term: propTerm } = propResolved;

	// Check 1: domain ↔ targetClass
	if (propTerm.d && propTerm.d.length > 0 && desc.targetClass) {
		const targetParts = splitPrefixed(desc.targetClass);
		if (targetParts && targetParts.prefix === propChunk.prefix) {
			const targetTerm = propChunk.terms[targetParts.local];
			if (targetTerm) {
				const compatible = propTerm.d.some((domainLocal) =>
					isSubClassOrSelf(targetParts.local, domainLocal, propChunk),
				);
				if (!compatible) {
					warnings.push({
						field: fieldKey,
						message:
							`Property "${stmt.propertyId}" expects domain ` +
							`${propTerm.d.map((d) => `${propChunk.prefix}:${d}`).join(' or ')}, ` +
							`but shape targets "${desc.targetClass}"`,
					});
				}
			}
		}
	}

	// Check 2 & 3: range coherence
	if (propTerm.r && propTerm.r.length > 0) {
		const rangeKinds = propTerm.r.map((r) => classifyRange(r, propChunk));
		const allLiteral = rangeKinds.every((k) => k === 'literal');
		const allClass = rangeKinds.every((k) => k === 'class');

		// Check 3a: range is class but value declared as literal
		if (allClass && stmt.valueType === 'literal') {
			warnings.push({
				field: fieldKey,
				message:
					`Property "${stmt.propertyId}" expects an IRI/object ` +
					`(range ${propTerm.r.map((r) => `${propChunk.prefix}:${r}`).join(' or ')}), ` +
					`but value is declared as literal`,
			});
		}
		// Check 3b: range is literal/datatype but value declared as IRI
		if (allLiteral && stmt.valueType === 'iri') {
			warnings.push({
				field: fieldKey,
				message:
					`Property "${stmt.propertyId}" expects a literal ` +
					`(range ${propTerm.r.map((r) => `${propChunk.prefix}:${r}`).join(' or ')}), ` +
					`but value is declared as IRI`,
			});
		}

		// Check 2: range datatype vs declared datatype. Only fires for
		// xsd ranges with an xsd-prefixed datatype; cross-namespace
		// datatype comparisons fall through silently.
		if (allLiteral && stmt.datatype) {
			const dtParts = splitPrefixed(stmt.datatype);
			const rangeIsXsd = propTerm.r.every(
				(r) => r !== 'Literal' && XSD_LITERAL_TYPES.has(r),
			);
			if (
				dtParts &&
				dtParts.prefix === 'xsd' &&
				rangeIsXsd &&
				!propTerm.r.includes(dtParts.local)
			) {
				warnings.push({
					field: fieldKey,
					message:
						`Property "${stmt.propertyId}" range is ` +
						`${propTerm.r.map((r) => `xsd:${r}`).join(' or ')}, ` +
						`but datatype is "${stmt.datatype}"`,
				});
			}
		}
	}

	return warnings;
}
