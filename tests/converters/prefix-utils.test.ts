import { describe, it, expect } from 'vitest';
import { collectUsedPrefixes } from '$lib/converters/prefix-utils';
import N3 from 'n3';

const { namedNode, literal, quad } = N3.DataFactory;

// ── collectUsedPrefixes ─────────────────────────────────────────

describe('collectUsedPrefixes', () => {
	const quads = [
		quad(
			namedNode('http://example.org/shapes/Book'),
			namedNode('http://purl.org/dc/terms/title'),
			literal('A title')
		),
	];

	it('keeps only prefixes whose namespace occurs in the quads', () => {
		const used = collectUsedPrefixes(quads, {
			dcterms: 'http://purl.org/dc/terms/',
			ex: 'http://example.org/shapes/',
			foaf: 'http://xmlns.com/foaf/0.1/',
		});
		expect(used).toEqual({
			dcterms: 'http://purl.org/dc/terms/',
			ex: 'http://example.org/shapes/',
		});
	});

	it('ignores candidates with an empty namespace URI', () => {
		// A malformed [@NS] row with a missing URI must not prefix-match
		// every IRI in the data.
		const used = collectUsedPrefixes(quads, {
			broken: '',
			dcterms: 'http://purl.org/dc/terms/',
		});
		expect(used).toEqual({ dcterms: 'http://purl.org/dc/terms/' });
	});
});
