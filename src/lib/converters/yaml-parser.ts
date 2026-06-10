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
 *         datatype: <string> | [<string>, ...]
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
	max?: number | null;
	/** Cardinality keyword (e.g. SimpleDSP `推奨`/recommended). */
	cardinalityNote?: string;
	type?: string;
	/** Datatype(s). Accepts scalar or array — legacy single-datatype
	 * YAML emits a string; multi-datatype emits a sequence. */
	datatype?: string | string[];
	/** Shape reference(s). Scalar or array in YAML. */
	description?: string | string[];
	/** Class constraint(s) on the value node. Scalar or array in YAML. */
	a?: string | string[];
	/** Vocabulary scheme constraint(s). Scalar or array in YAML. */
	inScheme?: string | string[];
	/** Language tag constraint(s) — DCTAP `languageTag` extension. */
	languageTag?: string | string[];
	values?: string[];
	pattern?: string;
	note?: string;
	facets?: Record<string, number>;
	/** Data-mapping block — not modelled by Tapir (loss warning). */
	mapping?: unknown;
}

/** Raw YAMA description as parsed from YAML. */
interface RawYamaDescription {
	a?: string;
	label?: string;
	note?: string;
	closed?: boolean;
	id?: { prefix?: string };
	statements?: Record<string, RawYamaStatement>;
	/** Data-mapping block — not modelled by Tapir (loss warning). */
	mapping?: unknown;
}

/** Raw YAMA document as parsed from YAML. */
interface RawYamaDocument {
	base?: string;
	namespaces?: Record<string, string>;
	descriptions?: Record<string, RawYamaDescription>;
	/** Mapping defaults — not modelled by Tapir (loss warning). */
	defaults?: unknown;
	/** Inline data records — not modelled by Tapir (loss warning). */
	data?: unknown;
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

	// languageTag (DCTAP extension) rides in `values` with the
	// constraintType marker, mirroring the DCTAP importer.
	const languageTags = toStringArray(raw.languageTag);

	const stmt = createStatement({
		id: key,
		label: raw.label || '',
		propertyId: raw.property || '',
		cardinalityNote: typeof raw.cardinalityNote === 'string' ? raw.cardinalityNote : '',
		valueType: resolveValueType(raw.type),
		datatype: toStringArray(raw.datatype),
		values: languageTags.length > 0 ? languageTags : Array.isArray(raw.values) ? raw.values : [],
		constraintType: languageTags.length > 0 ? 'languageTag' : '',
		pattern: raw.pattern || '',
		shapeRefs: toStringArray(raw.description),
		classConstraint: toStringArray(raw.a),
		inScheme: toStringArray(raw.inScheme),
		note: raw.note || '',
		facets,
	});
	// min/max: keep absent fields absent (undefined = unspecified);
	// an explicit `max: null` would be unusual YAML but reads as
	// unbounded, matching the internal model.
	if (raw.min !== undefined && raw.min !== null) stmt.min = raw.min;
	if (raw.max !== undefined) stmt.max = raw.max;
	return stmt;
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

	// Deferred YAMAML features — warn instead of dropping silently.
	if (doc.defaults !== undefined) {
		warnings.push({
			field: 'defaults',
			message: "The 'defaults:' block (mapping defaults) is not supported by Tapir and was dropped",
		});
	}
	if (doc.data !== undefined) {
		warnings.push({
			field: 'data',
			message: "The 'data:' block (inline records) is not supported by Tapir and was dropped",
		});
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
		if (descDef.mapping !== undefined) {
			warnings.push({
				field: descName,
				message: `Description "${descName}": 'mapping:' blocks (RDF generation) are not supported by Tapir and were dropped`,
			});
		}
		for (const [stmtKey, stmtDef] of Object.entries(descDef.statements || {})) {
			if (stmtDef && typeof stmtDef === 'object' && stmtDef.mapping !== undefined) {
				warnings.push({
					field: `${descName}.${stmtKey}`,
					message: `Statement "${stmtKey}" in "${descName}": 'mapping:' blocks are not supported by Tapir and were dropped`,
				});
			}
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
