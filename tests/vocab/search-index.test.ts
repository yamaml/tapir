import { describe, it, expect, beforeEach } from 'vitest';
import { SearchIndex } from '$lib/vocab/search-index';
import type { VocabChunk } from '$lib/types';

// ── Test Data ───────────────────────────────────────────────────

const foafChunk: VocabChunk = {
	prefix: 'foaf',
	namespace: 'http://xmlns.com/foaf/0.1/',
	terms: {
		Person: { t: 'C', l: 'Person', c: 'A person.' },
		Organization: { t: 'C', l: 'Organization', c: 'An organization.' },
		Agent: { t: 'C', l: 'Agent', c: 'An agent.' },
		name: { t: 'P', l: 'name', c: 'A name for some thing.' },
		knows: { t: 'P', l: 'knows', c: 'A person known by this person.' },
		mbox: { t: 'P', l: 'personal mailbox', c: 'A personal mailbox.' },
		homepage: { t: 'P', l: 'homepage', c: 'A homepage.' },
	},
};

const schemaChunk: VocabChunk = {
	prefix: 'schema',
	namespace: 'http://schema.org/',
	terms: {
		Person: { t: 'C', l: 'Person', c: 'A person.' },
		Place: { t: 'C', l: 'Place', c: 'Entities with a physical extension.' },
		name: { t: 'P', l: 'name', c: 'The name of the item.' },
		description: { t: 'P', l: 'description', c: 'A description.' },
	},
};

// ── Tests ───────────────────────────────────────────────────────

describe('SearchIndex', () => {
	let index: SearchIndex;

	beforeEach(() => {
		index = new SearchIndex();
	});

	// ── addVocab ──────────────────────────────────────────────────

	describe('addVocab', () => {
		it('indexes terms from a vocab chunk', () => {
			index.addVocab(foafChunk);
			expect(index.size).toBe(7);
		});

		it('accumulates terms from multiple chunks', () => {
			index.addVocab(foafChunk);
			index.addVocab(schemaChunk);
			expect(index.size).toBe(11);
		});
	});

	// ── search — basic ───────────────────────────────────────────

	describe('search', () => {
		beforeEach(() => {
			index.addVocab(foafChunk);
			index.addVocab(schemaChunk);
		});

		it('returns empty array for empty query', () => {
			expect(index.search('')).toEqual([]);
		});

		it('finds exact match by local name', () => {
			const results = index.search('Person');
			expect(results.length).toBeGreaterThanOrEqual(2);
			expect(results[0].localName).toBe('Person');
		});

		it('finds prefix match by local name', () => {
			const results = index.search('Pers');
			expect(results.length).toBeGreaterThanOrEqual(2);
			// All results with local name "Person" should rank above label-only matches
			const personResults = results.filter((r) => r.localName === 'Person');
			expect(personResults.length).toBeGreaterThanOrEqual(2);
			// Person results should come first
			for (let i = 0; i < personResults.length; i++) {
				expect(results[i].localName).toBe('Person');
			}
		});

		it('finds contains match by local name', () => {
			const results = index.search('rson');
			expect(results.some((r) => r.localName === 'Person')).toBe(true);
		});

		it('finds match by label', () => {
			const results = index.search('personal mailbox');
			expect(results.some((r) => r.localName === 'mbox')).toBe(true);
		});

		it('is case insensitive', () => {
			const results = index.search('person');
			expect(results.some((r) => r.localName === 'Person')).toBe(true);
		});

		it('returns results with correct structure', () => {
			const results = index.search('Person');
			for (const r of results) {
				expect(r).toHaveProperty('prefix');
				expect(r).toHaveProperty('localName');
				expect(r).toHaveProperty('prefixed');
				expect(r).toHaveProperty('term');
				expect(r.prefixed).toBe(`${r.prefix}:${r.localName}`);
			}
		});
	});

	// ── search — ranking ─────────────────────────────────────────

	describe('search ranking', () => {
		beforeEach(() => {
			index.addVocab(foafChunk);
			index.addVocab(schemaChunk);
		});

		it('ranks exact match above prefix match', () => {
			const results = index.search('name');
			// "name" should be exact matches, ranked above "homepage" which only contains "name"
			const nameIdx = results.findIndex(
				(r) => r.localName === 'name'
			);
			const homepageIdx = results.findIndex(
				(r) => r.localName === 'homepage'
			);
			// homepage does NOT contain "name" in its local name (only in its label)
			// but "name" is an exact match so should be first
			expect(nameIdx).toBeLessThan(results.length);
			if (homepageIdx >= 0) {
				expect(nameIdx).toBeLessThan(homepageIdx);
			}
		});

		it('ranks prefix match above contains match', () => {
			const results = index.search('Org');
			const orgIdx = results.findIndex((r) => r.localName === 'Organization');
			expect(orgIdx).toBe(0);
		});
	});

	// ── search — type filter ─────────────────────────────────────

	describe('search with type filter', () => {
		beforeEach(() => {
			index.addVocab(foafChunk);
		});

		it('filters by class type', () => {
			const results = index.search('Person', { type: 'C' });
			expect(results.every((r) => r.term.t === 'C')).toBe(true);
		});

		it('filters by property type', () => {
			const results = index.search('name', { type: 'P' });
			expect(results.every((r) => r.term.t === 'P')).toBe(true);
		});

		it('returns empty when no matches for type', () => {
			// "Agent" is only a Class, not a Property
			const results = index.search('Agent', { type: 'P' });
			expect(results.length).toBe(0);
		});
	});

	// ── search — prefix:query syntax ─────────────────────────────

	describe('search with prefix:query syntax', () => {
		beforeEach(() => {
			index.addVocab(foafChunk);
			index.addVocab(schemaChunk);
		});

		it('filters by vocab prefix', () => {
			const results = index.search('foaf:Person');
			// foaf:Person exact match + foaf:mbox (label "personal mailbox" contains "person")
			expect(results.length).toBeGreaterThanOrEqual(1);
			expect(results[0].prefix).toBe('foaf');
			expect(results[0].localName).toBe('Person');
			// All results should be from foaf prefix
			expect(results.every((r) => r.prefix === 'foaf')).toBe(true);
		});

		it('returns all terms with just prefix:', () => {
			const results = index.search('foaf:');
			expect(results.length).toBe(7);
			expect(results.every((r) => r.prefix === 'foaf')).toBe(true);
		});

		it('filters prefix and searches local name', () => {
			const results = index.search('schema:Pl');
			expect(results.length).toBe(1);
			expect(results[0].localName).toBe('Place');
		});
	});

	// ── search — limit ───────────────────────────────────────────

	describe('search with limit', () => {
		beforeEach(() => {
			index.addVocab(foafChunk);
			index.addVocab(schemaChunk);
		});

		it('respects limit option', () => {
			const results = index.search('a', { limit: 3 });
			expect(results.length).toBeLessThanOrEqual(3);
		});

		it('uses default limit of 50', () => {
			const results = index.search('a');
			expect(results.length).toBeLessThanOrEqual(50);
		});
	});

	// ── clear ────────────────────────────────────────────────────

	describe('clear', () => {
		it('removes all indexed terms', () => {
			index.addVocab(foafChunk);
			expect(index.size).toBe(7);
			index.clear();
			expect(index.size).toBe(0);
			expect(index.search('Person')).toEqual([]);
		});
	});
});
