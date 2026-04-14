/**
 * @fileoverview Vocabulary search index.
 *
 * Provides fast prefix-match and contains-match search across
 * loaded vocabulary chunks. Results are ranked by relevance:
 * exact match > prefix match > contains match.
 *
 * @module vocab/search-index
 */

import type { VocabChunk, VocabTerm, VocabSearchResult } from '$lib/types';

// ── Types ───────────────────────────────────────────────────────

/** Options for filtering search results. */
export interface SearchOptions {
	/** Filter by term type: `'C'` for classes, `'P'` for properties. */
	type?: 'C' | 'P';
	/** Maximum number of results to return (default: 50). */
	limit?: number;
}

/** Internal scored result for ranking. */
interface ScoredResult {
	result: VocabSearchResult;
	score: number;
}

// ── Scoring Constants ───────────────────────────────────────────

/** Score for exact match on local name. */
const SCORE_EXACT_NAME = 100;

/** Score for exact match on label. */
const SCORE_EXACT_LABEL = 90;

/** Score for prefix match on local name. */
const SCORE_PREFIX_NAME = 70;

/** Score for prefix match on label. */
const SCORE_PREFIX_LABEL = 60;

/** Score for contains match on local name. */
const SCORE_CONTAINS_NAME = 40;

/** Score for contains match on label. */
const SCORE_CONTAINS_LABEL = 30;

// ── Search Index ────────────────────────────────────────────────

/**
 * A search index over vocabulary terms.
 *
 * Terms are indexed from `VocabChunk` objects. Search supports
 * prefix matching on local names and labels, with results sorted
 * by relevance.
 *
 * @example
 * const index = new SearchIndex();
 * index.addVocab(foafChunk);
 * const results = index.search('Pers');
 * // => [{ prefix: 'foaf', localName: 'Person', ... }]
 */
export class SearchIndex {
	/** Indexed entries: [prefix, localName, lowercaseLocalName, lowercaseLabel, term] */
	private entries: Array<[string, string, string, string, VocabTerm]> = [];

	/**
	 * Adds all terms from a vocabulary chunk to the index.
	 *
	 * @param chunk - The vocabulary chunk to index.
	 */
	addVocab(chunk: VocabChunk): void {
		for (const [localName, term] of Object.entries(chunk.terms)) {
			this.entries.push([
				chunk.prefix,
				localName,
				localName.toLowerCase(),
				(term.l || '').toLowerCase(),
				term,
			]);
		}
	}

	/**
	 * Searches the index for terms matching the query.
	 *
	 * Matching strategy (in order of score):
	 *   1. Exact match on local name (case-insensitive)
	 *   2. Exact match on label (case-insensitive)
	 *   3. Prefix match on local name
	 *   4. Prefix match on label
	 *   5. Contains match on local name
	 *   6. Contains match on label
	 *
	 * @param query - The search query string.
	 * @param options - Optional filters and limits.
	 * @returns Sorted array of search results.
	 */
	search(query: string, options?: SearchOptions): VocabSearchResult[] {
		if (!query || query.length === 0) return [];

		const limit = options?.limit ?? 50;
		const typeFilter = options?.type;

		// Handle prefixed queries like "foaf:Per"
		let prefixFilter: string | undefined;
		let searchTerm: string;

		const colonIdx = query.indexOf(':');
		if (colonIdx > 0) {
			prefixFilter = query.slice(0, colonIdx).toLowerCase();
			searchTerm = query.slice(colonIdx + 1).toLowerCase();
		} else {
			searchTerm = query.toLowerCase();
		}

		// If the search term after the colon is empty, match all terms in that prefix
		const matchAll = prefixFilter !== undefined && searchTerm.length === 0;

		const scored: ScoredResult[] = [];

		for (const [prefix, localName, lowerName, lowerLabel, term] of this.entries) {
			// Apply type filter
			if (typeFilter && term.t !== typeFilter) continue;

			// Apply prefix filter (from "prefix:query" syntax)
			if (prefixFilter && prefix.toLowerCase() !== prefixFilter) continue;

			let score = 0;

			if (matchAll) {
				score = 50; // All terms in the prefix get equal base score
			} else {
				// Exact matches
				if (lowerName === searchTerm) {
					score = SCORE_EXACT_NAME;
				} else if (lowerLabel === searchTerm) {
					score = SCORE_EXACT_LABEL;
				}
				// Prefix matches
				else if (lowerName.startsWith(searchTerm)) {
					score = SCORE_PREFIX_NAME;
				} else if (lowerLabel.startsWith(searchTerm)) {
					score = SCORE_PREFIX_LABEL;
				}
				// Contains matches
				else if (lowerName.includes(searchTerm)) {
					score = SCORE_CONTAINS_NAME;
				} else if (lowerLabel.includes(searchTerm)) {
					score = SCORE_CONTAINS_LABEL;
				}
			}

			if (score > 0) {
				// Slight boost for shorter names (more specific terms)
				score += Math.max(0, 10 - localName.length) * 0.1;

				scored.push({
					result: {
						prefix,
						localName,
						prefixed: `${prefix}:${localName}`,
						term,
					},
					score,
				});
			}
		}

		// Sort by score descending, then alphabetically by prefixed name
		scored.sort((a, b) => {
			if (b.score !== a.score) return b.score - a.score;
			return a.result.prefixed.localeCompare(b.result.prefixed);
		});

		return scored.slice(0, limit).map((s) => s.result);
	}

	/**
	 * Returns the total number of indexed terms.
	 */
	get size(): number {
		return this.entries.length;
	}

	/**
	 * Clears the index.
	 */
	clear(): void {
		this.entries = [];
	}
}
