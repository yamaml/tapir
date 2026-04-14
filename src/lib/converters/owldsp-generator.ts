/**
 * @fileoverview OWL-DSP (Description Set Profile as OWL) generator.
 *
 * Generates an OWL-DSP graph from a `TapirProject` and serializes it
 * as an RDF string using N3.js.
 *
 * Tapir → OWL-DSP mapping:
 *
 * | Tapir element              | OWL-DSP property                       |
 * |----------------------------|----------------------------------------|
 * | Description                | dsp:DescriptionTemplate (OWL class)    |
 * | Description.targetClass    | dsp:resourceClass                      |
 * | Description.label          | rdfs:label                             |
 * | Description.note           | rdfs:comment                           |
 * | Description.idPrefix       | dsp:valueURIOccurrence "mandatory"     |
 * | Statement                  | dsp:StatementTemplate (OWL restriction)|
 * | Statement.propertyId       | owl:onProperty                         |
 * | Statement.label            | rdfs:label                             |
 * | Statement.note             | rdfs:comment                           |
 * | Statement.min === max      | owl:qualifiedCardinality               |
 * | Statement.min              | owl:minQualifiedCardinality            |
 * | Statement.max              | owl:maxQualifiedCardinality            |
 * | Statement.cardinalityNote  | dsp:cardinalityNote                    |
 * | Statement.datatype         | owl:onDataRange                        |
 * | Statement.shapeRefs (single) | owl:onClass (to description IRI)       |
 * | Statement.shapeRefs (many)   | owl:onClass [owl:unionOf ( ... )]      |
 * | Statement.classConstraint  | owl:onClass (with owl:unionOf if >1)   |
 * | Statement.inScheme         | owl:onClass [dsp:inScheme ...]         |
 * | Statement.values (iri)     | owl:onClass [owl:oneOf (...)]          |
 * | Statement.values (literal) | owl:onDataRange [owl:oneOf (...)]      |
 *
 * Ported from yama-cli `src/modules/dsp.js`.
 *
 * @module converters/owldsp-generator
 * @see https://docs.yamaml.org/specs/owl-dsp/
 */

import type { TapirProject, Description, Statement, NamespaceMap } from '$lib/types';
import type { RdfFormat } from '$lib/types/export';
import { expandPrefixed } from '$lib/utils/iri-utils';
import { buildRdfList } from './shacl-generator';
import N3 from 'n3';

const { DataFactory } = N3;
const { namedNode, literal, blankNode, quad } = DataFactory;

// ── OWL-DSP / RDF Vocabulary Constants ──────────────────────────

const DSP = 'http://purl.org/metainfo/terms/dsp#';
const OWL = 'http://www.w3.org/2002/07/owl#';
const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const RDFS = 'http://www.w3.org/2000/01/rdf-schema#';
const XSD = 'http://www.w3.org/2001/XMLSchema#';

const RDF_TYPE = namedNode(`${RDF}type`);
const RDFS_LABEL = namedNode(`${RDFS}label`);
const RDFS_COMMENT = namedNode(`${RDFS}comment`);
const RDFS_SUBCLASS_OF = namedNode(`${RDFS}subClassOf`);

const DSP_DESCRIPTION_TEMPLATE = namedNode(`${DSP}DescriptionTemplate`);
const DSP_STATEMENT_TEMPLATE = namedNode(`${DSP}StatementTemplate`);
const DSP_RESOURCE_CLASS = namedNode(`${DSP}resourceClass`);
const DSP_VALUE_URI_OCCURRENCE = namedNode(`${DSP}valueURIOccurrence`);
const DSP_CARDINALITY_NOTE = namedNode(`${DSP}cardinalityNote`);
const DSP_IN_SCHEME = namedNode(`${DSP}inScheme`);

const OWL_ON_PROPERTY = namedNode(`${OWL}onProperty`);
const OWL_ON_CLASS = namedNode(`${OWL}onClass`);
const OWL_ON_DATA_RANGE = namedNode(`${OWL}onDataRange`);
const OWL_QUAL_CARD = namedNode(`${OWL}qualifiedCardinality`);
const OWL_MIN_QUAL_CARD = namedNode(`${OWL}minQualifiedCardinality`);
const OWL_MAX_QUAL_CARD = namedNode(`${OWL}maxQualifiedCardinality`);
const OWL_UNION_OF = namedNode(`${OWL}unionOf`);
const OWL_ONE_OF = namedNode(`${OWL}oneOf`);

const XSD_NON_NEGATIVE_INTEGER = namedNode(`${XSD}nonNegativeInteger`);

// ── N3 Format Map ───────────────────────────────────────────────

const N3_FORMAT_MAP: Record<RdfFormat, string> = {
	turtle: 'Turtle',
	ntriples: 'N-Triples',
	nquads: 'N-Quads',
	trig: 'TriG',
	jsonld: 'N-Triples',
};

// ── Statement Template Builder ──────────────────────────────────

/**
 * Builds OWL-DSP quads for a single statement template.
 *
 * Each statement becomes a `dsp:StatementTemplate` linked to its parent
 * description by `rdfs:subClassOf`. Constraints are expressed as OWL
 * restriction properties on the statement node.
 *
 * @param descName - Parent description name (for composing the stmt IRI).
 * @param stmt - The Tapir statement.
 * @param namespaces - Prefix-to-IRI map.
 * @param base - Document base IRI.
 * @param quads - Accumulator for generated quads.
 * @returns The statement template's named node.
 */
export function buildStatementTemplate(
	descName: string,
	stmt: Statement,
	namespaces: NamespaceMap,
	base: string,
	quads: N3.Quad[]
): N3.NamedNode {
	const stmtKey = stmt.label || stmt.propertyId || stmt.id;
	const safeKey = stmtKey.replace(/\s+/g, '_');
	const stmtIri = base ? `${base}${descName}-${safeKey}` : `${descName}-${safeKey}`;
	const stmtNode = namedNode(stmtIri);

	quads.push(quad(stmtNode, RDF_TYPE, DSP_STATEMENT_TEMPLATE));

	// owl:onProperty
	if (stmt.propertyId) {
		const propertyIri = expandPrefixed(stmt.propertyId, namespaces, base);
		if (propertyIri) {
			quads.push(quad(stmtNode, OWL_ON_PROPERTY, namedNode(propertyIri)));
		}
	}

	if (stmt.label) {
		quads.push(quad(stmtNode, RDFS_LABEL, literal(stmt.label)));
	}

	if (stmt.note) {
		quads.push(quad(stmtNode, RDFS_COMMENT, literal(stmt.note)));
	}

	// Cardinality: exact vs. min/max
	const { min, max } = stmt;
	if (min != null && max != null && min === max) {
		quads.push(
			quad(stmtNode, OWL_QUAL_CARD, literal(String(min), XSD_NON_NEGATIVE_INTEGER))
		);
	} else {
		if (min != null) {
			quads.push(
				quad(stmtNode, OWL_MIN_QUAL_CARD, literal(String(min), XSD_NON_NEGATIVE_INTEGER))
			);
		}
		if (max != null) {
			quads.push(
				quad(stmtNode, OWL_MAX_QUAL_CARD, literal(String(max), XSD_NON_NEGATIVE_INTEGER))
			);
		}
	}

	if (stmt.cardinalityNote) {
		quads.push(quad(stmtNode, DSP_CARDINALITY_NOTE, literal(stmt.cardinalityNote)));
	}

	// Datatype → owl:onDataRange (with owl:unionOf when multiple)
	if (stmt.datatype) {
		const datatypes = stmt.datatype.split(/\s+/).filter(Boolean);
		if (datatypes.length === 1) {
			const dtIri = expandPrefixed(datatypes[0], namespaces, base);
			if (dtIri) {
				quads.push(quad(stmtNode, OWL_ON_DATA_RANGE, namedNode(dtIri)));
			}
		} else {
			const dtNodes = datatypes
				.map((dt) => expandPrefixed(dt, namespaces, base))
				.filter((iri): iri is string => !!iri)
				.map((iri) => namedNode(iri));
			const listHead = buildRdfList(dtNodes, quads);
			const unionAnon = blankNode();
			quads.push(quad(unionAnon, OWL_UNION_OF, listHead));
			quads.push(quad(stmtNode, OWL_ON_DATA_RANGE, unionAnon));
		}
	}

	// Shape reference(s) → owl:onClass (or owl:unionOf when multiple)
	const shapeRefs = stmt.shapeRefs ?? [];
	if (shapeRefs.length === 1) {
		const refIri = base ? base + shapeRefs[0] : shapeRefs[0];
		quads.push(quad(stmtNode, OWL_ON_CLASS, namedNode(refIri)));
	} else if (shapeRefs.length > 1) {
		const refNodes = shapeRefs.map((r) => namedNode(base ? base + r : r));
		const listHead = buildRdfList(refNodes, quads);
		const unionAnon = blankNode();
		quads.push(quad(unionAnon, OWL_UNION_OF, listHead));
		quads.push(quad(stmtNode, OWL_ON_CLASS, unionAnon));
	}

	// Class constraint → owl:onClass (or unionOf)
	if (shapeRefs.length === 0 && stmt.classConstraint && stmt.classConstraint.length > 0) {
		if (stmt.classConstraint.length === 1) {
			const classIri = expandPrefixed(stmt.classConstraint[0], namespaces, base);
			if (classIri) {
				quads.push(quad(stmtNode, OWL_ON_CLASS, namedNode(classIri)));
			}
		} else {
			const classNodes = stmt.classConstraint
				.map((c) => expandPrefixed(c, namespaces, base))
				.filter((iri): iri is string => !!iri)
				.map((iri) => namedNode(iri));
			const listHead = buildRdfList(classNodes, quads);
			const unionAnon = blankNode();
			quads.push(quad(unionAnon, OWL_UNION_OF, listHead));
			quads.push(quad(stmtNode, OWL_ON_CLASS, unionAnon));
		}
	}

	// inScheme (vocabulary constraint)
	if (stmt.inScheme && stmt.inScheme.length > 0) {
		if (stmt.inScheme.length === 1) {
			const schemeIri = expandPrefixed(stmt.inScheme[0], namespaces, base);
			if (schemeIri) {
				const anon = blankNode();
				quads.push(quad(anon, DSP_IN_SCHEME, namedNode(schemeIri)));
				quads.push(quad(stmtNode, OWL_ON_CLASS, anon));
			}
		} else {
			const anonNodes: N3.BlankNode[] = [];
			for (const s of stmt.inScheme) {
				const sIri = expandPrefixed(s, namespaces, base);
				if (!sIri) continue;
				const anon = blankNode();
				quads.push(quad(anon, DSP_IN_SCHEME, namedNode(sIri)));
				anonNodes.push(anon);
			}
			if (anonNodes.length > 0) {
				const listHead = buildRdfList(anonNodes, quads);
				const unionAnon = blankNode();
				quads.push(quad(unionAnon, OWL_UNION_OF, listHead));
				quads.push(quad(stmtNode, OWL_ON_CLASS, unionAnon));
			}
		}
	}

	// Enumerated values — oneOf in either data range or class range
	if (
		Array.isArray(stmt.values) &&
		stmt.values.length > 0 &&
		(!stmt.inScheme || stmt.inScheme.length === 0)
	) {
		const isIri = stmt.valueType === 'iri';
		if (isIri) {
			const items = stmt.values
				.map((v) => expandPrefixed(String(v), namespaces, base))
				.filter((iri): iri is string => !!iri)
				.map((iri) => namedNode(iri));
			const listHead = buildRdfList(items, quads);
			const rangeNode = blankNode();
			quads.push(quad(rangeNode, OWL_ONE_OF, listHead));
			quads.push(quad(stmtNode, OWL_ON_CLASS, rangeNode));
		} else {
			const items = stmt.values.map((v) => literal(String(v)));
			const listHead = buildRdfList(items, quads);
			const rangeNode = blankNode();
			quads.push(quad(rangeNode, OWL_ONE_OF, listHead));
			quads.push(quad(stmtNode, OWL_ON_DATA_RANGE, rangeNode));
		}
	}

	return stmtNode;
}

// ── Description Template Builder ────────────────────────────────

/**
 * Builds OWL-DSP quads for a single description template.
 *
 * @param desc - The Tapir description.
 * @param namespaces - Prefix-to-IRI map.
 * @param base - Document base IRI.
 * @param quads - Accumulator.
 */
export function buildDescriptionTemplate(
	desc: Description,
	namespaces: NamespaceMap,
	base: string,
	quads: N3.Quad[]
): void {
	const descIri = base ? `${base}${desc.name}` : desc.name;
	const descNode = namedNode(descIri);

	quads.push(quad(descNode, RDF_TYPE, DSP_DESCRIPTION_TEMPLATE));

	if (desc.targetClass) {
		const classIri = expandPrefixed(desc.targetClass, namespaces, base);
		if (classIri) {
			quads.push(quad(descNode, DSP_RESOURCE_CLASS, namedNode(classIri)));
		}
	}

	// idPrefix marks this description as having mandatory resource IDs
	if (desc.idPrefix) {
		quads.push(quad(descNode, DSP_VALUE_URI_OCCURRENCE, literal('mandatory')));
	}

	if (desc.label) {
		quads.push(quad(descNode, RDFS_LABEL, literal(desc.label)));
	}

	if (desc.note) {
		quads.push(quad(descNode, RDFS_COMMENT, literal(desc.note)));
	}

	// Link each statement to the description via rdfs:subClassOf
	for (const stmt of desc.statements || []) {
		const stmtNode = buildStatementTemplate(desc.name, stmt, namespaces, base, quads);
		quads.push(quad(descNode, RDFS_SUBCLASS_OF, stmtNode));
	}
}

// ── OWL-DSP Quads Builder ───────────────────────────────────────

/**
 * Builds the complete OWL-DSP graph from a `TapirProject`.
 *
 * Each Tapir Description becomes a `dsp:DescriptionTemplate` (OWL class),
 * and each Statement becomes a `dsp:StatementTemplate` (OWL restriction)
 * linked via `rdfs:subClassOf`.
 *
 * @param project - The Tapir project.
 * @param namespaces - Prefix-to-IRI map (project namespaces + dsp).
 * @param base - Document base IRI.
 * @returns Array of N3 quads.
 */
export function buildOwlDspQuads(
	project: TapirProject,
	namespaces: NamespaceMap,
	base: string
): N3.Quad[] {
	const quads: N3.Quad[] = [];
	for (const desc of project.descriptions || []) {
		buildDescriptionTemplate(desc, namespaces, base, quads);
	}
	return quads;
}

// ── Public API ──────────────────────────────────────────────────

/**
 * Generates an OWL-DSP graph string from a `TapirProject`.
 *
 * Builds OWL-DSP quads using the `dsp:` ontology and serializes them
 * with N3.Writer. Defaults to Turtle format.
 *
 * @param project - The Tapir project to export.
 * @param format - RDF serialization format (defaults to `'turtle'`).
 * @returns A promise resolving to the serialized OWL-DSP string.
 *
 * @example
 * const turtle = await buildOwlDsp(project);
 */
export function buildOwlDsp(
	project: TapirProject,
	format: RdfFormat = 'turtle'
): Promise<string> {
	const namespaces: NamespaceMap = {
		dsp: DSP,
		rdfs: RDFS,
		owl: OWL,
		xsd: XSD,
		...(project.namespaces || {}),
	};
	const base = project.base || '';

	const quads = buildOwlDspQuads(project, namespaces, base);

	return new Promise((resolve, reject) => {
		const n3Format = N3_FORMAT_MAP[format] || 'Turtle';
		const writer = new N3.Writer({
			format: n3Format,
			prefixes: namespaces,
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
