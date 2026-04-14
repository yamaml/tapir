/**
 * @fileoverview YAMA YAML parser.
 *
 * Parses a YAMA YAML string into a `TapirProject`. The YAMA YAML
 * format is a human-friendly markup for metadata application profiles.
 *
 * YAMA YAML structure:
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
 *     closed: <boolean>
 *     statements:
 *       stmtKey:
 *         property: <prefixed>
 *         label: <string>
 *         min: <number>
 *         max: <number>
 *         type: <string>
 *         datatype: <string>
 *         description: <name>
 *         a: <class> | [<class>, ...]
 *         inScheme: <scheme> | [<scheme>, ...]
 *         values: [...]
 *         pattern: <string>
 *         note: <string>
 * ```
 *
 * ## Deferred YAMAML features
 *
 * These YAMAML features are supported by the yama-cli but are not yet in
 * Tapir's data model. Profiles using them round-trip with a loss warning:
 *
 * - `defaults:` block (shared mapping defaults across statements)
 * - `data:` inline records (inline data for mapping, as an alternative to
 *   external CSV/JSON files)
 * - `mapping:` blocks on descriptions and statements (RDF generation from
 *   tabular data — Tapir is an editor, not a data-mapping pipeline)
 *
 * The `URI` value type is normalized to `iri` on parse and emitted as `IRI`.
 *
 * @module converters/yaml-parser
 */

import { parse as yamlParse } from 'yaml';
import type {
	TapirProject,
	Flavor,
	Description,
	Statement,
	NamespaceMap,
	ValueType,
	FacetMap,
} from '$lib/types';
import type { ParseResult, ParseMessage } from '$lib/types/export';
import { createProject, createDescription, createStatement } from '$lib/types/profile';

// ── Raw YAMA Types ──────────────────────────────────────────────

/** Raw YAMA statement as parsed from YAML. */
interface RawYamaStatement {
	property?: string;
	label?: string;
	min?: number;
	max?: number;
	type?: string;
	datatype?: string;
	/** Shape reference(s). Scalar or array in YAML. */
	description?: string | string[];
	/** Class constraint(s) on the value node. Scalar or array in YAML. */
	a?: string | string[];
	/** Vocabulary scheme constraint(s). Scalar or array in YAML. */
	inScheme?: string | string[];
	values?: string[];
	pattern?: string;
	note?: string;
	facets?: Record<string, number>;
}

/** Raw YAMA description as parsed from YAML. */
interface RawYamaDescription {
	a?: string;
	label?: string;
	note?: string;
	closed?: boolean;
	id?: { prefix?: string };
	statements?: Record<string, RawYamaStatement>;
}

/** Raw YAMA document as parsed from YAML. */
interface RawYamaDocument {
	base?: string;
	namespaces?: Record<string, string>;
	descriptions?: Record<string, RawYamaDescription>;
}

// ── Value Type Resolution ───────────────────────────────────────

/**
 * Resolves a YAMA `type` string to the Tapir `ValueType`.
 *
 * @param type - The YAMA type string (e.g. "IRI", "literal", "BNODE").
 * @returns The corresponding Tapir `ValueType`.
 */
function resolveValueType(type: string | undefined): ValueType {
	if (!type) return '';
	const upper = type.toUpperCase();
	if (upper === 'IRI' || upper === 'URI') return 'iri';
	if (upper === 'LITERAL') return 'literal';
	if (upper === 'BNODE') return 'bnode';
	return '';
}

/**
 * Normalizes a scalar-or-array YAML field into a string array.
 * Filters out empty strings and non-string entries.
 *
 * @param raw - Scalar string, array of strings, or undefined.
 * @returns Array of non-empty strings.
 */
function toStringArray(raw: string | string[] | undefined): string[] {
	if (!raw) return [];
	if (Array.isArray(raw)) {
		return raw.filter((v): v is string => typeof v === 'string' && v.length > 0);
	}
	return typeof raw === 'string' && raw.length > 0 ? [raw] : [];
}

// ── Statement Converter ─────────────────────────────────────────

/**
 * Converts a raw YAMA statement into a Tapir `Statement`.
 *
 * @param key - The statement key (used as the statement ID).
 * @param raw - The raw YAMA statement definition.
 * @returns A Tapir `Statement`.
 */
function convertStatement(key: string, raw: RawYamaStatement): Statement {
	const facets: FacetMap = {};
	if (raw.facets) {
		for (const [name, value] of Object.entries(raw.facets)) {
			facets[name as keyof FacetMap] = value;
		}
	}

	return createStatement({
		id: key,
		label: raw.label || '',
		propertyId: raw.property || '',
		min: raw.min ?? null,
		max: raw.max ?? null,
		valueType: resolveValueType(raw.type),
		datatype: raw.datatype || '',
		values: Array.isArray(raw.values) ? raw.values : [],
		pattern: raw.pattern || '',
		shapeRefs: toStringArray(raw.description),
		classConstraint: toStringArray(raw.a),
		inScheme: toStringArray(raw.inScheme),
		note: raw.note || '',
		facets,
	});
}

// ── Description Converter ───────────────────────────────────────

/**
 * Converts a raw YAMA description into a Tapir `Description`.
 *
 * @param name - The description key (used as the description name).
 * @param raw - The raw YAMA description definition.
 * @returns A Tapir `Description`.
 */
function convertDescription(name: string, raw: RawYamaDescription): Description {
	const statements: Statement[] = [];

	if (raw.statements) {
		for (const [stmtKey, stmtDef] of Object.entries(raw.statements)) {
			statements.push(convertStatement(stmtKey, stmtDef));
		}
	}

	return createDescription({
		name,
		label: raw.label || '',
		targetClass: raw.a || '',
		idPrefix: raw.id?.prefix || '',
		note: raw.note || '',
		closed: raw.closed === true,
		statements,
	});
}

// ── Main Parser ─────────────────────────────────────────────────

/**
 * Parses a YAMA YAML string into a `TapirProject`.
 *
 * @param text - The raw YAMA YAML string.
 * @param projectName - Optional project name (defaults to `'Imported YAML'`).
 * @returns A `ParseResult` containing the project, warnings, and errors.
 *
 * @example
 * const result = parseYamaYaml(yamlString);
 * if (result.errors.length === 0) {
 *   console.log(result.data.descriptions.length);
 * }
 */
export function parseYamaYaml(
	text: string,
	projectName: string = 'Imported YAML',
	flavor: Flavor = 'simpledsp'
): ParseResult<TapirProject> {
	const warnings: ParseMessage[] = [];
	const errors: ParseMessage[] = [];

	// Parse YAML
	let doc: RawYamaDocument;
	try {
		doc = yamlParse(text) as RawYamaDocument;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		errors.push({ message: `YAML parse error: ${message}` });
		return {
			data: createProject({ name: projectName, flavor }),
			warnings,
			errors,
		};
	}

	if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
		errors.push({ message: 'Input is not a valid YAMA document (expected a YAML mapping)' });
		return {
			data: createProject({ name: projectName, flavor }),
			warnings,
			errors,
		};
	}

	// Extract top-level fields
	const base = doc.base || '';
	const namespaces: NamespaceMap = doc.namespaces || {};

	// Convert descriptions
	const descriptions: Description[] = [];
	const rawDescriptions = doc.descriptions || {};

	if (Object.keys(rawDescriptions).length === 0) {
		warnings.push({ message: 'No descriptions found in YAMA document' });
	}

	for (const [descName, descDef] of Object.entries(rawDescriptions)) {
		if (!descDef || typeof descDef !== 'object') {
			warnings.push({
				field: descName,
				message: `Description "${descName}" is not a valid mapping — skipped`,
			});
			continue;
		}
		descriptions.push(convertDescription(descName, descDef));
	}

	const project = createProject({
		name: projectName,
		flavor,
		base,
		namespaces,
		descriptions,
	});

	return { data: project, warnings, errors };
}
