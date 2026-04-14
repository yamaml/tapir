import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
	loadCoreBundle,
	loadVocabChunk,
	getCachedVocab,
	getCachedChunks,
	isCoreLoaded,
	clearCache,
} from '$lib/vocab/vocab-loader';
import type { VocabChunk } from '$lib/types';

// ── Mock Data ───────────────────────────────────────────────────

const mockFoafChunk: VocabChunk = {
	prefix: 'foaf',
	namespace: 'http://xmlns.com/foaf/0.1/',
	terms: {
		Person: { t: 'C', l: 'Person' },
		name: { t: 'P', l: 'name' },
	},
};

const mockRdfChunk: VocabChunk = {
	prefix: 'rdf',
	namespace: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
	terms: {
		type: { t: 'P', l: 'type' },
	},
};

const mockCoreBundle: VocabChunk[] = [mockRdfChunk, mockFoafChunk];

// ── Tests ───────────────────────────────────────────────────────

describe('vocab-loader', () => {
	beforeEach(() => {
		clearCache();
		vi.restoreAllMocks();
	});

	describe('loadCoreBundle', () => {
		it('fetches and caches core chunks', async () => {
			const mockFetch = vi.fn().mockResolvedValue({
				ok: true,
				json: () => Promise.resolve(mockCoreBundle),
			});
			vi.stubGlobal('fetch', mockFetch);

			const chunks = await loadCoreBundle('/tapir');
			expect(chunks).toHaveLength(2);
			expect(mockFetch).toHaveBeenCalledWith('/tapir/vocabs/_core.json');
			expect(isCoreLoaded()).toBe(true);
		});

		it('caches individual chunks by prefix', async () => {
			vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
				ok: true,
				json: () => Promise.resolve(mockCoreBundle),
			}));

			await loadCoreBundle('/tapir');
			expect(getCachedVocab('foaf')).toEqual(mockFoafChunk);
			expect(getCachedVocab('rdf')).toEqual(mockRdfChunk);
		});

		it('returns cached chunks on second call without re-fetching', async () => {
			const mockFetch = vi.fn().mockResolvedValue({
				ok: true,
				json: () => Promise.resolve(mockCoreBundle),
			});
			vi.stubGlobal('fetch', mockFetch);

			await loadCoreBundle('/tapir');
			const chunks2 = await loadCoreBundle('/tapir');

			expect(mockFetch).toHaveBeenCalledTimes(1);
			expect(chunks2).toHaveLength(2);
		});

		it('throws on fetch failure', async () => {
			vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
				ok: false,
				status: 404,
				statusText: 'Not Found',
			}));

			await expect(loadCoreBundle('/tapir')).rejects.toThrow('Failed to load core vocabs');
		});
	});

	describe('loadVocabChunk', () => {
		it('fetches and caches a single chunk', async () => {
			vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
				ok: true,
				json: () => Promise.resolve(mockFoafChunk),
			}));

			const chunk = await loadVocabChunk('foaf', '/tapir');
			expect(chunk.prefix).toBe('foaf');
			expect(getCachedVocab('foaf')).toEqual(mockFoafChunk);
		});

		it('returns cached chunk without re-fetching', async () => {
			const mockFetch = vi.fn().mockResolvedValue({
				ok: true,
				json: () => Promise.resolve(mockFoafChunk),
			});
			vi.stubGlobal('fetch', mockFetch);

			await loadVocabChunk('foaf', '/tapir');
			await loadVocabChunk('foaf', '/tapir');
			expect(mockFetch).toHaveBeenCalledTimes(1);
		});

		it('throws on fetch failure', async () => {
			vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
				ok: false,
				status: 404,
				statusText: 'Not Found',
			}));

			await expect(loadVocabChunk('nonexistent', '/tapir')).rejects.toThrow(
				'Failed to load vocab "nonexistent"'
			);
		});
	});

	describe('getCachedChunks', () => {
		it('returns all cached chunks', async () => {
			vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
				ok: true,
				json: () => Promise.resolve(mockCoreBundle),
			}));

			await loadCoreBundle('/tapir');
			const all = getCachedChunks();
			expect(all).toHaveLength(2);
		});

		it('returns empty array when no chunks loaded', () => {
			expect(getCachedChunks()).toEqual([]);
		});
	});

	describe('clearCache', () => {
		it('clears all cached data', async () => {
			vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
				ok: true,
				json: () => Promise.resolve(mockCoreBundle),
			}));

			await loadCoreBundle('/tapir');
			expect(isCoreLoaded()).toBe(true);
			expect(getCachedChunks()).toHaveLength(2);

			clearCache();
			expect(isCoreLoaded()).toBe(false);
			expect(getCachedChunks()).toHaveLength(0);
		});
	});
});
