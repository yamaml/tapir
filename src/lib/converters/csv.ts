/**
 * @fileoverview Shared RFC 4180 CSV parser.
 *
 * A single state-machine parser used by every CSV-reading code path
 * (`import-handler.ts` and `simpledsp-parser.ts`). Handles the cases
 * a naive line-split parser corrupts:
 *
 *   - quoted fields containing the delimiter or **newlines**
 *   - doubled-quote escapes (`""` → `"`)
 *   - CRLF and lone-CR row terminators
 *   - a leading UTF-8 byte-order mark
 *   - significant whitespace inside quoted fields (preserved; only
 *     unquoted cells are trimmed)
 *
 * @module converters/csv
 */

// ── Options ─────────────────────────────────────────────────────

/** Options for {@link parseCsv}. */
export interface CsvParseOptions {
	/** Field delimiter (defaults to `','`). Use `'\t'` for TSV input. */
	delimiter?: string;
	/**
	 * When true (default), unquoted cells are trimmed. Quoted cells are
	 * never trimmed — quotes mark their whitespace as significant.
	 */
	trimUnquoted?: boolean;
}

// ── Parser ──────────────────────────────────────────────────────

/**
 * Parses CSV/TSV text into rows of cells using an RFC 4180 state
 * machine.
 *
 * Quoting rules: a cell is treated as quoted only when its first
 * character (after the delimiter) is `"`. Inside a quoted cell, `""`
 * decodes to a literal `"` and newlines/delimiters are data. Text
 * after the closing quote is appended verbatim (lenient handling of
 * malformed input).
 *
 * @param text - The raw CSV/TSV content (may start with a BOM).
 * @param options - Delimiter and trimming behaviour.
 * @returns Array of rows; each row is an array of cell strings.
 *
 * @example
 * parseCsv('a,"b\nc",d\n1,2,3');
 * // => [['a', 'b\nc', 'd'], ['1', '2', '3']]
 */
export function parseCsv(text: string, options: CsvParseOptions = {}): string[][] {
	const delimiter = options.delimiter ?? ',';
	const trimUnquoted = options.trimUnquoted !== false;

	// Strip a leading UTF-8 BOM.
	const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

	const rows: string[][] = [];
	let row: string[] = [];
	let cell = '';
	let cellQuoted = false;
	let inQuotes = false;
	let cellStarted = false;

	const pushCell = () => {
		row.push(cellQuoted || !trimUnquoted ? cell : cell.trim());
		cell = '';
		cellQuoted = false;
		cellStarted = false;
	};

	const pushRow = () => {
		pushCell();
		rows.push(row);
		row = [];
	};

	for (let i = 0; i < input.length; i++) {
		const ch = input[i];

		if (inQuotes) {
			if (ch === '"') {
				if (input[i + 1] === '"') {
					cell += '"';
					i++;
				} else {
					inQuotes = false;
				}
			} else {
				cell += ch;
			}
			continue;
		}

		if (ch === '"' && !cellStarted && cell.trim() === '') {
			// Opening quote at (whitespace-only) cell start: quoted cell.
			cell = '';
			inQuotes = true;
			cellQuoted = true;
			cellStarted = true;
		} else if (ch === delimiter) {
			pushCell();
		} else if (ch === '\n') {
			pushRow();
		} else if (ch === '\r') {
			pushRow();
			if (input[i + 1] === '\n') i++;
		} else {
			cell += ch;
			cellStarted = true;
		}
	}

	// Flush the final cell/row (unless the input ended cleanly with a
	// newline and nothing is pending).
	if (cell !== '' || cellQuoted || row.length > 0) {
		pushRow();
	}

	return rows;
}

// ── Record Helper ───────────────────────────────────────────────

/**
 * Parses CSV text into header-keyed row records.
 *
 * The first row provides the column names (trimmed). Rows whose cells
 * are all empty are skipped. Cells beyond the header width are
 * dropped; missing cells default to `''`.
 *
 * @param text - The raw CSV content.
 * @param delimiter - Field delimiter (defaults to `','`).
 * @returns Array of row objects keyed by header names.
 *
 * @example
 * parseCsvRecords('a,b\n1,2');
 * // => [{ a: '1', b: '2' }]
 */
export function parseCsvRecords(
	text: string,
	delimiter: string = ','
): Record<string, string>[] {
	const rows = parseCsv(text, { delimiter });
	if (rows.length < 2) return [];

	const headers = rows[0].map((h) => h.trim());
	const records: Record<string, string>[] = [];

	for (let i = 1; i < rows.length; i++) {
		const cells = rows[i];
		if (cells.every((c) => c === '')) continue;

		const record: Record<string, string> = {};
		for (let j = 0; j < headers.length; j++) {
			record[headers[j]] = cells[j] ?? '';
		}
		records.push(record);
	}

	return records;
}
