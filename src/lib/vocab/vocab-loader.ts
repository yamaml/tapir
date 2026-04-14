/**
 * @fileoverview Vocabulary chunk loader.
 *
 * Loads vocabulary chunks from the static `/vocabs/` directory.
 * The core bundle (`_core.json`) is loaded on startup; individual
 * vocab chunks are loaded on demand and cached in memory.
 *
 * @module vocab/vocab-loader
 */

import type { VocabChunk } from '$lib/types';

// ── Cache ───────────────────────────────────────────────────────

/** In-memory cache of loaded vocabulary chunks, keyed by prefix. */
const cache = new Map<string, VocabChunk>();

/** Whether the core bundle has been loaded. */
let coreLoaded = false;

// ── Loader Functions ────────────────────────────────────────────

/**
 * Loads the core vocabulary bundle (`_core.json`).
 *
 * The core bundle is an array of `VocabChunk` objects containing
 * the most commonly used vocabularies (rdf, rdfs, owl, xsd,
 * dcterms, foaf, skos, etc.).
 *
 * Each chunk is cached individually by prefix.
 *
 * @param base - The SvelteKit `base` path (e.g. `/tapir`).
 * @returns Array of loaded core vocabulary chunks.
 */
export async function loadCoreBundle(base: string): Promise<VocabChunk[]> {
	if (coreLoaded) {
		return getCachedChunks();
	}

	const url = `${base}/vocabs/_core.json`;
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`Failed to load core vocabs: ${response.status} ${response.statusText}`);
	}

	const chunks: VocabChunk[] = await response.json();
	for (const chunk of chunks) {
		cache.set(chunk.prefix, chunk);
	}
	coreLoaded = true;

	return chunks;
}

/**
 * Loads a single vocabulary chunk by prefix.
 *
 * If the chunk is already cached, returns it immediately.
 * Otherwise fetches it from `/vocabs/{prefix}.json`.
 *
 * @param prefix - The vocabulary prefix (e.g. `"schema"`).
 * @param base - The SvelteKit `base` path.
 * @returns The loaded vocabulary chunk.
 */
export async function loadVocabChunk(prefix: string, base: string): Promise<VocabChunk> {
	const cached = cache.get(prefix);
	if (cached) return cached;

	const url = `${base}/vocabs/${prefix}.json`;
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`Failed to load vocab "${prefix}": ${response.status} ${response.statusText}`);
	}

	const chunk: VocabChunk = await response.json();
	cache.set(chunk.prefix, chunk);

	return chunk;
}

/**
 * Returns a cached vocabulary chunk, or undefined if not loaded.
 *
 * @param prefix - The vocabulary prefix.
 * @returns The cached chunk, or undefined.
 */
export function getCachedVocab(prefix: string): VocabChunk | undefined {
	return cache.get(prefix);
}

/**
 * Returns all currently cached vocabulary chunks.
 *
 * @returns Array of cached chunks.
 */
export function getCachedChunks(): VocabChunk[] {
	return Array.from(cache.values());
}

/**
 * Returns whether the core bundle has been loaded.
 */
export function isCoreLoaded(): boolean {
	return coreLoaded;
}

/**
 * Clears all cached vocabulary data. Primarily for testing.
 */
export function clearCache(): void {
	cache.clear();
	coreLoaded = false;
}
