/**
 * build-vocabs.ts
 *
 * Reads N-Quads vocabulary data from @zazuko/rdf-vocabularies,
 * extracts per-term metadata, and outputs compact JSON chunks
 * to static/vocabs/.
 *
 * Usage: npx tsx scripts/build-vocabs.ts
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join, basename } from 'path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TermInfo {
  /** "C" for class, "P" for property */
  t: 'C' | 'P';
  /** rdfs:label */
  l?: string;
  /** rdfs:comment (truncated to 200 chars) */
  c?: string;
  /** rdfs:domain / schema:domainIncludes (local names) */
  d?: string[];
  /** rdfs:range / schema:rangeIncludes (local names) */
  r?: string[];
  /** rdfs:subClassOf (local names) */
  sc?: string[];
  /** rdfs:subPropertyOf (local names) */
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

// ---------------------------------------------------------------------------
// Well-known IRIs
// ---------------------------------------------------------------------------

const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
const RDFS_LABEL = 'http://www.w3.org/2000/01/rdf-schema#label';
const RDFS_COMMENT = 'http://www.w3.org/2000/01/rdf-schema#comment';
const RDFS_DOMAIN = 'http://www.w3.org/2000/01/rdf-schema#domain';
const RDFS_RANGE = 'http://www.w3.org/2000/01/rdf-schema#range';
const RDFS_SUBCLASS_OF = 'http://www.w3.org/2000/01/rdf-schema#subClassOf';
const RDFS_SUBPROPERTY_OF = 'http://www.w3.org/2000/01/rdf-schema#subPropertyOf';
const SCHEMA_DOMAIN_INCLUDES = 'http://schema.org/domainIncludes';
const SCHEMA_RANGE_INCLUDES = 'http://schema.org/rangeIncludes';

const CLASS_TYPES = new Set([
  'http://www.w3.org/2000/01/rdf-schema#Class',
  'http://www.w3.org/2002/07/owl#Class',
  'http://www.w3.org/2000/01/rdf-schema#Datatype',
]);

const PROPERTY_TYPES = new Set([
  'http://www.w3.org/1999/02/22-rdf-syntax-ns#Property',
  'http://www.w3.org/2002/07/owl#ObjectProperty',
  'http://www.w3.org/2002/07/owl#DatatypeProperty',
  'http://www.w3.org/2002/07/owl#AnnotationProperty',
]);

// Core vocab prefixes (schema excluded — loaded on demand)
const CORE_PREFIXES = [
  'rdf', 'rdfs', 'owl', 'xsd', 'dc11', 'dcterms',
  'foaf', 'skos', 'skosxl', 'dcat', 'prov', 'org',
  'vcard', 'sh', 'shex',
];

const MAX_COMMENT_LENGTH = 200;

// ---------------------------------------------------------------------------
// Namespace map (prefix → IRI) from @zazuko/prefixes
// ---------------------------------------------------------------------------

// We import the prefixes map at runtime so we always stay in sync
// with the installed version.
async function loadPrefixes(): Promise<Record<string, string>> {
  const mod = await import('@zazuko/prefixes');
  // The default export is the prefix→namespace map
  return mod.default as Record<string, string>;
}

// ---------------------------------------------------------------------------
// N-Quads parser (line-based, no external deps)
// ---------------------------------------------------------------------------

interface Quad {
  subject: string;
  predicate: string;
  object: string;       // IRI without angle brackets, or literal value
  objectIsIRI: boolean;
}

/**
 * Parse a single N-Quads line.  Returns null for blank-node subjects,
 * comments, or malformed lines.
 */
function parseNQuadLine(line: string): Quad | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;

  // Skip blank-node subjects (start with _:)
  if (trimmed.startsWith('_:')) return null;

  // Subject: <iri>
  const subjectMatch = trimmed.match(/^<([^>]+)>/);
  if (!subjectMatch) return null;
  const subject = subjectMatch[1];
  let rest = trimmed.slice(subjectMatch[0].length).trim();

  // Predicate: <iri>
  const predicateMatch = rest.match(/^<([^>]+)>/);
  if (!predicateMatch) return null;
  const predicate = predicateMatch[1];
  rest = rest.slice(predicateMatch[0].length).trim();

  // Object: either <iri> or "literal"...
  if (rest.startsWith('<')) {
    const objectMatch = rest.match(/^<([^>]+)>/);
    if (!objectMatch) return null;
    return { subject, predicate, object: objectMatch[1], objectIsIRI: true };
  }

  if (rest.startsWith('"')) {
    // Extract quoted literal — handle escaped quotes inside
    let i = 1;
    let value = '';
    while (i < rest.length) {
      if (rest[i] === '\\' && i + 1 < rest.length) {
        const next = rest[i + 1];
        if (next === '"') { value += '"'; i += 2; continue; }
        if (next === 'n') { value += '\n'; i += 2; continue; }
        if (next === 't') { value += '\t'; i += 2; continue; }
        if (next === '\\') { value += '\\'; i += 2; continue; }
        // fallthrough: keep backslash + char
        value += rest[i] + next;
        i += 2;
        continue;
      }
      if (rest[i] === '"') break;
      value += rest[i];
      i++;
    }
    return { subject, predicate, object: value, objectIsIRI: false };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Local-name extraction
// ---------------------------------------------------------------------------

function localName(iri: string): string {
  const hashIdx = iri.lastIndexOf('#');
  if (hashIdx >= 0) return iri.slice(hashIdx + 1);
  const slashIdx = iri.lastIndexOf('/');
  if (slashIdx >= 0) return iri.slice(slashIdx + 1);
  return iri;
}

// ---------------------------------------------------------------------------
// Build one vocab chunk
// ---------------------------------------------------------------------------

function buildVocabChunk(prefix: string, namespace: string, nqContent: string): VocabChunk {
  const terms: Record<string, TermInfo> = {};

  // Intermediate accumulator: subject → collected data
  const subjects = new Map<string, {
    isClass: boolean;
    isProperty: boolean;
    label?: string;
    comment?: string;
    domains: string[];
    ranges: string[];
    subClassOf: string[];
    subPropertyOf: string[];
  }>();

  function ensure(subj: string) {
    if (!subjects.has(subj)) {
      subjects.set(subj, {
        isClass: false,
        isProperty: false,
        domains: [],
        ranges: [],
        subClassOf: [],
        subPropertyOf: [],
      });
    }
    return subjects.get(subj)!;
  }

  for (const line of nqContent.split('\n')) {
    const quad = parseNQuadLine(line);
    if (!quad) continue;

    // Only process subjects within this vocab's namespace
    if (!quad.subject.startsWith(namespace)) continue;

    const entry = ensure(quad.subject);

    if (quad.predicate === RDF_TYPE && quad.objectIsIRI) {
      if (CLASS_TYPES.has(quad.object)) entry.isClass = true;
      if (PROPERTY_TYPES.has(quad.object)) entry.isProperty = true;
    } else if (quad.predicate === RDFS_LABEL && !quad.objectIsIRI) {
      // Prefer first label encountered (usually English or untagged)
      if (!entry.label) entry.label = quad.object;
    } else if (quad.predicate === RDFS_COMMENT && !quad.objectIsIRI) {
      if (!entry.comment) entry.comment = quad.object;
    } else if ((quad.predicate === RDFS_DOMAIN || quad.predicate === SCHEMA_DOMAIN_INCLUDES) && quad.objectIsIRI) {
      entry.domains.push(localName(quad.object));
    } else if ((quad.predicate === RDFS_RANGE || quad.predicate === SCHEMA_RANGE_INCLUDES) && quad.objectIsIRI) {
      entry.ranges.push(localName(quad.object));
    } else if (quad.predicate === RDFS_SUBCLASS_OF && quad.objectIsIRI) {
      entry.subClassOf.push(localName(quad.object));
    } else if (quad.predicate === RDFS_SUBPROPERTY_OF && quad.objectIsIRI) {
      entry.subPropertyOf.push(localName(quad.object));
    }
  }

  // Convert to compact TermInfo
  for (const [subjectIRI, data] of subjects) {
    if (!data.isClass && !data.isProperty) continue;

    const name = localName(subjectIRI);
    if (!name) continue;

    const term: TermInfo = {
      t: data.isClass ? 'C' : 'P',
    };

    if (data.label) term.l = data.label;

    if (data.comment) {
      let c = data.comment.replace(/\s+/g, ' ').trim();
      if (c.length > MAX_COMMENT_LENGTH) {
        c = c.slice(0, MAX_COMMENT_LENGTH - 1) + '\u2026';
      }
      term.c = c;
    }

    if (data.domains.length > 0) term.d = [...new Set(data.domains)];
    if (data.ranges.length > 0) term.r = [...new Set(data.ranges)];
    if (data.subClassOf.length > 0) term.sc = [...new Set(data.subClassOf)];
    if (data.subPropertyOf.length > 0) term.sp = [...new Set(data.subPropertyOf)];

    terms[name] = term;
  }

  return { prefix, namespace, terms };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const prefixes = await loadPrefixes();

  const ontologiesDir = join(
    process.cwd(),
    'node_modules', '@zazuko', 'rdf-vocabularies', 'ontologies',
  );
  const outDir = join(process.cwd(), 'static', 'vocabs');
  mkdirSync(outDir, { recursive: true });

  // Discover available .nq files
  const nqFiles = readdirSync(ontologiesDir)
    .filter(f => f.endsWith('.nq') && !f.startsWith('_'));

  const manifest: ManifestEntry[] = [];
  const chunks = new Map<string, VocabChunk>();

  let processed = 0;
  let skipped = 0;

  for (const file of nqFiles) {
    const prefix = basename(file, '.nq');
    const namespace = prefixes[prefix];
    if (!namespace) {
      skipped++;
      continue;
    }

    const nqPath = join(ontologiesDir, file);
    const content = readFileSync(nqPath, 'utf-8');
    const chunk = buildVocabChunk(prefix, namespace, content);

    const termCount = Object.keys(chunk.terms).length;
    if (termCount === 0) {
      skipped++;
      continue;
    }

    // Write individual chunk
    const outPath = join(outDir, `${prefix}.json`);
    const json = JSON.stringify(chunk);
    writeFileSync(outPath, json, 'utf-8');

    chunks.set(prefix, chunk);
    manifest.push({
      prefix,
      namespace,
      termCount,
      sizeBytes: Buffer.byteLength(json, 'utf-8'),
    });
    processed++;
  }

  // Sort manifest alphabetically
  manifest.sort((a, b) => a.prefix.localeCompare(b.prefix));

  // Build _core.json — array of chunks for the core vocabs
  const coreChunks: VocabChunk[] = [];
  for (const p of CORE_PREFIXES) {
    const chunk = chunks.get(p);
    if (chunk) {
      coreChunks.push(chunk);
    } else {
      console.warn(`  warn: core vocab "${p}" not found in built vocabs`);
    }
  }
  const corePath = join(outDir, '_core.json');
  writeFileSync(corePath, JSON.stringify(coreChunks), 'utf-8');

  // Write _manifest.json
  const manifestPath = join(outDir, '_manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

  // Summary
  console.log(`Built ${processed} vocab chunks (${skipped} skipped)`);
  console.log(`Core bundle: ${CORE_PREFIXES.length} vocabs → ${corePath}`);
  console.log(`Manifest: ${manifest.length} entries → ${manifestPath}`);

  // File sizes
  const coreSize = statSync(corePath).size;
  const schemaChunk = chunks.get('schema');
  const schemaSize = schemaChunk
    ? statSync(join(outDir, 'schema.json')).size
    : 0;
  console.log(`Core size: ${(coreSize / 1024).toFixed(1)} KB`);
  if (schemaSize) console.log(`Schema size: ${(schemaSize / 1024).toFixed(1)} KB (on-demand)`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
