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

import type { TapirProject, Statement, NamespaceMap } from '$lib/types';
import type { GeneratorWarning } from '$lib/types/export';
import { STANDARD_PREFIXES } from './prefix-utils';

// Re-exported for backwards compatibility: the table now lives in
// prefix-utils (it is shared by every RDF generator), but several
// modules import it from here.
export { STANDARD_PREFIXES };

// ── Language-specific Labels ────────────────────────────────────

/** SimpleDSP header comment lines by language. */
const SIMPLEDSP_HEADERS: Record<string, string> = {
	en: '#Name\tProperty\tMin\tMax\tValueType\tConstraint\tComment',
	jp: '#項目規則名\tプロパティ\t最小\t最大\t値タイプ\t値制約\tコメント',
};

/**
 * Maps internal display value types to Japanese for export.
 *
 * Keys match the values `resolveSimpleDspValueType` returns —
 * including `IRI` (spec Table 15: `参照値`).
 */
const VALUE_TYPE_JP: Record<string, string> = {
	ID: 'ID',
	literal: '文字列',
	structured: '構造化',
	IRI: '参照値',
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
 *   - `valueType` includes `iri` → `"IRI"`
 *   - `valueType` includes `literal` or has `datatype`/`values` → `"literal"`
 *   - Otherwise → `""` (no constraint)
 *
 * SimpleDSP cannot express multiple node kinds in one row. A multi-type
 * statement (e.g. `['iri','literal']`) therefore collapses to a single
 * display type, with IRI taking precedence over literal.
 *
 * @param stmt - The statement to resolve.
 * @returns The SimpleDSP value type string.
 *
 * @example
 * resolveSimpleDspValueType({ shapeRefs: ['Agent'] })  // => 'structured'
 * resolveSimpleDspValueType({ valueType: ['iri'] })    // => 'IRI'
 */
export function resolveSimpleDspValueType(stmt: Statement): string {
	if (stmt.shapeRefs && stmt.shapeRefs.length > 0) return 'structured';
	if (stmt.classConstraint.length > 0) return 'structured';
	if (stmt.valueType.includes('iri')) return 'IRI';
	if (
		stmt.valueType.includes('literal') ||
		(stmt.datatype && stmt.datatype.length > 0) ||
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
 *   5. `values` with `valueType` including `iri` → unquoted URIs
 *   6. `values` otherwise (literal) → quoted strings
 *
 * @param stmt - The statement to resolve.
 * @returns The constraint string for the SimpleDSP output.
 *
 * @example
 * resolveSimpleDspConstraint({ shapeRefs: ['Agent'] })
 * // => '#Agent'
 *
 * @example
 * resolveSimpleDspConstraint({ datatype: ['xsd:date'] })
 * // => 'xsd:date'
 *
 * @example
 * resolveSimpleDspConstraint({ datatype: ['xsd:decimal', 'xsd:integer'] })
 * // => 'xsd:decimal xsd:integer'
 *
 * @param stmt - The statement to resolve.
 * @param firstDescName - Name of the first description. The export
 *   renames the first block to `[MAIN]`, so references to it must be
 *   rewritten to `#MAIN` or they would dangle.
 */
export function resolveSimpleDspConstraint(stmt: Statement, firstDescName?: string): string {
	// Shape reference(s). Refs to the first description follow its
	// rename to MAIN (self-references included).
	if (stmt.shapeRefs && stmt.shapeRefs.length > 0) {
		return stmt.shapeRefs
			.map((s) => `#${firstDescName !== undefined && s === firstDescName ? 'MAIN' : s}`)
			.join(' ');
	}

	// Class constraint
	if (stmt.classConstraint.length > 0) {
		return stmt.classConstraint.join(' ');
	}

	// Datatype(s). Multi-datatype is endorsed by the SimpleDSP spec
	// (§4.6 Table 16): a space-separated list represents a union.
	if (stmt.datatype && stmt.datatype.length > 0) {
		return stmt.datatype.join(' ');
	}

	// Vocabulary scheme (inScheme)
	if (stmt.inScheme.length > 0) {
		return stmt.inScheme.join(' ');
	}

	// Value set
	if (Array.isArray(stmt.values) && stmt.values.length > 0) {
		if (stmt.valueType.includes('iri')) {
			return stmt.values.join(' ');
		}
		// Literal picklist: quoted strings; embedded quotes escape as
		// doubled quotes (the parser's parseQuotedValues reverses this).
		return stmt.values.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(' ');
	}

	return '';
}

// ── Cell Sanitiser ──────────────────────────────────────────────

/**
 * Sanitises a value for use as a SimpleDSP TSV cell: tabs and
 * newlines would corrupt the positional row structure, so they are
 * collapsed to single spaces (with a warning).
 */
function sanitiseCell(
	value: string,
	context: string,
	warnings?: GeneratorWarning[]
): string {
	if (!/[\t\r\n]/.test(value)) return value;
	warnings?.push({
		message: `${context}: tab/newline characters were replaced with spaces in the SimpleDSP cell`,
	});
	return value.replace(/[\t\r\n]+/g, ' ');
}

// ── Statement Name Fallback ─────────────────────────────────────

/**
 * Resolves the Name column for a statement row: the label when set,
 * otherwise a key derived from the property's local name, otherwise
 * the statement id. Never empty (SimpleDSP §7.5 requires a name).
 */
function resolveStatementName(stmt: Statement): string {
	if (stmt.label) return stmt.label;
	const local = (stmt.propertyId || '').split(/[:#/]/).filter(Boolean).pop();
	return local || stmt.id;
}

// ── Generator ───────────────────────────────────────────────────

/** Generator options. */
export interface SimpleDspGeneratorOptions {
	/** Header/value-type language: `"en"` (default) or `"jp"`. */
	lang?: 'en' | 'jp';
	/** Optional accumulator for lossy-mapping warnings. */
	warnings?: GeneratorWarning[];
}

/**
 * Generates SimpleDSP text output from a `TapirProject`.
 *
 * Produces a tab-separated text file with `[@NS]` namespace
 * declarations and one block per description template. The first
 * description is renamed to `[MAIN]`; shape references to it are
 * rewritten to `#MAIN` so they cannot dangle.
 *
 * ID rows are emitted for the first (MAIN) block and for any
 * description that declares an `idPrefix` or `targetClass`. The ID
 * row's constraint column carries only the `prefix:` form — never a
 * raw base URI, which would conflate record and schema namespaces.
 *
 * @param project - The Tapir project to export.
 * @param opts - Generator options (language, warning accumulator).
 * @returns The SimpleDSP text content.
 *
 * @example
 * const text = buildSimpleDsp(project, { lang: 'en' });
 * console.log(text);
 */
export function buildSimpleDsp(
	project: TapirProject,
	{ lang = 'en', warnings }: SimpleDspGeneratorOptions = {}
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
	const firstDescName = descriptions[0]?.name;

	// The first block is renamed [MAIN]; a *different* description that
	// is literally named MAIN would collide with the rename.
	if (
		firstDescName &&
		firstDescName !== 'MAIN' &&
		descriptions.some((d, i) => i > 0 && d.name === 'MAIN')
	) {
		warnings?.push({
			message: `The first description "${firstDescName}" is renamed to [MAIN] on export, but another description is already named "MAIN" — references may resolve to the wrong block`,
		});
	}

	for (let i = 0; i < descriptions.length; i++) {
		const desc = descriptions[i];
		const blockId = i === 0 ? 'MAIN' : desc.name;
		lines.push(`[${blockId}]`);

		// Header comment line
		lines.push(isJp ? SIMPLEDSP_HEADERS.jp : SIMPLEDSP_HEADERS.en);

		// ID row — emitted for the MAIN block and for descriptions that
		// declare identity information (idPrefix or targetClass). The
		// constraint column carries only the `prefix:` form; the raw
		// project base never belongs there (it is the schema namespace,
		// not the record namespace — SimpleDSP §3.2 distinguishes them).
		if (i === 0 || desc.idPrefix || desc.targetClass) {
			const idComment = sanitiseCell(desc.note || '', `Description "${desc.name}" note`, warnings);
			const idConstraint = desc.idPrefix ? `${desc.idPrefix}:` : '';
			lines.push(`ID\t${desc.targetClass}\t1\t1\tID\t${idConstraint}\t${idComment}`);
		} else if (desc.note) {
			warnings?.push({
				message: `Description "${desc.name}" has a note but no ID row (no idPrefix/targetClass) — the note is not exported`,
			});
		}

		for (const stmt of desc.statements) {
			const ctx = `Statement "${stmt.label || stmt.propertyId || stmt.id}" in "${desc.name}"`;
			const stmtName = sanitiseCell(resolveStatementName(stmt), ctx, warnings);
			const property = stmt.propertyId || '';

			// Cardinality. SimpleDSP's Min/Max columns take only the values
			// listed in spec §4.3/§4.4 (0/n/keyword and 1/n/-); an empty
			// cell is not among them (unlike ValueType §4.5, where the spec
			// explicitly allows it). Unspecified cardinality (undefined)
			// therefore exports as the spec's "no constraint" pair `0`/`-`,
			// matching yama-cli. The unspecified-vs-explicit distinction is
			// lost on round-trip, so warn. Keyword rows are exempt: §4.3
			// itself directs Max to `-` when a keyword occupies Min.
			const min = stmt.cardinalityNote
				? sanitiseCell(stmt.cardinalityNote, ctx, warnings)
				: stmt.min != null
					? String(stmt.min)
					: '0';
			const max = stmt.max != null ? String(stmt.max) : '-';
			if (!stmt.cardinalityNote && (stmt.min === undefined || stmt.max === undefined)) {
				const filled = [
					...(stmt.min === undefined ? ['Min "0"'] : []),
					...(stmt.max === undefined ? ['Max "-"'] : []),
				].join(' and ');
				warnings?.push({
					message: `${ctx} has unspecified cardinality — exported as ${filled} (SimpleDSP §4.3/§4.4 allow no empty Min/Max cells)`,
				});
			}

			const valueTypeEn = resolveSimpleDspValueType(stmt);
			const valueType = isJp ? (VALUE_TYPE_JP[valueTypeEn] ?? valueTypeEn) : valueTypeEn;
			const constraint = sanitiseCell(
				resolveSimpleDspConstraint(stmt, firstDescName),
				ctx,
				warnings
			);
			const comment = sanitiseCell(stmt.note || '', ctx, warnings);

			lines.push(
				`${stmtName}\t${property}\t${min}\t${max}\t${valueType}\t${constraint}\t${comment}`
			);
		}

		lines.push('');
	}

	return lines.join('\n');
}
