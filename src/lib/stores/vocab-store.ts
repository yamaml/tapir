/**
 * @fileoverview Reactive store for vocabulary search.
 *
 * Wraps the vocab loader and search index in Svelte stores,
 * providing reactive access to vocabulary search from components.
 *
 * @module stores/vocab-store
 */

import { writable, get } from 'svelte/store';
import type { VocabChunk, VocabSearchResult } from '$lib/types';
import { loadCoreBundle, loadVocabChunk, isCoreLoaded } from '$lib/vocab/vocab-loader';
import { SearchIndex, type SearchOptions } from '$lib/vocab/search-index';

// ── Internal State ──────────────────────────────────────────────

const searchIndex = new SearchIndex();

/** Whether the core vocabs are currently loading. */
export const vocabLoading = writable(false);

/** Whether the core vocabs have been loaded. */
export const vocabReady = writable(false);

/** Set of loaded vocabulary prefixes. */
export const loadedPrefixes = writable<Set<string>>(new Set());

/** Error from the last load attempt, if any. */
export const vocabError = writable<string | null>(null);

// ── Public API ──────────────────────────────────────────────────

/**
 * Loads the core vocabulary bundle and indexes all terms.
 *
 * Safe to call multiple times; only loads on the first call.
 *
 * @param base - The SvelteKit `base` path (e.g. `/tapir`).
 */
export async function loadCoreVocabs(base: string): Promise<void> {
	if (isCoreLoaded()) {
		vocabReady.set(true);
		return;
	}

	vocabLoading.set(true);
	vocabError.set(null);

	try {
		const chunks = await loadCoreBundle(base);
		const prefixes = new Set<string>();
		for (const chunk of chunks) {
			searchIndex.addVocab(chunk);
			prefixes.add(chunk.prefix);
		}
		loadedPrefixes.set(prefixes);
		vocabReady.set(true);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		vocabError.set(message);
	} finally {
		vocabLoading.set(false);
	}
}

/**
 * Loads and indexes a single vocabulary chunk by prefix.
 *
 * If the vocabulary is already loaded, this is a no-op.
 *
 * @param prefix - The vocabulary prefix (e.g. `"schema"`).
 * @param base - The SvelteKit `base` path.
 */
export async function loadVocab(prefix: string, base: string): Promise<void> {
	const current = get(loadedPrefixes);
	if (current.has(prefix)) return;

	vocabError.set(null);

	try {
		const chunk = await loadVocabChunk(prefix, base);
		searchIndex.addVocab(chunk);
		loadedPrefixes.update((s) => {
			const next = new Set(s);
			next.add(chunk.prefix);
			return next;
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		vocabError.set(message);
	}
}

/**
 * Searches the loaded vocabularies for terms matching the query.
 *
 * @param query - The search string.
 * @param options - Optional filters (`type`, `limit`).
 * @returns Array of search results sorted by relevance.
 */
export function searchVocab(query: string, options?: SearchOptions): VocabSearchResult[] {
	return searchIndex.search(query, options);
}

/**
 * Returns the total number of indexed terms.
 */
export function getIndexSize(): number {
	return searchIndex.size;
}
