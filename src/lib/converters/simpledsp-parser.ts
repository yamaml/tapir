/**
 * @fileoverview SimpleDSP text parser.
 *
 * Parses the tab-separated SimpleDSP format into the Tapir internal
 * model (`TapirProject`). The format uses `[@NS]`, `[MAIN]`, and
 * named `[Shape]` blocks.
 *
 * SimpleDSP column layout (by position):
 *
 * | Col | Field      | Description                           |
 * |-----|------------|---------------------------------------|
 * | 0   | Name       | Statement label                       |
 * | 1   | Property   | Property IRI (prefixed)               |
 * | 2   | Min        | Minimum cardinality                   |
 * | 3   | Max        | Maximum cardinality (- = unbounded)    |
 * | 4   | ValueType  | ID / literal / structured / reference  |
 * | 5   | Constraint | Datatype, shape ref, vocab, etc.      |
 * | 6   | Comment    | Free-text note                        |
 *
 * Ported from yama-cli `src/modules/dsp.js`.
 *
 * @module converters/simpledsp-parser
 */

import type {
	TapirProject,
	Description,
	Statement,
	NamespaceMap,
	ValueType,
} from '$lib/types';
import type { ParseResult, ParseMessage } from '$lib/types/export';
import { createProject, createDescription, createStatement } from '$lib/types/profile';
import { STANDARD_PREFIXES } from '$lib/converters/simpledsp-generator';

// ── Types ───────────────────────────────────────────────────────

/** A row parsed from a SimpleDSP block. */
interface SimpleDspRow {
	Name: string;
	Property: string;
	Min: string;
	Max: string;
	ValueType: string;
	Constraint: string;
	Comment: string;
}

/** A parsed SimpleDSP block (one description template). */
interface SimpleDspBlock {
	id: string;
	rows: SimpleDspRow[];
}

/** Intermediate result from text parsing. */
interface SimpleDspTextResult {
	blocks: SimpleDspBlock[];
	namespaces: NamespaceMap;
}

// ── Japanese Value Type Normalization ───────────────────────────

/** Maps Japanese value type labels to their English equivalents. */
const JP_VALUE_TYPE_MAP: Record<string, string> = {
	'文字列': 'literal',
	'構造化': 'structured',
	'参照値(uri)': 'iri',
	'参照値': 'iri',
	'制約なし': '',
};

// ── Text Parser ─────────────────────────────────────────────────

/**
 * Detects the delimiter used in a SimpleDSP document by sampling the
 * first non-block, non-comment content line. Tabs win over commas when
 * both appear (TSV is the canonical format per the SimpleDSP spec).
 */
function detectDelimiter(lines: string[]): '\t' | ',' {
	for (const raw of lines) {
		const line = raw.trim();
		if (!line || line.startsWith('[') || line.startsWith('#')) continue;
		if (line.includes('\t')) return '\t';
		if (line.includes(',')) return ',';
	}
	return '\t';
}

/**
 * Strips a single pair of wrapping double quotes from a cell value
 * when — and only when — the cell is itself one complete quoted token.
 *
 * XLSX exporters (including SheetJS's `sheet_to_csv`) sometimes wrap
 * short cell values like `ID` in quotes. Per a long-standing quirk of
 * the MetaBridge ecosystem, SimpleDSP consumers accept both `ID` and
 * `"ID"` for the ID-row marker; we normalise so downstream logic sees
 * the bare value.
 *
 * We must NOT strip outer quotes from multi-value picklist constraints
 * like `"red" "green" "blue"` — those quotes are load-bearing and the
 * downstream value parser depends on them. We detect the multi-token
 * case by looking for a `"` that is not part of the doubled `""` escape
 * sequence appearing in the interior of the cell.
 */
function unquote(cell: string): string {
	if (cell.length < 2 || !cell.startsWith('"') || !cell.endsWith('"')) {
		return cell;
	}
	// Inspect interior (characters between the outer quotes). If we hit
	// a bare `"` that isn't paired with another `"` (RFC 4180 escape),
	// treat the cell as multi-token and leave the quotes in place.
	const inner = cell.slice(1, -1);
	for (let i = 0; i < inner.length; i++) {
		if (inner[i] !== '"') continue;
		if (inner[i + 1] === '"') {
			i++; // consume the escape
			continue;
		}
		return cell; // bare interior quote → not a single quoted token
	}
	return inner.replace(/""/g, '"');
}

/**
 * Splits a SimpleDSP row into cells, honouring quoted fields for CSV.
 * For TSV we keep the simple `split('\t')` behaviour (with outer-quote
 * stripping for XLSX-exported TSVs); for CSV we do a proper RFC-4180-
 * style split so fields containing commas or newlines (wrapped in
 * double quotes) survive intact.
 */
function splitRow(line: string, delimiter: '\t' | ','): string[] {
	if (delimiter === '\t') return line.split('\t').map(unquote);

	const result: string[] = [];
	let current = '';
	let inQuotes = false;
	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (inQuotes) {
			if (ch === '"') {
				if (i + 1 < line.length && line[i + 1] === '"') {
					current += '"';
					i++;
				} else {
					inQuotes = false;
				}
			} else {
				current += ch;
			}
		} else if (ch === '"') {
			inQuotes = true;
		} else if (ch === delimiter) {
			result.push(current);
			current = '';
		} else {
			current += ch;
		}
	}
	result.push(current);
	return result;
}

/**
 * Parses raw SimpleDSP text into blocks and namespaces.
 *
 * Recognises `[@NS]` for namespace declarations, `[MAIN]` for the
 * primary description, and `[Name]` for sub-shapes. Lines starting
 * with `#` are treated as header comments and skipped.
 *
 * Columns are read by **position**. The delimiter is auto-detected
 * from the first content line: tab (canonical TSV) is preferred, with
 * comma (CSV) as a fallback so CSV variants also parse correctly.
 *
 * @param text - The SimpleDSP text content.
 * @returns Parsed blocks and namespace map.
 *
 * @example
 * const { blocks, namespaces } = parseSimpleDspText('[@NS]\nfoaf\thttp://xmlns.com/foaf/0.1/\n\n[MAIN]\n#Name\tProperty\t...\nname\tfoaf:name\t1\t1\tliteral\txsd:string\tFull name');
 */
export function parseSimpleDspText(text: string): SimpleDspTextResult {
	const lines = text.split(/\r?\n/);
	const namespaces: NamespaceMap = {};
	const blocks: SimpleDspBlock[] = [];
	let currentBlock: SimpleDspBlock | null = null;
	let inNsBlock = false;
	const delimiter = detectDelimiter(lines);

	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed) continue;

		// Block header — may be written as `[MAIN]` (CSV single-cell row) or
		// `[MAIN],,,,,,` (CSV with trailing empty cells). Detect by the leading
		// bracket after stripping trailing delimiters.
		const stripped = trimmed.replace(new RegExp(`${delimiter === '\t' ? '\\t' : ','}+$`), '');
		if (stripped.startsWith('[') && stripped.endsWith(']')) {
			const blockId = stripped.slice(1, -1);
			if (blockId === '@NS') {
				inNsBlock = true;
				currentBlock = null;
				continue;
			}
			inNsBlock = false;
			currentBlock = { id: blockId, rows: [] };
			blocks.push(currentBlock);
			continue;
		}

		// Comment line (header row)
		if (trimmed.startsWith('#')) continue;

		if (inNsBlock) {
			const parts = splitRow(trimmed, delimiter);
			if (parts.length >= 2) {
				namespaces[parts[0].trim()] = parts[1].trim();
			}
			continue;
		}

		if (currentBlock) {
			const cells = splitRow(trimmed, delimiter);
			currentBlock.rows.push({
				Name: (cells[0] || '').trim(),
				Property: (cells[1] || '').trim(),
				Min: (cells[2] || '').trim(),
				Max: (cells[3] || '').trim(),
				ValueType: (cells[4] || '').trim(),
				Constraint: (cells[5] || '').trim(),
				Comment: (cells[6] || '').trim(),
			});
		}
	}

	return { blocks, namespaces };
}

// ── Cardinality Parser ──────────────────────────────────────────

/**
 * Parses a cardinality value from SimpleDSP.
 *
 * `-` means unbounded (null). Keywords like `推奨` (recommended)
 * return `null`. Any non-numeric string returns `null`.
 *
 * @param val - The cardinality string.
 * @returns The parsed integer, or `null` for unbounded/keyword values.
 *
 * @example
 * parseCardinality('1')   // => 1
 * parseCardinality('-')   // => null
 * parseCardinality('推奨') // => null
 */
export function parseCardinality(val: string): number | null {
	if (!val || val === '-') return null;
	const n = parseInt(val, 10);
	return Number.isNaN(n) ? null : n;
}

// ── Quoted Value Parser ─────────────────────────────────────────

/**
 * Parses quoted values from a SimpleDSP constraint string.
 *
 * @param str - The constraint string containing quoted values.
 * @returns Array of unquoted values.
 *
 * @example
 * parseQuotedValues('"banana" "apple" "orange"')
 * // => ['banana', 'apple', 'orange']
 */
export function parseQuotedValues(str: string): string[] {
	const matches = str.match(/"([^"]*)"/g);
	if (!matches) return [str];
	return matches.map((m) => m.slice(1, -1));
}

// ── Statement Key Generator ────────────────────────────────────

/**
 * Generates a camelCase key from a statement name or property.
 *
 * Spaces are converted to camelCase. The middle dot (・) is replaced
 * with underscore. CJK characters are preserved. All-uppercase ASCII
 * keys are lowercased.
 */
function generateKey(stmtName: string, property: string, usedKeys: Set<string>, index: number): string {
	let key = stmtName
		? stmtName
				.replace(/\u30FB/g, '_')
				.replace(/[^\p{L}\p{N}\s_]/gu, '')
				.replace(/\s+(.)/g, (_, c: string) => c.toUpperCase())
				.replace(/\s+/g, '')
		: property.split(':').pop() || `stmt${index}`;

	// Lowercase first char; all-uppercase ASCII becomes fully lowercase
	if (key === key.toUpperCase() && /^[A-Z]+$/.test(key)) {
		key = key.toLowerCase();
	} else {
		key = key.charAt(0).toLowerCase() + key.slice(1);
	}

	// Deduplicate
	if (usedKeys.has(key)) {
		let suffix = 2;
		while (usedKeys.has(`${key}${suffix}`)) suffix++;
		key = `${key}${suffix}`;
	}
	usedKeys.add(key);

	return key;
}

// ── Main Converter ──────────────────────────────────────────────

/**
 * Converts parsed SimpleDSP blocks and namespaces into a `TapirProject`.
 *
 * Adapts the YAMA-CLI `simpleDspToYama()` logic to the Tapir internal
 * model. Key differences from the CLI version:
 *
 *   - `shapeRef` replaces YAMAML's `description` on statements
 *   - `classConstraint` (array) replaces YAMAML's `a` on statements
 *   - `targetClass` on Description replaces YAMAML's `a` on description
 *   - `valueType` uses Tapir's flavor-neutral types (`'literal'`, `'iri'`, `''`)
 *   - Result wrapped in `ParseResult<TapirProject>` with warnings/errors
 *
 * @param blocks - Parsed SimpleDSP blocks.
 * @param parsedNs - Namespaces from the `@NS` block.
 * @param projectName - Optional project name (defaults to `'Imported SimpleDSP'`).
 * @returns A `ParseResult` containing the project, warnings, and errors.
 *
 * @example
 * const { blocks, namespaces } = parseSimpleDspText(text);
 * const result = simpleDspToTapir(blocks, namespaces);
 * if (result.errors.length === 0) {
 *   console.log(result.data.descriptions);
 * }
 */
export function simpleDspToTapir(
	blocks: SimpleDspBlock[],
	parsedNs: NamespaceMap,
	projectName: string = 'Imported SimpleDSP'
): ParseResult<TapirProject> {
	const warnings: ParseMessage[] = [];
	const errors: ParseMessage[] = [];

	// Separate @base from namespaces
	const namespaces: NamespaceMap = {};
	let base = '';
	for (const [key, uri] of Object.entries(parsedNs)) {
		if (key === '@base') {
			base = uri;
		} else {
			namespaces[key] = uri;
		}
	}

	const descriptions: Description[] = [];
	let isFirst = true;

	for (const block of blocks) {
		const descName = block.id === 'MAIN' && isFirst ? 'MAIN' : block.id;
		isFirst = false;

		let targetClass = '';
		let idPrefix = '';
		const statements: Statement[] = [];
		const usedKeys = new Set<string>();

		for (let rowIndex = 0; rowIndex < block.rows.length; rowIndex++) {
			const row = block.rows[rowIndex];
			const stmtName = row.Name;
			const property = row.Property;
			const minStr = row.Min;
			const maxStr = row.Max;
			const rawValueType = (row.ValueType || '').toLowerCase();
			const constraint = row.Constraint || '';
			const comment = row.Comment || '';

			// Normalize Japanese value type names
			const normalizedValueType = JP_VALUE_TYPE_MAP[rawValueType] || rawValueType;

			// ID statement — defines the record's identity
			if (normalizedValueType === 'id') {
				if (property) targetClass = property;
				if (constraint) {
					// The ID-row constraint column holds one of two things
					// (per the SimpleDSP spec): a namespace prefix reference
					// (e.g. "ndlbooks:") or a full base URI for record URIs.
					if (/^(https?|urn):/.test(constraint) || constraint.includes('/')) {
						// Full URI — fold into the project's @base if not set
						if (!base) base = constraint;
					} else {
						const trimmedPrefix = constraint.replace(/:$/, '');
						if (trimmedPrefix) idPrefix = trimmedPrefix;
					}
				}
				continue;
			}

			// Skip rows without property or name
			if (!property && !stmtName) {
				if (row.ValueType || row.Constraint) {
					warnings.push({
						line: rowIndex + 1,
						message: `Row in block "${descName}" has no Name or Property — skipped`,
					});
				}
				continue;
			}

			const key = generateKey(stmtName, property, usedKeys, usedKeys.size);

			const stmt = createStatement({ id: key });
			if (stmtName) stmt.label = stmtName;
			if (property) stmt.propertyId = property;

			// Cardinality
			const min = parseCardinality(minStr);
			const max = parseCardinality(maxStr);
			if (min != null) stmt.min = min;
			if (max != null) stmt.max = max;
			if (minStr && min == null && minStr !== '-') {
				stmt.cardinalityNote = minStr;
			}

			// Value type and constraint
			switch (normalizedValueType) {
				case 'literal':
					stmt.valueType = 'literal';
					if (constraint) {
						if (constraint.startsWith('"')) {
							stmt.values = parseQuotedValues(constraint);
						} else {
							stmt.datatype = constraint;
						}
					}
					break;

				case 'structured':
					if (constraint.startsWith('#')) {
						// May be a single "#Shape" or a space-separated list
						// "#Shape1 #Shape2". Both are supported on read.
						stmt.shapeRefs = constraint
							.split(/\s+/)
							.filter((s) => s.startsWith('#'))
							.map((s) => s.slice(1))
							.filter(Boolean);
					} else if (constraint) {
						const classes = constraint.split(/\s+/);
						stmt.valueType = 'iri';
						stmt.classConstraint = classes;
					}
					break;


				case 'iri':
					stmt.valueType = 'iri';
					if (constraint) {
						const raw = constraint.replace(/<([^>]+)>/g, '$1');
						const parts = raw.split(/\s+/).filter(Boolean);
						const schemes = parts.filter((p) => p.endsWith(':'));
						const uris = parts.filter((p) => !p.endsWith(':'));
						if (schemes.length > 0) {
							stmt.inScheme = schemes;
						}
						if (uris.length > 0) {
							stmt.values = uris;
						}
					}
					break;

				default:
					// No specific type — leave unconstrained
					if (constraint) {
						stmt.datatype = constraint;
					}
					break;
			}

			if (comment) stmt.note = comment;
			statements.push(stmt);
		}

		const desc = createDescription({ name: descName });
		if (targetClass) desc.targetClass = targetClass;
		if (idPrefix) desc.idPrefix = idPrefix;
		desc.statements = statements;
		descriptions.push(desc);
	}

	if (blocks.length === 0) {
		warnings.push({ message: 'No description blocks found in input' });
	}

	const project = createProject({
		name: projectName,
		flavor: 'simpledsp',
		base,
		namespaces,
		descriptions,
	});

	return { data: project, warnings, errors };
}

// ── Convenience Function ────────────────────────────────────────

/**
 * Parses a SimpleDSP text string and returns a `TapirProject`.
 *
 * Combines `parseSimpleDspText()` and `simpleDspToTapir()` into a
 * single call.
 *
 * @param text - The raw SimpleDSP text.
 * @param projectName - Optional project name.
 * @returns A `ParseResult` containing the project.
 *
 * @example
 * const result = parseSimpleDsp(tsvContent);
 * console.log(result.data.descriptions[0].statements.length);
 */
export function parseSimpleDsp(
	text: string,
	projectName?: string
): ParseResult<TapirProject> {
	const { blocks, namespaces } = parseSimpleDspText(text);
	return simpleDspToTapir(blocks, namespaces, projectName);
}
