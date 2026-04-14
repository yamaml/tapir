import { describe, it, expect } from 'vitest';
import { expandPrefixed, compressPrefixed } from '$lib/utils/iri-utils';

const NS = {
	foaf: 'http://xmlns.com/foaf/0.1/',
	dcterms: 'http://purl.org/dc/terms/',
	xsd: 'http://www.w3.org/2001/XMLSchema#',
};

describe('expandPrefixed', () => {
	it('expands a prefixed term', () => {
		expect(expandPrefixed('foaf:name', NS)).toBe(
			'http://xmlns.com/foaf/0.1/name'
		);
	});

	it('expands with different prefix', () => {
		expect(expandPrefixed('dcterms:title', NS)).toBe(
			'http://purl.org/dc/terms/title'
		);
	});

	it('expands hash-delimited namespace', () => {
		expect(expandPrefixed('xsd:string', NS)).toBe(
			'http://www.w3.org/2001/XMLSchema#string'
		);
	});

	it('returns full http IRIs unchanged', () => {
		const iri = 'http://example.org/thing';
		expect(expandPrefixed(iri, NS)).toBe(iri);
	});

	it('returns full https IRIs unchanged', () => {
		const iri = 'https://example.org/thing';
		expect(expandPrefixed(iri, NS)).toBe(iri);
	});

	it('returns URN IRIs unchanged', () => {
		const iri = 'urn:isbn:0451450523';
		expect(expandPrefixed(iri, NS)).toBe(iri);
	});

	it('falls back to base IRI for unprefixed terms', () => {
		expect(expandPrefixed('localTerm', {}, 'http://example.org/')).toBe(
			'http://example.org/localTerm'
		);
	});

	it('returns unprefixed term as-is without base', () => {
		expect(expandPrefixed('localTerm', {})).toBe('localTerm');
	});

	it('returns null for null input', () => {
		expect(expandPrefixed(null, NS)).toBeNull();
	});

	it('returns null for undefined input', () => {
		expect(expandPrefixed(undefined, NS)).toBeNull();
	});

	it('returns null for empty string', () => {
		expect(expandPrefixed('', NS)).toBeNull();
	});

	it('returns prefixed term as-is if prefix not in namespace map', () => {
		expect(expandPrefixed('unknown:term', NS)).toBe('unknown:term');
	});

	it('falls back to base when prefix not in namespace map', () => {
		expect(
			expandPrefixed('unknown:term', NS, 'http://base.org/')
		).toBe('http://base.org/unknown:term');
	});
});

describe('compressPrefixed', () => {
	it('compresses a full IRI to prefixed form', () => {
		expect(
			compressPrefixed('http://xmlns.com/foaf/0.1/Person', NS)
		).toBe('foaf:Person');
	});

	it('compresses hash-delimited namespace', () => {
		expect(
			compressPrefixed('http://www.w3.org/2001/XMLSchema#date', NS)
		).toBe('xsd:date');
	});

	it('returns unmatched IRI unchanged', () => {
		const iri = 'http://unknown.org/thing';
		expect(compressPrefixed(iri, NS)).toBe(iri);
	});

	it('compresses IRI with empty local name', () => {
		expect(
			compressPrefixed('http://xmlns.com/foaf/0.1/', NS)
		).toBe('foaf:');
	});

	it('works with empty namespace map', () => {
		const iri = 'http://xmlns.com/foaf/0.1/Person';
		expect(compressPrefixed(iri, {})).toBe(iri);
	});
});
