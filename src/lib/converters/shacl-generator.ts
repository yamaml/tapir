/**
 * @fileoverview SHACL (Shapes Constraint Language) generator.
 *
 * Generates a SHACL shapes graph from a `TapirProject` and serializes
 * it as an RDF string using N3.js.
 *
 * Tapir → SHACL mapping:
 *
 * | Tapir element              | SHACL property                |
 * |----------------------------|-------------------------------|
 * | Description                | sh:NodeShape                  |
 * | Description.targetClass    | sh:targetClass                |
 * | Description.label          | sh:name                       |
 * | Description.note           | sh:description                |
 * | Description.closed         | sh:closed + sh:ignoredProperties |
 * | Statement                  | sh:PropertyShape (via sh:property) |
 * | Statement.propertyId       | sh:path                       |
 * | Statement.label            | sh:name                       |
 * | Statement.note             | sh:description                |
 * | Statement.min              | sh:minCount                   |
 * | Statement.max              | sh:maxCount                   |
 * | Statement.datatype         | sh:datatype                   |
 * | Statement.valueType (iri)  | sh:nodeKind sh:IRI            |
 * | Statement.valueType (literal) | sh:nodeKind sh:Literal     |
 * | Statement.valueType (bnode)| sh:nodeKind sh:BlankNodeOrIRI |
 * | Statement.shapeRefs (single) | sh:node                       |
 * | Statement.shapeRefs (many)   | sh:or ([sh:node ... ])        |
 * | Statement.classConstraint  | sh:class (sh:or when many)     |
 * | Statement.inScheme         | sh:pattern "^<stem>" (sh:or when many) |
 * | Statement.facets.MinInclusive | sh:minInclusive            |
 * | Statement.facets.MaxInclusive | sh:maxInclusive            |
 * | Statement.facets.MinExclusive | sh:minExclusive            |
 * | Statement.facets.MaxExclusive | sh:maxExclusive            |
 * | Statement.facets.MinLength | sh:minLength                  |
 * | Statement.facets.MaxLength | sh:maxLength                  |
 * | Statement.pattern          | sh:pattern                    |
 * | Statement.values (literal) | sh:in (string literals)       |
 * | Statement.values (iri)     | sh:in (IRI terms)             |
 * | languageTag constraint     | sh:languageIn                 |
 *
 * CURIEs resolve against the project's namespaces with the standard
 * prefix table (SimpleDSP §7) as a fallback; declarations are emitted
 * for every prefix actually used.
 *
 * Ported from yama-cli `src/modules/shacl.js`.
 *
 * @module converters/shacl-generator
 * @see https://www.w3.org/TR/shacl/
 */

import type { TapirProject, Statement, NamespaceMap } from '$lib/types';
import type { RdfFormat, GeneratorWarning } from '$lib/types/export';
import { expandPrefixed } from '$lib/utils/iri-utils';
import {
	buildResolutionMap,
	collectUsedPrefixes,
	warnIfIllegalIriName,
} from './prefix-utils';
import N3 from 'n3';

const { DataFactory } = N3;
const { namedNode, literal, blankNode, quad } = DataFactory;

// ── SHACL / RDF Vocabulary Constants ────────────────────────────

const SH = 'http://www.w3.org/ns/shacl#';
const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const XSD = 'http://www.w3.org/2001/XMLSchema#';

const SH_NODE_SHAPE = namedNode(`${SH}NodeShape`);
const SH_PROPERTY_SHAPE = namedNode(`${SH}PropertyShape`);
const SH_TARGET_CLASS = namedNode(`${SH}targetClass`);
const SH_PROPERTY = namedNode(`${SH}property`);
const SH_PATH = namedNode(`${SH}path`);
const SH_NAME = namedNode(`${SH}name`);
const SH_DESCRIPTION = namedNode(`${SH}description`);
const SH_MIN_COUNT = namedNode(`${SH}minCount`);
const SH_MAX_COUNT = namedNode(`${SH}maxCount`);
const SH_DATATYPE = namedNode(`${SH}datatype`);
const SH_NODE_KIND = namedNode(`${SH}nodeKind`);
const SH_NODE = namedNode(`${SH}node`);
const SH_MIN_INCLUSIVE = namedNode(`${SH}minInclusive`);
const SH_MAX_INCLUSIVE = namedNode(`${SH}maxInclusive`);
const SH_MIN_EXCLUSIVE = namedNode(`${SH}minExclusive`);
const SH_MAX_EXCLUSIVE = namedNode(`${SH}maxExclusive`);
const SH_MIN_LENGTH = namedNode(`${SH}minLength`);
const SH_MAX_LENGTH = namedNode(`${SH}maxLength`);
const SH_CLASS = namedNode(`${SH}class`);
const SH_LANGUAGE_IN = namedNode(`${SH}languageIn`);
const SH_PATTERN = namedNode(`${SH}pattern`);
const SH_IN = namedNode(`${SH}in`);
const SH_IRI = namedNode(`${SH}IRI`);
const SH_LITERAL = namedNode(`${SH}Literal`);
const SH_BLANK_NODE_OR_IRI = namedNode(`${SH}BlankNodeOrIRI`);
const SH_CLOSED = namedNode(`${SH}closed`);
const SH_IGNORED_PROPERTIES = namedNode(`${SH}ignoredProperties`);
const SH_OR = namedNode(`${SH}or`);

const RDF_TYPE = namedNode(`${RDF}type`);
const RDF_FIRST = namedNode(`${RDF}first`);
const RDF_REST = namedNode(`${RDF}rest`);
const RDF_NIL = namedNode(`${RDF}nil`);

const XSD_INTEGER = namedNode(`${XSD}integer`);
const XSD_DECIMAL = namedNode(`${XSD}decimal`);
const XSD_BOOLEAN = namedNode(`${XSD}boolean`);

// ── N3 Format Map ───────────────────────────────────────────────

/** Maps RdfFormat values to N3.Writer format strings. */
const N3_FORMAT_MAP: Record<RdfFormat, string> = {
	turtle: 'Turtle',
	ntriples: 'N-Triples',
	nquads: 'N-Quads',
	trig: 'TriG',
};

// ── Regex Escaping ──────────────────────────────────────────────

/** Escapes regex metacharacters so a URI stem can anchor a sh:pattern. */
function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── RDF List Builder ────────────────────────────────────────────

/**
 * Builds an RDF list (rdf:first/rdf:rest chain) from an array of RDF terms.
 *
 * @param items - Terms to include in the list.
 * @param quads - Accumulator for generated quads.
 * @returns Head node of the list (blank node or rdf:nil for empty).
 */
/** Valid object terms for RDF lists — excludes DefaultGraph/Variable which can't be list members. */
type RdfListItem = N3.NamedNode | N3.BlankNode | N3.Literal;

export function buildRdfList(items: RdfListItem[], quads: N3.Quad[]): N3.BlankNode | N3.NamedNode {
	if (items.length === 0) return RDF_NIL;

	const head = blankNode();
	let current = head;

	for (let i = 0; i < items.length; i++) {
		quads.push(quad(current, RDF_FIRST, items[i]));
		if (i < items.length - 1) {
			const next = blankNode();
			quads.push(quad(current, RDF_REST, next));
			current = next;
		} else {
			quads.push(quad(current, RDF_REST, RDF_NIL));
		}
	}

	return head;
}

// ── Node Kind Resolver ──────────────────────────────────────────

/**
 * Maps a Tapir valueType to a SHACL sh:nodeKind term.
 *
 * @param type - Tapir valueType value (iri, literal, bnode).
 * @returns The corresponding SHACL nodeKind named node, or null.
 */
export function resolveNodeKind(type: string): N3.NamedNode | null {
	if (!type) return null;
	switch (type.toLowerCase()) {
		case 'iri':
			return SH_IRI;
		case 'literal':
			return SH_LITERAL;
		case 'bnode':
			return SH_BLANK_NODE_OR_IRI;
		default:
			return null;
	}
}

// ── Property Shape Builder ──────────────────────────────────────

/**
 * Builds SHACL quads for a single property shape from a Tapir Statement.
 *
 * @param shapeNode - Parent NodeShape named node.
 * @param stmt - The Tapir Statement.
 * @param namespaces - Prefix-to-IRI map.
 * @param base - Document base IRI.
 * @param quads - Accumulator for generated quads.
 * @param warnings - Optional accumulator for lossy-mapping warnings.
 */
export function buildPropertyShape(
	shapeNode: N3.NamedNode,
	stmt: Statement,
	namespaces: NamespaceMap,
	base: string,
	quads: N3.Quad[],
	warnings?: GeneratorWarning[]
): void {
	const propertyIri = expandPrefixed(stmt.propertyId, namespaces, base);
	if (!propertyIri) return;

	const propNode = blankNode();

	quads.push(quad(propNode, RDF_TYPE, SH_PROPERTY_SHAPE));
	quads.push(quad(shapeNode, SH_PROPERTY, propNode));
	quads.push(quad(propNode, SH_PATH, namedNode(propertyIri)));

	// sh:name from label
	if (stmt.label) {
		quads.push(quad(propNode, SH_NAME, literal(stmt.label)));
	}

	// sh:description from note
	if (stmt.note) {
		quads.push(quad(propNode, SH_DESCRIPTION, literal(stmt.note)));
	}

	// sh:minCount
	if (stmt.min != null) {
		quads.push(quad(propNode, SH_MIN_COUNT, literal(String(stmt.min), XSD_INTEGER)));
	}

	// sh:maxCount
	if (stmt.max != null) {
		quads.push(quad(propNode, SH_MAX_COUNT, literal(String(stmt.max), XSD_INTEGER)));
	}

	// sh:datatype. sh:datatype itself is single-valued in SHACL, so
	// multi-datatype becomes sh:or of nested [sh:datatype X] blank
	// nodes — the canonical SHACL pattern for "datatype is one of".
	// Mirrors the multi-shape sh:or block below.
	const datatypes = stmt.datatype ?? [];
	if (datatypes.length === 1) {
		const dtIri = expandPrefixed(datatypes[0], namespaces, base);
		if (dtIri) {
			quads.push(quad(propNode, SH_DATATYPE, namedNode(dtIri)));
		}
	} else if (datatypes.length > 1) {
		const dtAnons = datatypes
			.map((dt) => {
				const dtIri = expandPrefixed(dt, namespaces, base);
				if (!dtIri) return null;
				const anon = blankNode();
				quads.push(quad(anon, SH_DATATYPE, namedNode(dtIri)));
				return anon;
			})
			.filter((n): n is ReturnType<typeof blankNode> => n !== null);
		if (dtAnons.length > 0) {
			const listHead = buildRdfList(dtAnons, quads);
			quads.push(quad(propNode, SH_OR, listHead));
		}
	}

	// sh:nodeKind (only when no datatype -- datatype already implies Literal)
	if (datatypes.length === 0) {
		const nodeKind = resolveNodeKind(stmt.valueType);
		if (nodeKind) {
			quads.push(quad(propNode, SH_NODE_KIND, nodeKind));
		}
	}

	// sh:node -- reference to another shape. Multi-shape becomes sh:or.
	const refs = stmt.shapeRefs ?? [];
	if (refs.length === 1) {
		const refIri = base ? base + refs[0] : refs[0];
		quads.push(quad(propNode, SH_NODE, namedNode(refIri)));
	} else if (refs.length > 1) {
		const nodeAnons = refs.map((r) => {
			const anon = blankNode();
			const refIri = base ? base + r : r;
			quads.push(quad(anon, SH_NODE, namedNode(refIri)));
			return anon;
		});
		const listHead = buildRdfList(nodeAnons, quads);
		quads.push(quad(propNode, SH_OR, listHead));
	}

	// sh:class -- class constraint on the value node (sh:or when many).
	const classes = stmt.classConstraint ?? [];
	if (classes.length === 1) {
		const classIri = expandPrefixed(classes[0], namespaces, base);
		if (classIri) {
			quads.push(quad(propNode, SH_CLASS, namedNode(classIri)));
		}
	} else if (classes.length > 1) {
		const classAnons = classes
			.map((c) => {
				const classIri = expandPrefixed(c, namespaces, base);
				if (!classIri) return null;
				const anon = blankNode();
				quads.push(quad(anon, SH_CLASS, namedNode(classIri)));
				return anon;
			})
			.filter((n): n is ReturnType<typeof blankNode> => n !== null);
		if (classAnons.length > 0) {
			quads.push(quad(propNode, SH_OR, buildRdfList(classAnons, quads)));
		}
	}

	// inScheme — vocabulary namespace constraint. SHACL has no native
	// "in scheme" term, so the stem becomes an anchored sh:pattern on
	// the value IRI (the same reading DCTAP gives IRIstem).
	const schemes = (stmt.inScheme ?? [])
		.map((s) => {
			const iri = expandPrefixed(s, namespaces, base);
			if (!iri || !/^(https?|urn):/.test(iri)) {
				warnings?.push({
					message: `Statement "${stmt.label || stmt.propertyId}": inScheme stem "${s}" does not resolve to a namespace URI — omitted from SHACL output`,
				});
				return null;
			}
			return iri;
		})
		.filter((s): s is string => s !== null);
	if (schemes.length === 1) {
		quads.push(quad(propNode, SH_PATTERN, literal(`^${escapeRegex(schemes[0])}`)));
	} else if (schemes.length > 1) {
		const schemeAnons = schemes.map((s) => {
			const anon = blankNode();
			quads.push(quad(anon, SH_PATTERN, literal(`^${escapeRegex(s)}`)));
			return anon;
		});
		quads.push(quad(propNode, SH_OR, buildRdfList(schemeAnons, quads)));
	}

	// Facets
	if (stmt.facets) {
		const numericFacets: Array<[number | undefined, N3.NamedNode]> = [
			[stmt.facets.MinInclusive, SH_MIN_INCLUSIVE],
			[stmt.facets.MaxInclusive, SH_MAX_INCLUSIVE],
			[stmt.facets.MinExclusive, SH_MIN_EXCLUSIVE],
			[stmt.facets.MaxExclusive, SH_MAX_EXCLUSIVE],
		];
		for (const [value, predicate] of numericFacets) {
			if (value != null) {
				quads.push(quad(propNode, predicate, literal(String(value), XSD_DECIMAL)));
			}
		}
		if (stmt.facets.MinLength != null) {
			quads.push(quad(propNode, SH_MIN_LENGTH, literal(String(stmt.facets.MinLength), XSD_INTEGER)));
		}
		if (stmt.facets.MaxLength != null) {
			quads.push(quad(propNode, SH_MAX_LENGTH, literal(String(stmt.facets.MaxLength), XSD_INTEGER)));
		}
		// Length: SHACL core has no sh:length — emit the equivalent pair.
		if (stmt.facets.Length != null) {
			quads.push(quad(propNode, SH_MIN_LENGTH, literal(String(stmt.facets.Length), XSD_INTEGER)));
			quads.push(quad(propNode, SH_MAX_LENGTH, literal(String(stmt.facets.Length), XSD_INTEGER)));
		}
		for (const unmappable of ['TotalDigits', 'FractionDigits'] as const) {
			if (stmt.facets[unmappable] != null) {
				warnings?.push({
					message: `Statement "${stmt.label || stmt.propertyId}": facet ${unmappable} has no SHACL core equivalent — omitted`,
				});
			}
		}
	}

	// sh:pattern
	if (stmt.pattern) {
		quads.push(quad(propNode, SH_PATTERN, literal(stmt.pattern)));
	}

	// Enumerated values. Language-tag constraints map to sh:languageIn;
	// IRI-typed value sets become IRI terms (a string literal can never
	// equal an IRI node, so emitting literals made the constraint
	// unsatisfiable); literal value sets stay literals.
	if (Array.isArray(stmt.values) && stmt.values.length > 0) {
		if ((stmt.constraintType || '').toLowerCase() === 'languagetag') {
			const items = stmt.values.map((v) => literal(String(v)));
			quads.push(quad(propNode, SH_LANGUAGE_IN, buildRdfList(items, quads)));
		} else if (stmt.valueType === 'iri') {
			const items = stmt.values
				.map((v) => expandPrefixed(String(v), namespaces, base))
				.filter((iri): iri is string => !!iri)
				.map((iri) => namedNode(iri));
			if (items.length > 0) {
				quads.push(quad(propNode, SH_IN, buildRdfList(items, quads)));
			}
		} else {
			const items = stmt.values.map((v) => literal(String(v)));
			quads.push(quad(propNode, SH_IN, buildRdfList(items, quads)));
		}
	}
}

// ── SHACL Quads Builder ─────────────────────────────────────────

/**
 * Builds the complete SHACL shapes graph from a `TapirProject`.
 *
 * Each Tapir Description becomes a `sh:NodeShape`. Descriptions with
 * a `targetClass` get a `sh:targetClass`. Each Statement becomes a
 * `sh:PropertyShape` linked via `sh:property`.
 *
 * @param project - The Tapir project.
 * @param namespaces - Prefix-to-IRI map (project namespaces + sh).
 * @param base - Document base IRI.
 * @param warnings - Optional accumulator for lossy-mapping warnings.
 * @returns Array of N3 quads.
 */
export function buildShaclQuads(
	project: TapirProject,
	namespaces: NamespaceMap,
	base: string,
	warnings?: GeneratorWarning[]
): N3.Quad[] {
	const quads: N3.Quad[] = [];
	const descriptions = project.descriptions || [];

	for (const desc of descriptions) {
		// Shape IRIs are minted by concatenation (matching yama-cli);
		// names with IRI-illegal characters produce invalid output.
		warnIfIllegalIriName(desc.name, warnings);
		const shapeIri = base ? base + desc.name : desc.name;
		const shapeNode = namedNode(shapeIri);

		// rdf:type sh:NodeShape
		quads.push(quad(shapeNode, RDF_TYPE, SH_NODE_SHAPE));

		// sh:targetClass
		if (desc.targetClass) {
			const classIri = expandPrefixed(desc.targetClass, namespaces, base);
			if (classIri) {
				quads.push(quad(shapeNode, SH_TARGET_CLASS, namedNode(classIri)));
			}
		}

		// sh:name from label
		if (desc.label) {
			quads.push(quad(shapeNode, SH_NAME, literal(desc.label)));
		}

		// sh:description from note
		if (desc.note) {
			quads.push(quad(shapeNode, SH_DESCRIPTION, literal(desc.note)));
		}

		// sh:closed + sh:ignoredProperties
		if (desc.closed === true) {
			quads.push(quad(shapeNode, SH_CLOSED, literal('true', XSD_BOOLEAN)));
			const rdfTypeList = buildRdfList([RDF_TYPE], quads);
			quads.push(quad(shapeNode, SH_IGNORED_PROPERTIES, rdfTypeList));
		}

		// Property shapes from statements
		if (!desc.statements) continue;

		for (const stmt of desc.statements) {
			buildPropertyShape(shapeNode, stmt, namespaces, base, quads, warnings);
		}
	}

	return quads;
}

// ── Public API ──────────────────────────────────────────────────

/**
 * Generates a SHACL shapes graph string from a `TapirProject`.
 *
 * Builds SHACL quads from the project and serializes them using
 * N3.Writer. Defaults to Turtle format. CURIEs resolve through
 * `{ ...STANDARD_PREFIXES, ...project.namespaces }`; the output
 * declares every prefix actually used.
 *
 * @param project - The Tapir project to export.
 * @param format - RDF serialization format (defaults to `'turtle'`).
 * @param warnings - Optional accumulator for lossy-mapping warnings.
 * @returns A promise resolving to the serialized SHACL string.
 *
 * @example
 * const turtle = await buildShacl(project);
 * console.log(turtle);
 *
 * @example
 * const ntriples = await buildShacl(project, 'ntriples');
 */
export function buildShacl(
	project: TapirProject,
	format: RdfFormat = 'turtle',
	warnings?: GeneratorWarning[]
): Promise<string> {
	const namespaces: NamespaceMap = buildResolutionMap(project, { sh: SH });
	const base = project.base || '';

	const quads = buildShaclQuads(project, namespaces, base, warnings);

	return new Promise((resolve, reject) => {
		const n3Format = N3_FORMAT_MAP[format] || 'Turtle';
		const writer = new N3.Writer({
			format: n3Format,
			prefixes: collectUsedPrefixes(quads, namespaces),
		});

		for (const q of quads) {
			writer.addQuad(q);
		}

		writer.end((error: Error | null, result: string) => {
			if (error) return reject(error);
			resolve(result);
		});
	});
}
