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
import { parseCsv } from '$lib/converters/csv';

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

// ── Value Type Normalization ────────────────────────────────────

/**
 * Maps recognised value-type labels (lowercased) to their internal
 * equivalents. Japanese labels come from the original MIC-J spec
 * (Table 15); `reference` is the OWL-DSP English keyword (YAMAML
 * §7.5) accepted as an alias for `IRI`.
 */
const VALUE_TYPE_ALIASES: Record<string, string> = {
	'文字列': 'literal',
	'構造化': 'structured',
	'参照値(uri)': 'iri',
	'参照値': 'iri',
	'制約なし': '',
	reference: 'iri',
};

/** Value types the parser recognises after normalisation. */
const KNOWN_VALUE_TYPES = new Set(['', 'id', 'literal', 'structured', 'iri']);

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
 *
 * @param cell - The raw TSV cell value.
 * @param keepBareQuotes - When true (used for the Constraint column),
 *   a quoted cell with no interior escape evidence (e.g. `"red"`, a
 *   single-value picklist) keeps its quotes. Only Excel-escaped cells
 *   (containing `""`) are unwrapped.
 */
function unquote(cell: string, keepBareQuotes = false): string {
	if (cell.length < 2 || !cell.startsWith('"') || !cell.endsWith('"')) {
		return cell;
	}
	// Inspect interior (characters between the outer quotes). If we hit
	// a bare `"` that isn't paired with another `"` (RFC 4180 escape),
	// treat the cell as multi-token and leave the quotes in place.
	const inner = cell.slice(1, -1);
	let hasEscape = false;
	for (let i = 0; i < inner.length; i++) {
		if (inner[i] !== '"') continue;
		if (inner[i + 1] === '"') {
			hasEscape = true;
			i++; // consume the escape
			continue;
		}
		return cell; // bare interior quote → not a single quoted token
	}
	// Constraint cells: `"red"` (no interior quotes) is a single-value
	// picklist whose quotes are load-bearing — leave them in place.
	// Excel-wrapped cells always contain `""` escapes when the content
	// itself was quoted, so those still unwrap correctly.
	if (keepBareQuotes && !hasEscape) return cell;
	return inner.replace(/""/g, '"');
}

/** Positional column index of the Constraint cell in a statement row. */
const CONSTRAINT_COLUMN = 5;

/**
 * Splits SimpleDSP text into rows of cells.
 *
 * For CSV input, delegates to the shared RFC 4180 parser so quoted
 * fields containing commas or newlines survive intact. For TSV
 * (canonical SimpleDSP), rows are line-based and cells are raw —
 * with outer-quote stripping for XLSX-exported TSVs, except in the
 * Constraint column where bare quotes mark single-value picklists.
 */
function splitRows(text: string, delimiter: '\t' | ','): string[][] {
	if (delimiter === ',') {
		return parseCsv(text, { delimiter: ',' });
	}
	const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
	return input
		.split(/\r\n|\r|\n/)
		.map((line) =>
			line
				.split('\t')
				.map((cell, i) => unquote(cell.trim(), i === CONSTRAINT_COLUMN))
		);
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
 * Per the spec's shorthand (§6.2.6), a document with no block headers
 * at all is parsed as a single implicit `[MAIN]` block — statement
 * rows appearing before any `[...]` header open that block.
 *
 * @param text - The SimpleDSP text content.
 * @returns Parsed blocks and namespace map.
 *
 * @example
 * const { blocks, namespaces } = parseSimpleDspText('[@NS]\nfoaf\thttp://xmlns.com/foaf/0.1/\n\n[MAIN]\n#Name\tProperty\t...\nname\tfoaf:name\t1\t1\tliteral\txsd:string\tFull name');
 */
export function parseSimpleDspText(text: string): SimpleDspTextResult {
	const namespaces: NamespaceMap = {};
	const blocks: SimpleDspBlock[] = [];
	let currentBlock: SimpleDspBlock | null = null;
	let inNsBlock = false;
	const delimiter = detectDelimiter(text.split(/\r?\n/));

	for (const cells of splitRows(text, delimiter)) {
		// Skip fully empty rows.
		if (cells.every((c) => !c.trim())) continue;

		// Block header — `[MAIN]` as a single cell, optionally followed
		// by empty cells (spreadsheet exports write `[MAIN],,,,,,`).
		const first = cells[0].trim();
		const restEmpty = cells.slice(1).every((c) => !c.trim());
		if (first.startsWith('[') && first.endsWith(']') && restEmpty) {
			const blockId = first.slice(1, -1);
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
		if (first.startsWith('#')) continue;

		if (inNsBlock) {
			if (cells.length >= 2 && cells[0].trim()) {
				namespaces[cells[0].trim()] = (cells[1] || '').trim();
			}
			continue;
		}

		// Header-less shorthand (§6.2.6): statement rows before any
		// block header open an implicit [MAIN] block.
		if (!currentBlock) {
			currentBlock = { id: 'MAIN', rows: [] };
			blocks.push(currentBlock);
		}

		currentBlock.rows.push({
			Name: cells[0] || '',
			Property: (cells[1] || '').trim(),
			Min: (cells[2] || '').trim(),
			Max: (cells[3] || '').trim(),
			ValueType: (cells[4] || '').trim(),
			Constraint: (cells[5] || '').trim(),
			Comment: cells[6] || '',
		});
	}

	return { blocks, namespaces };
}

// ── Cardinality Parser ──────────────────────────────────────────

/**
 * Parses a cardinality value from SimpleDSP.
 *
 * `-` means **explicitly unbounded** and returns `null`. An empty
 * cell means unspecified and returns `undefined`. Keywords like
 * `推奨` (recommended) and other non-numeric strings also return
 * `undefined` (the caller preserves them as `cardinalityNote`).
 *
 * @param val - The cardinality string.
 * @returns The parsed integer, `null` for `-`, or `undefined`.
 *
 * @example
 * parseCardinality('1')   // => 1
 * parseCardinality('-')   // => null
 * parseCardinality('')    // => undefined
 * parseCardinality('推奨') // => undefined
 */
export function parseCardinality(val: string): number | null | undefined {
	if (!val) return undefined;
	if (val === '-') return null;
	const n = parseInt(val, 10);
	return Number.isNaN(n) ? undefined : n;
}

// ── Quoted Value Parser ─────────────────────────────────────────

/**
 * Parses quoted values from a SimpleDSP constraint string.
 *
 * Doubled quotes inside a quoted token decode to a literal `"`
 * (mirroring the generator's escaping).
 *
 * @param str - The constraint string containing quoted values.
 * @returns Array of unquoted values.
 *
 * @example
 * parseQuotedValues('"banana" "apple" "orange"')
 * // => ['banana', 'apple', 'orange']
 */
export function parseQuotedValues(str: string): string[] {
	const matches = str.match(/"((?:[^"]|"")*)"/g);
	if (!matches) return [str];
	return matches.map((m) => m.slice(1, -1).replace(/""/g, '"'));
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

	for (const block of blocks) {
		const descName = block.id;

		let targetClass = '';
		let idPrefix = '';
		let descNote = '';
		const statements: Statement[] = [];
		const usedKeys = new Set<string>();

		for (let rowIndex = 0; rowIndex < block.rows.length; rowIndex++) {
			const row = block.rows[rowIndex];
			const stmtName = row.Name.trim();
			const property = row.Property;
			const minStr = row.Min;
			const maxStr = row.Max;
			const rawValueType = (row.ValueType || '').toLowerCase();
			const constraint = row.Constraint || '';
			const comment = row.Comment || '';

			// Normalise Japanese/alias value type names. The alias map may
			// legitimately map to '' (制約なし → "no constraint"), so use a
			// key-presence check rather than `||`.
			const normalizedValueType =
				rawValueType in VALUE_TYPE_ALIASES ? VALUE_TYPE_ALIASES[rawValueType] : rawValueType;

			// Unrecognised value type — spec §4.5 treats this as an error.
			// Record it and preserve the row's constraint verbatim so no
			// data is silently lost or misfiled.
			if (!KNOWN_VALUE_TYPES.has(normalizedValueType)) {
				errors.push({
					line: rowIndex + 1,
					message: `Unrecognised value type "${row.ValueType}" in block "${descName}" (row ${rowIndex + 1})`,
				});
			}

			// ID statement — defines the record's identity
			if (normalizedValueType === 'id') {
				if (property) targetClass = property;
				// The ID row's Comment column carries the description's
				// note (the generator writes desc.note there).
				if (comment) descNote = comment;
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

			// Cardinality. `-` parses to null (explicitly unbounded) and
			// must be assigned; an empty cell stays undefined (unspecified).
			const min = parseCardinality(minStr);
			const max = parseCardinality(maxStr);
			if (min !== undefined) stmt.min = min;
			if (max !== undefined) stmt.max = max;
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
							// Multi-datatype is endorsed by the SimpleDSP spec
							// (§4.6 Table 16, literal-constraint row 3): a
							// space-separated list expresses a union of
							// datatypes (e.g. `xsd:decimal xsd:integer`).
							stmt.datatype = constraint.split(/\s+/).filter(Boolean);
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
						// Vocabulary stems come in two spellings: a prefix
						// reference ending with `:` (e.g. `ndlsh:`) or a full
						// namespace URI ending with `/` or `#`. Both denote
						// inScheme; anything else is an enumerated IRI value.
						const isStem = (p: string) =>
							p.endsWith(':') || (/^(https?|urn):/.test(p) && /[/#]$/.test(p));
						const schemes = parts.filter(isStem);
						const uris = parts.filter((p) => !isStem(p));
						if (schemes.length > 0) {
							stmt.inScheme = schemes;
						}
						if (uris.length > 0) {
							stmt.values = uris;
						}
					}
					break;

				case '':
					// No specific type — leave unconstrained. A constraint
					// cell in an untyped row is read as datatype(s), the
					// only constraint kind meaningful without a value type.
					if (constraint) {
						stmt.datatype = constraint.split(/\s+/).filter(Boolean);
					}
					break;

				default:
					// Unrecognised value type (already reported as an error
					// above) — keep the raw constraint so nothing is lost.
					if (constraint) {
						stmt.constraint = constraint;
					}
					break;
			}

			if (comment) stmt.note = comment;
			statements.push(stmt);
		}

		const desc = createDescription({ name: descName });
		if (targetClass) desc.targetClass = targetClass;
		if (idPrefix) desc.idPrefix = idPrefix;
		if (descNote) desc.note = descNote;
		desc.statements = statements;
		descriptions.push(desc);
	}

	// Resolve `#MAIN` references to the first block. The generator
	// renames the first description to `[MAIN]` on export and rewrites
	// refs accordingly; if this document's first block kept a custom
	// name, refs to `MAIN` still mean "the first description".
	const firstName = descriptions[0]?.name;
	if (firstName && firstName !== 'MAIN') {
		for (const desc of descriptions) {
			for (const stmt of desc.statements) {
				stmt.shapeRefs = stmt.shapeRefs.map((r) => (r === 'MAIN' ? firstName : r));
			}
		}
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
