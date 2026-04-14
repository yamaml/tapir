/**
 * @fileoverview YAMA JSON generator.
 *
 * Converts a `TapirProject` to a YAMA-format JSON string.
 * The JSON structure mirrors the YAMA YAML format — descriptions
 * are keyed by name and statements are keyed by their ID.
 *
 * @module converters/json-generator
 */

import type { TapirProject, Description, Statement, FacetName } from '$lib/types';

// ── Value Type Resolution ───────────────────────────────────────

/**
 * Converts Tapir `ValueType` to the YAMA `type` string.
 *
 * @param valueType - The Tapir value type.
 * @returns The YAMA type string, or undefined if empty.
 */
function resolveYamaType(valueType: string): string | undefined {
	if (valueType === 'iri') return 'IRI';
	if (valueType === 'literal') return 'literal';
	if (valueType === 'bnode') return 'BNODE';
	return undefined;
}

// ── Facet Keys ──────────────────────────────────────────────────

/** Facet names that may be present. */
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

// ── Statement Serializer ────────────────────────────────────────

/**
 * Converts a Tapir `Statement` to a YAMA statement object.
 *
 * @param stmt - The Tapir statement.
 * @returns A plain object for JSON serialization.
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
	if (Array.isArray(stmt.shapeRefs) && stmt.shapeRefs.length > 0) {
		obj.description = stmt.shapeRefs.length === 1 ? stmt.shapeRefs[0] : stmt.shapeRefs;
	}

	if (Array.isArray(stmt.values) && stmt.values.length > 0) {
		obj.values = stmt.values;
	}

	if (stmt.pattern) obj.pattern = stmt.pattern;
	if (stmt.note) obj.note = stmt.note;

	// Facets
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
 * @returns A plain object for JSON serialization.
 */
function serializeDescription(desc: Description): Record<string, unknown> {
	const obj: Record<string, unknown> = {};

	if (desc.targetClass) obj.a = desc.targetClass;
	if (desc.label) obj.label = desc.label;
	if (desc.note) obj.note = desc.note;
	if (desc.idPrefix) {
		obj.id = { prefix: desc.idPrefix };
	}

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
 * Generates a YAMA-format JSON string from a `TapirProject`.
 *
 * @param project - The Tapir project to export.
 * @param indent - JSON indentation (defaults to 2 spaces).
 * @returns YAMA JSON string.
 *
 * @example
 * const json = buildYamaJson(project);
 * console.log(json);
 */
export function buildYamaJson(project: TapirProject, indent: number = 2): string {
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

	return JSON.stringify(doc, null, indent);
}
