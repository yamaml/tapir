/**
 * @fileoverview SimpleDSP text generator.
 *
 * Generates SimpleDSP tab-separated text from a `TapirProject`.
 * Supports English and Japanese header/value-type labels.
 *
 * SimpleDSP file structure:
 *   - `[@NS]`  — namespace declarations (prefix → URI, tab-separated)
 *   - `[MAIN]` — first description template
 *   - `[Name]` — additional description templates
 *
 * Ported from yama-cli `src/modules/dsp.js`.
 *
 * @module converters/simpledsp-generator
 */

import type { TapirProject, Description, Statement, NamespaceMap } from '$lib/types';

// ── Standard Prefixes ───────────────────────────────────────────

/**
 * Standard prefixes (Table 19 from the SimpleDSP spec + schema: extension).
 *
 * These are implicitly recognised and can be omitted from the `[@NS]`
 * block unless overridden with a different URI.
 */
export const STANDARD_PREFIXES: NamespaceMap = {
	dc: 'http://purl.org/dc/elements/1.1/',
	dcterms: 'http://purl.org/dc/terms/',
	foaf: 'http://xmlns.com/foaf/0.1/',
	skos: 'http://www.w3.org/2004/02/skos/core#',
	xl: 'http://www.w3.org/2008/05/skos-xl#',
	rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
	rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
	owl: 'http://www.w3.org/2002/07/owl#',
	xsd: 'http://www.w3.org/2001/XMLSchema#',
	schema: 'https://schema.org/',
};

// ── Language-specific Labels ────────────────────────────────────

/** SimpleDSP header comment lines by language. */
const SIMPLEDSP_HEADERS: Record<string, string> = {
	en: '#Name\tProperty\tMin\tMax\tValueType\tConstraint\tComment',
	jp: '#項目規則名\tプロパティ\t最小\t最大\t値タイプ\t値制約\tコメント',
};

/** Maps internal display value types to Japanese for export. */
const VALUE_TYPE_JP: Record<string, string> = {
	ID: 'ID',
	literal: '文字列',
	structured: '構造化',
	reference: '参照値',
	'': '制約なし',
};

// ── Value Type Resolution ───────────────────────────────────────

/**
 * Resolves the SimpleDSP display value type for a statement.
 *
 * Maps the Tapir flavor-neutral `valueType` plus structural fields
 * to the SimpleDSP display types:
 *
 *   - `shapeRef` present → `"structured"`
 *   - `classConstraint` present → `"structured"`
 *   - `valueType === 'iri'` → `"IRI"`
 *   - `valueType === 'literal'` or has `datatype`/`values` → `"literal"`
 *   - Otherwise → `""` (no constraint)
 *
 * @param stmt - The statement to resolve.
 * @returns The SimpleDSP value type string.
 *
 * @example
 * resolveSimpleDspValueType({ shapeRefs: ['Agent'] })  // => 'structured'
 * resolveSimpleDspValueType({ valueType: 'iri' })      // => 'IRI'
 */
export function resolveSimpleDspValueType(stmt: Statement): string {
	if (stmt.shapeRefs && stmt.shapeRefs.length > 0) return 'structured';
	if (stmt.classConstraint.length > 0) return 'structured';
	if (stmt.valueType === 'iri') return 'IRI';
	if (
		stmt.valueType === 'literal' ||
		stmt.datatype ||
		(Array.isArray(stmt.values) && stmt.values.length > 0)
	) {
		return 'literal';
	}
	return '';
}

// ── Constraint Resolution ───────────────────────────────────────

/**
 * Resolves the SimpleDSP constraint string for a statement.
 *
 * Checks fields in priority order:
 *   1. `shapeRefs` → space-separated `#Shape1 #Shape2` (first-ref only
 *      matches the SimpleDSP spec; extras are preserved as a Tapir
 *      extension and warned about at export time in the UI).
 *   2. `classConstraint` → space-separated class names
 *   3. `datatype` → datatype CURIE (e.g. `xsd:date`)
 *   4. `inScheme` → space-separated scheme URIs
 *   5. `values` with `valueType === 'iri'` → unquoted URIs
 *   6. `values` with `valueType === 'literal'` → quoted strings
 *
 * @param stmt - The statement to resolve.
 * @returns The constraint string for the SimpleDSP output.
 *
 * @example
 * resolveSimpleDspConstraint({ shapeRefs: ['Agent'] })
 * // => '#Agent'
 *
 * @example
 * resolveSimpleDspConstraint({ datatype: 'xsd:date' })
 * // => 'xsd:date'
 */
export function resolveSimpleDspConstraint(stmt: Statement): string {
	// Shape reference(s)
	if (stmt.shapeRefs && stmt.shapeRefs.length > 0) {
		return stmt.shapeRefs.map((s) => `#${s}`).join(' ');
	}

	// Class constraint
	if (stmt.classConstraint.length > 0) {
		return stmt.classConstraint.join(' ');
	}

	// Datatype
	if (stmt.datatype) {
		return stmt.datatype;
	}

	// Vocabulary scheme (inScheme)
	if (stmt.inScheme.length > 0) {
		return stmt.inScheme.join(' ');
	}

	// Value set
	if (Array.isArray(stmt.values) && stmt.values.length > 0) {
		if (stmt.valueType === 'iri') {
			return stmt.values.join(' ');
		}
		// Literal picklist: quoted strings
		return stmt.values.map((v) => `"${v}"`).join(' ');
	}

	return '';
}

// ── Generator ───────────────────────────────────────────────────

/** Generator options. */
export interface SimpleDspGeneratorOptions {
	/** Header/value-type language: `"en"` (default) or `"jp"`. */
	lang?: 'en' | 'jp';
}

/**
 * Generates SimpleDSP text output from a `TapirProject`.
 *
 * Produces a tab-separated text file with `[@NS]` namespace
 * declarations and one block per description template.
 *
 * @param project - The Tapir project to export.
 * @param opts - Generator options.
 * @returns The SimpleDSP text content.
 *
 * @example
 * const text = buildSimpleDsp(project, { lang: 'en' });
 * console.log(text);
 */
export function buildSimpleDsp(
	project: TapirProject,
	{ lang = 'en' }: SimpleDspGeneratorOptions = {}
): string {
	const namespaces = project.namespaces || {};
	const base = project.base || '';
	const descriptions = project.descriptions || [];
	const lines: string[] = [];

	// Determine which prefixes need explicit declarations.
	// Standard prefixes (Table 19) can be omitted unless overridden.
	const customNs: NamespaceMap = {};
	for (const [prefix, uri] of Object.entries(namespaces)) {
		if (STANDARD_PREFIXES[prefix] !== uri) {
			customNs[prefix] = uri;
		}
	}
	// Ensure ID prefix namespaces are included in [@NS] if non-standard
	for (const desc of descriptions) {
		if (desc.idPrefix && !STANDARD_PREFIXES[desc.idPrefix] && namespaces[desc.idPrefix]) {
			customNs[desc.idPrefix] = namespaces[desc.idPrefix];
		}
	}
	if (base) {
		customNs['@base'] = base;
	}

	// @NS block (only if custom namespaces exist)
	if (Object.keys(customNs).length > 0) {
		lines.push('[@NS]');
		for (const [prefix, uri] of Object.entries(customNs)) {
			lines.push(`${prefix}\t${uri}`);
		}
		lines.push('');
	}

	const isJp = lang === 'jp';

	for (let i = 0; i < descriptions.length; i++) {
		const desc = descriptions[i];
		const blockId = i === 0 ? 'MAIN' : desc.name;
		lines.push(`[${blockId}]`);

		// Header comment line
		lines.push(isJp ? SIMPLEDSP_HEADERS.jp : SIMPLEDSP_HEADERS.en);

		// ID row — per spec, every description block has one. The constraint
		// column holds the base URI for record URIs: user's idPrefix
		// declaration wins; otherwise fall back to the project's base URI.
		const idComment = desc.note || '';
		const idConstraint = desc.idPrefix ? `${desc.idPrefix}:` : (base || '');
		lines.push(
			`ID\t${desc.targetClass}\t1\t1\tID\t${idConstraint}\t${idComment}`
		);

		for (const stmt of desc.statements) {
			const stmtName = stmt.label || '';
			const property = stmt.propertyId || '';

			// Cardinality
			const min = stmt.cardinalityNote
				? stmt.cardinalityNote
				: stmt.min != null
					? String(stmt.min)
					: '0';
			const max = stmt.max != null ? String(stmt.max) : '-';

			const valueTypeEn = resolveSimpleDspValueType(stmt);
			const valueType = isJp ? (VALUE_TYPE_JP[valueTypeEn] ?? valueTypeEn) : valueTypeEn;
			const constraint = resolveSimpleDspConstraint(stmt);
			const comment = stmt.note || '';

			lines.push(
				`${stmtName}\t${property}\t${min}\t${max}\t${valueType}\t${constraint}\t${comment}`
			);
		}

		lines.push('');
	}

	return lines.join('\n');
}
