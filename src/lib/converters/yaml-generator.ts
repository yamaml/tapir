/**
 * @fileoverview YAMA YAML generator.
 *
 * Converts a `TapirProject` back to YAMA YAML format. Reverse of
 * `yaml-parser.ts`.
 *
 * Output structure:
 *
 * ```yaml
 * base: <IRI>
 * namespaces:
 *   prefix: <URI>
 * descriptions:
 *   descName:
 *     a: <class>
 *     label: <string>
 *     note: <string>
 *     statements:
 *       stmtKey:
 *         property: <prefixed>
 *         ...
 * ```
 *
 * @module converters/yaml-generator
 */

import { stringify as yamlStringify } from 'yaml';
import type { TapirProject, Description, Statement, FacetName } from '$lib/types';

// ── Value Type Resolution ───────────────────────────────────────

/**
 * Converts Tapir `ValueType` back to the YAMA `type` string.
 *
 * @param valueTypes - The Tapir value types.
 * @returns The YAMA type tokens (empty when none applicable).
 */
function resolveYamaTypes(valueTypes: readonly string[]): string[] {
	const out: string[] = [];
	for (const vt of valueTypes) {
		if (vt === 'iri') out.push('IRI');
		else if (vt === 'literal') out.push('literal');
		else if (vt === 'bnode') out.push('BNODE');
	}
	return out;
}

// ── Statement Serializer ────────────────────────────────────────

/** YAMA facet names that may be present. */
const FACET_KEYS: FacetName[] = [
	'MinInclusive',
	'MaxInclusive',
	'MinExclusive',
	'MaxExclusive',
	'TotalDigits',
	'FractionDigits',
	'MinLength',
	'MaxLength',
	'Length',
];

/**
 * Converts a Tapir `Statement` to a YAMA statement object.
 *
 * Only includes fields that have non-default values to keep the
 * output clean and human-readable.
 *
 * @param stmt - The Tapir statement.
 * @returns A plain object suitable for YAML serialization.
 */
function serializeStatement(stmt: Statement): Record<string, unknown> {
	const obj: Record<string, unknown> = {};

	if (stmt.propertyId) obj.property = stmt.propertyId;
	if (stmt.label) obj.label = stmt.label;
	if (stmt.min != null) obj.min = stmt.min;
	if (stmt.max != null) obj.max = stmt.max;
	// Cardinality keyword (e.g. SimpleDSP 推奨) — without this the
	// keyword dies passing through the canonical YAML format.
	if (stmt.cardinalityNote) obj.cardinalityNote = stmt.cardinalityNote;

	// Value node type(s). Scalar when single, array when multiple — same
	// scalar-or-array convention as `description`/`a`/`inScheme`.
	const yamaTypes = resolveYamaTypes(stmt.valueType);
	if (yamaTypes.length > 0) obj.type = yamaTypes.length === 1 ? yamaTypes[0] : yamaTypes;

	// Datatype(s). Multi-datatype is endorsed by SimpleDSP and used by
	// DCMI SRAP; YAMAML serialises as a YAML sequence even for a single
	// value so consumers can rely on a uniform shape.
	if (Array.isArray(stmt.datatype) && stmt.datatype.length > 0) {
		obj.datatype = [...stmt.datatype];
	}
	// YAMAML `description` = shape reference(s). Scalar when single, array
	// when multiple — same scalar-or-array convention as `a` and `inScheme`.
	if (Array.isArray(stmt.shapeRefs) && stmt.shapeRefs.length > 0) {
		obj.description = stmt.shapeRefs.length === 1 ? stmt.shapeRefs[0] : stmt.shapeRefs;
	}

	// YAMAML `a` field = class constraint(s). Emit scalar when exactly one
	// class is specified, array when multiple. Matches yama-cli semantics.
	if (Array.isArray(stmt.classConstraint) && stmt.classConstraint.length > 0) {
		obj.a = stmt.classConstraint.length === 1 ? stmt.classConstraint[0] : stmt.classConstraint;
	}

	// YAMAML `inScheme` = vocabulary scheme constraint(s). Same scalar-or-array
	// shape as `a`.
	if (Array.isArray(stmt.inScheme) && stmt.inScheme.length > 0) {
		obj.inScheme = stmt.inScheme.length === 1 ? stmt.inScheme[0] : stmt.inScheme;
	}

	// Language-tag constraints (DCTAP extension) ride in `values` with
	// the `languageTag` constraintType marker; serialise them under a
	// dedicated `languageTag` key (scalar-or-array) so they survive the
	// canonical format, mirroring yama-cli.
	if (Array.isArray(stmt.values) && stmt.values.length > 0) {
		if ((stmt.constraintType || '').toLowerCase() === 'languagetag') {
			obj.languageTag = stmt.values.length === 1 ? stmt.values[0] : stmt.values;
		} else {
			obj.values = stmt.values;
		}
	}

	if (stmt.pattern) obj.pattern = stmt.pattern;
	if (stmt.note) obj.note = stmt.note;

	// Facets (only include non-empty)
	if (stmt.facets) {
		const facetObj: Record<string, number> = {};
		let hasFacets = false;
		for (const key of FACET_KEYS) {
			if (stmt.facets[key] != null) {
				facetObj[key] = stmt.facets[key]!;
				hasFacets = true;
			}
		}
		if (hasFacets) obj.facets = facetObj;
	}

	return obj;
}

// ── Description Serializer ──────────────────────────────────────

/**
 * Converts a Tapir `Description` to a YAMA description object.
 *
 * @param desc - The Tapir description.
 * @returns A plain object suitable for YAML serialization.
 */
function serializeDescription(desc: Description): Record<string, unknown> {
	const obj: Record<string, unknown> = {};

	if (desc.targetClass) obj.a = desc.targetClass;
	if (desc.label) obj.label = desc.label;
	if (desc.note) obj.note = desc.note;
	if (desc.idPrefix) {
		obj.id = { prefix: desc.idPrefix };
	}
	// Closed shapes: only serialize when true (false is the default).
	if (desc.closed) obj.closed = true;

	if (desc.statements.length > 0) {
		const stmts: Record<string, unknown> = {};
		for (const stmt of desc.statements) {
			stmts[stmt.id] = serializeStatement(stmt);
		}
		obj.statements = stmts;
	}

	return obj;
}

// ── Main Generator ──────────────────────────────────────────────

/**
 * Builds the YAMA document object for a `TapirProject` — the shared
 * structure behind both the YAML and JSON exports. Keeping a single
 * builder guarantees the two formats never diverge in field coverage.
 *
 * @param project - The Tapir project to serialize.
 * @returns A plain object mirroring the YAMA YAML document layout.
 *
 * @example
 * const doc = buildYamaDocumentObject(project);
 * JSON.stringify(doc, null, 2);
 */
export function buildYamaDocumentObject(project: TapirProject): Record<string, unknown> {
	const doc: Record<string, unknown> = {};

	if (project.base) {
		doc.base = project.base;
	}

	// Namespaces
	if (Object.keys(project.namespaces).length > 0) {
		doc.namespaces = { ...project.namespaces };
	}

	// Descriptions
	const descriptions = project.descriptions || [];
	if (descriptions.length > 0) {
		const descs: Record<string, unknown> = {};
		for (const desc of descriptions) {
			descs[desc.name] = serializeDescription(desc);
		}
		doc.descriptions = descs;
	}

	return doc;
}

/**
 * Generates YAMA YAML output from a `TapirProject`.
 *
 * @param project - The Tapir project to export.
 * @returns YAMA YAML string.
 *
 * @example
 * const yaml = buildYamaYaml(project);
 * console.log(yaml);
 */
export function buildYamaYaml(project: TapirProject): string {
	return yamlStringify(buildYamaDocumentObject(project), {
		indent: 2,
		lineWidth: 0,
		defaultKeyType: 'PLAIN',
		defaultStringType: 'PLAIN',
	});
}
