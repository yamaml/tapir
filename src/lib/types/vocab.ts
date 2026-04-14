/**
 * @fileoverview Vocabulary chunk and search types.
 * @module types/vocab
 */

// ── Vocabulary Data ─────────────────────────────────────────────

/** A single vocabulary term (class or property). */
export interface VocabTerm {
	/** Term type: C = Class, P = Property. */
	t: 'C' | 'P';
	/** rdfs:label. */
	l: string;
	/** rdfs:comment (may be empty for lightweight chunks). */
	c?: string;
	/** rdfs:domain (local names within same vocab). */
	d?: string[];
	/** rdfs:range (local names within same vocab). */
	r?: string[];
	/** rdfs:subClassOf (local names). */
	sc?: string[];
	/** rdfs:subPropertyOf (local names). */
	sp?: string[];
}

/** A complete vocabulary chunk. */
export interface VocabChunk {
	prefix: string;
	namespace: string;
	terms: Record<string, VocabTerm>;
}

/** Vocabulary manifest entry. */
export interface VocabManifestEntry {
	prefix: string;
	namespace: string;
	termCount: number;
	sizeBytes: number;
}

// ── Search ──────────────────────────────────────────────────────

/** Search result from vocabulary lookup. */
export interface VocabSearchResult {
	prefix: string;
	localName: string;
	prefixed: string;
	term: VocabTerm;
}

// ── SPARQL ──────────────────────────────────────────────────────

/** SPARQL endpoint status after testing. */
export interface EndpointStatus {
	url: string;
	available: boolean;
	corsOk: boolean;
	latencyMs: number;
	error?: string;
}

/** SPARQL endpoint configuration. */
export interface SparqlEndpoint {
	url: string;
	name: string;
	status: EndpointStatus | null;
}

/** Pre-configured public SPARQL endpoints. */
export const PUBLIC_ENDPOINTS: Omit<SparqlEndpoint, 'status'>[] = [
	{ url: 'https://query.wikidata.org/sparql', name: 'Wikidata' },
	{ url: 'https://dbpedia.org/sparql', name: 'DBpedia' },
	{ url: 'https://lov.linkeddata.es/dataset/lov/sparql', name: 'Linked Open Vocabularies' },
];
