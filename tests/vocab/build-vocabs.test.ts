import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const vocabDir = join(process.cwd(), 'static', 'vocabs');

interface TermInfo {
  t: 'C' | 'P';
  l?: string;
  c?: string;
  d?: string[];
  r?: string[];
  sc?: string[];
  sp?: string[];
}

interface VocabChunk {
  prefix: string;
  namespace: string;
  terms: Record<string, TermInfo>;
}

interface ManifestEntry {
  prefix: string;
  namespace: string;
  termCount: number;
  sizeBytes: number;
}

function loadJSON<T>(filename: string): T {
  return JSON.parse(readFileSync(join(vocabDir, filename), 'utf-8'));
}

describe('build-vocabs output', () => {
  beforeAll(() => {
    if (!existsSync(join(vocabDir, '_manifest.json'))) {
      throw new Error(
        'Vocab files not found. Run `npx tsx scripts/build-vocabs.ts` first.',
      );
    }
  });

  // -------------------------------------------------------------------------
  // Manifest
  // -------------------------------------------------------------------------
  describe('_manifest.json', () => {
    let manifest: ManifestEntry[];

    beforeAll(() => {
      manifest = loadJSON<ManifestEntry[]>('_manifest.json');
    });

    it('is a non-empty array', () => {
      expect(Array.isArray(manifest)).toBe(true);
      expect(manifest.length).toBeGreaterThan(0);
    });

    it('entries have the required fields', () => {
      for (const entry of manifest) {
        expect(entry).toHaveProperty('prefix');
        expect(entry).toHaveProperty('namespace');
        expect(entry).toHaveProperty('termCount');
        expect(entry).toHaveProperty('sizeBytes');
        expect(typeof entry.prefix).toBe('string');
        expect(typeof entry.namespace).toBe('string');
        expect(typeof entry.termCount).toBe('number');
        expect(typeof entry.sizeBytes).toBe('number');
        expect(entry.termCount).toBeGreaterThan(0);
        expect(entry.sizeBytes).toBeGreaterThan(0);
      }
    });

    it('is sorted alphabetically by prefix', () => {
      const prefixes = manifest.map(e => e.prefix);
      const sorted = [...prefixes].sort();
      expect(prefixes).toEqual(sorted);
    });

    it('each manifest entry has a corresponding .json file', () => {
      for (const entry of manifest) {
        const filePath = join(vocabDir, `${entry.prefix}.json`);
        expect(existsSync(filePath)).toBe(true);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Individual vocab chunks
  // -------------------------------------------------------------------------
  describe('individual vocab chunks', () => {
    it('foaf.json has expected structure', () => {
      const foaf = loadJSON<VocabChunk>('foaf.json');
      expect(foaf.prefix).toBe('foaf');
      expect(foaf.namespace).toBe('http://xmlns.com/foaf/0.1/');
      expect(foaf.terms).toBeDefined();
      expect(Object.keys(foaf.terms).length).toBeGreaterThan(0);
    });

    it('foaf terms have valid type fields', () => {
      const foaf = loadJSON<VocabChunk>('foaf.json');
      for (const [, term] of Object.entries(foaf.terms)) {
        expect(['C', 'P']).toContain(term.t);
      }
    });

    it('foaf:Person is a Class', () => {
      const foaf = loadJSON<VocabChunk>('foaf.json');
      const person = foaf.terms['Person'];
      expect(person).toBeDefined();
      expect(person.t).toBe('C');
      expect(person.l).toBe('Person');
    });

    it('foaf:knows is a Property with domain and range', () => {
      const foaf = loadJSON<VocabChunk>('foaf.json');
      const knows = foaf.terms['knows'];
      expect(knows).toBeDefined();
      expect(knows.t).toBe('P');
      expect(knows.d).toContain('Person');
      expect(knows.r).toContain('Person');
    });

    it('foaf:Group has subClassOf Agent', () => {
      const foaf = loadJSON<VocabChunk>('foaf.json');
      const group = foaf.terms['Group'];
      expect(group).toBeDefined();
      expect(group.sc).toContain('Agent');
    });

    it('comments are truncated to max 200 chars', () => {
      // Check all terms across a large vocab (schema.org has long comments)
      if (!existsSync(join(vocabDir, 'schema.json'))) return;
      const schema = loadJSON<VocabChunk>('schema.json');
      for (const [, term] of Object.entries(schema.terms)) {
        if (term.c) {
          expect(term.c.length).toBeLessThanOrEqual(200);
        }
      }
    });

    it('term fields omit empty arrays', () => {
      const foaf = loadJSON<VocabChunk>('foaf.json');
      for (const [, term] of Object.entries(foaf.terms)) {
        if (term.d !== undefined) expect(term.d.length).toBeGreaterThan(0);
        if (term.r !== undefined) expect(term.r.length).toBeGreaterThan(0);
        if (term.sc !== undefined) expect(term.sc.length).toBeGreaterThan(0);
        if (term.sp !== undefined) expect(term.sp.length).toBeGreaterThan(0);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Core bundle
  // -------------------------------------------------------------------------
  describe('_core.json', () => {
    let core: VocabChunk[];

    const EXPECTED_CORE = [
      'rdf', 'rdfs', 'owl', 'xsd', 'dc11', 'dcterms',
      'foaf', 'skos', 'skosxl', 'dcat', 'prov', 'org',
      'vcard', 'sh', 'shex',
    ];

    beforeAll(() => {
      core = loadJSON<VocabChunk[]>('_core.json');
    });

    it('is an array of 15 vocab chunks', () => {
      expect(Array.isArray(core)).toBe(true);
      expect(core.length).toBe(15);
    });

    it('contains exactly the expected prefixes in order', () => {
      const prefixes = core.map(c => c.prefix);
      expect(prefixes).toEqual(EXPECTED_CORE);
    });

    it('does not include schema.org', () => {
      const prefixes = core.map(c => c.prefix);
      expect(prefixes).not.toContain('schema');
    });

    it('each core chunk has valid structure', () => {
      for (const chunk of core) {
        expect(chunk.prefix).toBeDefined();
        expect(chunk.namespace).toBeDefined();
        expect(chunk.terms).toBeDefined();
        expect(Object.keys(chunk.terms).length).toBeGreaterThan(0);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Schema.org (on-demand, separate file)
  // -------------------------------------------------------------------------
  describe('schema.json', () => {
    it('exists as a separate file (not in core)', () => {
      expect(existsSync(join(vocabDir, 'schema.json'))).toBe(true);
    });

    it('has schema.org namespace', () => {
      const schema = loadJSON<VocabChunk>('schema.json');
      expect(schema.prefix).toBe('schema');
      expect(schema.namespace).toBe('http://schema.org/');
    });

    it('has a large number of terms', () => {
      const schema = loadJSON<VocabChunk>('schema.json');
      // schema.org has 2000+ types and properties
      expect(Object.keys(schema.terms).length).toBeGreaterThan(1000);
    });

    it('schema:Person is a Class with subClassOf', () => {
      const schema = loadJSON<VocabChunk>('schema.json');
      const person = schema.terms['Person'];
      expect(person).toBeDefined();
      expect(person.t).toBe('C');
      expect(person.sc).toContain('Thing');
    });

    it('schema:name is a Property with domainIncludes/rangeIncludes', () => {
      const schema = loadJSON<VocabChunk>('schema.json');
      const name = schema.terms['name'];
      expect(name).toBeDefined();
      expect(name.t).toBe('P');
      expect(name.d).toBeDefined();
      expect(name.d!.length).toBeGreaterThan(0);
      expect(name.r).toBeDefined();
      expect(name.r!.length).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // XSD datatypes
  // -------------------------------------------------------------------------
  describe('xsd.json', () => {
    it('includes XSD datatypes as classes', () => {
      const xsd = loadJSON<VocabChunk>('xsd.json');
      expect(xsd.prefix).toBe('xsd');
      // Common XSD types should be present
      expect(xsd.terms['string']).toBeDefined();
      expect(xsd.terms['integer']).toBeDefined();
      expect(xsd.terms['boolean']).toBeDefined();
      expect(xsd.terms['dateTime']).toBeDefined();
      // They should be typed as classes (datatypes are subclasses of rdfs:Literal)
      expect(xsd.terms['string'].t).toBe('C');
    });
  });
});
