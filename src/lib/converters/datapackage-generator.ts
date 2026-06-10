/**
 * @fileoverview Frictionless Data Package generator.
 *
 * Translates a `TapirProject` into a Frictionless Data Package
 * descriptor (`datapackage.json`). Maps YAMA application profile
 * concepts to Data Package resources, fields, and constraints.
 *
 * **Scope note — this is a schema-skeleton export.** YAMAML spec §7.7
 * derives resources from *data sources* (`data:`/`mapping:` blocks):
 * resource paths, field names from `mapping.path`, and `primaryKey`
 * from the id mapping. Tapir profiles carry no data mappings, so this
 * export deliberately diverges from §7.7: it emits one table resource
 * per description with `propertyId`-derived field names and no
 * `path`/`primaryKey`. Use yama-cli for spec-§7.7 packages when a
 * profile has data mappings.
 *
 * Tapir-to-Data Package mapping:
 *
 * | Tapir element            | Data Package                          |
 * |--------------------------|---------------------------------------|
 * | TapirProject             | Package                               |
 * | project.base             | `id`                                  |
 * | Description              | Resource                              |
 * | Description.label        | Resource `title`                      |
 * | Description.note         | Resource `description`                |
 * | Statement.propertyId     | Field `name`                          |
 * | Statement.label          | Field `title`                         |
 * | Statement.note           | Field `description`                   |
 * | Statement.datatype       | Field `type` (XSD mapping)            |
 * | Statement.valueType iri  | Field `type: "string"`, `format: "uri"`|
 * | Statement.min >= 1       | Field constraint `required: true`     |
 * | Statement.pattern        | Field constraint `pattern`            |
 * | Statement.values         | Field constraint `enum`               |
 * | Statement.facets         | Field constraints `minimum`/`maximum` |
 *
 * Ported from yama-cli `src/modules/datapackage.js`.
 *
 * @module converters/datapackage-generator
 * @see https://datapackage.org
 */

import type { TapirProject, Description, Statement } from '$lib/types';
import type { GeneratorWarning } from '$lib/types/export';

// ── XSD-to-Frictionless Type Mapping ────────────────────────────

/** Maps XSD datatype local names to Frictionless field type and format. */
const XSD_TYPE_MAP: Record<string, { type: string; format?: string }> = {
	string: { type: 'string' },
	integer: { type: 'integer' },
	int: { type: 'integer' },
	long: { type: 'integer' },
	short: { type: 'integer' },
	byte: { type: 'integer' },
	decimal: { type: 'number' },
	float: { type: 'number' },
	double: { type: 'number' },
	boolean: { type: 'boolean' },
	date: { type: 'date' },
	dateTime: { type: 'datetime' },
	time: { type: 'time' },
	gYear: { type: 'year' },
	gYearMonth: { type: 'yearmonth' },
	duration: { type: 'duration' },
	anyURI: { type: 'string', format: 'uri' },
	base64Binary: { type: 'string', format: 'binary' },
};

// ── Type Resolution ─────────────────────────────────────────────

/**
 * Resolves a statement's type information to a Frictionless field
 * type descriptor.
 *
 * Resolution order:
 *   1. If `datatype` is declared, use the XSD mapping.
 *   2. If `valueType` is `iri`, return `string` with `format: "uri"`.
 *   3. Default to `string`.
 *
 * @param stmt - The statement to resolve.
 * @returns An object with `type` and optionally `format`.
 */
function resolveFieldType(
	stmt: Statement,
	warnings?: GeneratorWarning[]
): { type: string; format?: string } {
	// Frictionless permits one type per field; for multi-datatype, the
	// first is emitted and the truncation is reported as a warning.
	const datatypes = stmt.datatype ?? [];
	if (datatypes.length > 1) {
		warnings?.push({
			message: `Field "${stmt.propertyId || stmt.id}": Frictionless allows one type per field — kept "${datatypes[0]}", dropped ${datatypes
				.slice(1)
				.map((d) => `"${d}"`)
				.join(', ')}`,
		});
	}
	const first = datatypes[0];
	if (first) {
		const local = first.includes(':') ? first.split(':').pop()! : first;
		const mapped = XSD_TYPE_MAP[local];
		if (mapped) return { ...mapped };
	}

	if (stmt.valueType === 'iri') {
		return { type: 'string', format: 'uri' };
	}

	return { type: 'string' };
}

// ── Constraint Builder ──────────────────────────────────────────

/** Frictionless field constraints. */
interface FieldConstraints {
	required?: boolean;
	enum?: string[];
	pattern?: string;
	minimum?: number;
	maximum?: number;
	minLength?: number;
	maxLength?: number;
}

/**
 * Builds a Frictionless constraints object from a statement.
 *
 * @param stmt - The statement to extract constraints from.
 * @returns Constraints object, or null if none apply.
 */
function buildConstraints(stmt: Statement): FieldConstraints | null {
	const constraints: FieldConstraints = {};

	// required: min >= 1 means the field cannot be empty
	if (stmt.min != null && stmt.min >= 1) {
		constraints.required = true;
	}

	// enum from values list
	if (Array.isArray(stmt.values) && stmt.values.length > 0) {
		constraints.enum = stmt.values;
	}

	// pattern
	if (stmt.pattern) {
		constraints.pattern = stmt.pattern;
	}

	// Numeric facets
	if (stmt.facets) {
		if (stmt.facets.MinInclusive != null) {
			constraints.minimum = stmt.facets.MinInclusive;
		}
		if (stmt.facets.MaxInclusive != null) {
			constraints.maximum = stmt.facets.MaxInclusive;
		}
		if (stmt.facets.MinLength != null) {
			constraints.minLength = stmt.facets.MinLength;
		}
		if (stmt.facets.MaxLength != null) {
			constraints.maxLength = stmt.facets.MaxLength;
		}
	}

	return Object.keys(constraints).length > 0 ? constraints : null;
}

// ── Field Builder ───────────────────────────────────────────────

/** A Frictionless field descriptor. */
interface DataPackageField {
	name: string;
	type: string;
	format?: string;
	title?: string;
	description?: string;
	constraints?: FieldConstraints;
}

/**
 * Converts a statement to a Frictionless field descriptor.
 *
 * @param stmt - The statement to convert.
 * @param warnings - Optional accumulator for lossy-mapping warnings.
 * @returns A field descriptor.
 */
function buildField(stmt: Statement, warnings?: GeneratorWarning[]): DataPackageField {
	const fieldType = resolveFieldType(stmt, warnings);
	const field: DataPackageField = {
		name: stmt.propertyId || stmt.id,
		type: fieldType.type,
	};

	if (fieldType.format) {
		field.format = fieldType.format;
	}

	if (stmt.label) {
		field.title = stmt.label;
	}

	if (stmt.note) {
		field.description = stmt.note;
	}

	const constraints = buildConstraints(stmt);
	if (constraints) {
		field.constraints = constraints;
	}

	return field;
}

// ── Resource Builder ────────────────────────────────────────────

/** A Frictionless resource descriptor. */
interface DataPackageResource {
	name: string;
	type: string;
	schema: {
		fields: DataPackageField[];
	};
	title?: string;
	description?: string;
}

/**
 * Normalises a description name to the Frictionless resource-name
 * pattern: lowercase alphanumerics plus `.`, `_`, `-`. Characters
 * outside the set (CJK, spaces, etc.) become hyphens; an empty result
 * falls back to `resource`.
 *
 * @param name - The raw description name (e.g. `MAIN`, `著作`).
 * @returns A pattern-conforming resource name.
 */
export function normaliseResourceName(name: string): string {
	const normalised = name
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, '-')
		.replace(/^[-.]+|[-.]+$/g, '');
	return normalised || 'resource';
}

/**
 * Converts a description to a Frictionless resource descriptor.
 *
 * Each Description becomes one resource with its statements as fields.
 *
 * @param desc - The description to convert.
 * @param name - The (normalised, de-duplicated) resource name.
 * @param warnings - Optional accumulator for lossy-mapping warnings.
 * @returns A resource descriptor.
 */
function buildResource(
	desc: Description,
	name: string,
	warnings?: GeneratorWarning[]
): DataPackageResource {
	const resource: DataPackageResource = {
		name,
		type: 'table',
		schema: {
			fields: [],
		},
	};

	if (desc.label) {
		resource.title = desc.label;
	}

	if (desc.note) {
		resource.description = desc.note;
	}

	for (const stmt of desc.statements) {
		resource.schema.fields.push(buildField(stmt, warnings));
	}

	return resource;
}

// ── Package Builder ─────────────────────────────────────────────

/** A Frictionless Data Package descriptor. */
interface DataPackageDescriptor {
	id?: string;
	resources: DataPackageResource[];
}

/**
 * Builds a Frictionless Data Package descriptor from a `TapirProject`.
 *
 * Each description in the project becomes a resource. Resource names
 * are normalised to the Frictionless name pattern and de-duplicated
 * with a numeric suffix; the project's base IRI is used as the
 * package `id`.
 *
 * @param project - The Tapir project to export.
 * @param warnings - Optional accumulator for lossy-mapping warnings
 *   (multi-datatype truncation, renamed resources).
 * @returns A Data Package descriptor (JSON-serializable).
 *
 * @example
 * const pkg = buildDataPackageObject(project);
 * console.log(JSON.stringify(pkg, null, 2));
 */
export function buildDataPackageObject(
	project: TapirProject,
	warnings?: GeneratorWarning[]
): DataPackageDescriptor {
	const pkg: DataPackageDescriptor = {
		resources: [],
	};

	if (project.base) {
		pkg.id = project.base;
	}

	const usedNames = new Set<string>();
	for (const desc of project.descriptions) {
		let name = normaliseResourceName(desc.name);
		if (name !== desc.name) {
			warnings?.push({
				message: `Resource name "${desc.name}" was normalised to "${name}" (Frictionless names allow lowercase alphanumerics plus ._-)`,
			});
		}
		if (usedNames.has(name)) {
			let n = 2;
			while (usedNames.has(`${name}-${n}`)) n++;
			name = `${name}-${n}`;
		}
		usedNames.add(name);
		pkg.resources.push(buildResource(desc, name, warnings));
	}

	return pkg;
}

// ── Main Generator ──────────────────────────────────────────────

/**
 * Generates a Frictionless Data Package JSON string from a `TapirProject`.
 *
 * @param project - The Tapir project to export.
 * @param indent - JSON indentation (defaults to 2 spaces).
 * @param warnings - Optional accumulator for lossy-mapping warnings.
 * @returns Data Package JSON string.
 *
 * @example
 * const json = buildDataPackage(project);
 * console.log(json);
 */
export function buildDataPackage(
	project: TapirProject,
	indent: number = 2,
	warnings?: GeneratorWarning[]
): string {
	const pkg = buildDataPackageObject(project, warnings);
	return JSON.stringify(pkg, null, indent);
}
