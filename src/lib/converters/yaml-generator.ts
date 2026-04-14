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
 * @param valueType - The Tapir value type.
 * @returns The YAMA type string, or undefined if not applicable.
 */
function resolveYamaType(valueType: string): string | undefined {
	if (valueType === 'iri') return 'IRI';
	if (valueType === 'literal') return 'literal';
	if (valueType === 'bnode') return 'BNODE';
	return undefined;
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

	const yamaType = resolveYamaType(stmt.valueType);
	if (yamaType) obj.type = yamaType;

	if (stmt.datatype) obj.datatype = stmt.datatype;
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

	if (Array.isArray(stmt.values) && stmt.values.length > 0) {
		obj.values = stmt.values;
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

	return yamlStringify(doc, {
		indent: 2,
		lineWidth: 0,
		defaultKeyType: 'PLAIN',
		defaultStringType: 'PLAIN',
	});
}
