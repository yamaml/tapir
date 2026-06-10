/**
 * @fileoverview File import handler for Tapir.
 *
 * Provides auto-detection of file formats and conversion to
 * `TapirProject` for import into the editor. Supports:
 *   - `.yaml` / `.yml` → YAMA YAML parser
 *   - `.tsv` → SimpleDSP parser
 *   - `.csv` → auto-detect DCTAP vs SimpleDSP by headers
 *   - `.xlsx` → read with SheetJS, then auto-detect format
 *
 * @module components/editor/import-handler
 */

import type { TapirProject } from '$lib/types';
import type { ParseResult, ParseMessage } from '$lib/types/export';
import { createProject } from '$lib/types/profile';
import { validateProject } from '$lib/utils/validation';
import { parseYamaYaml } from '$lib/converters/yaml-parser';
import { parseSimpleDsp } from '$lib/converters/simpledsp-parser';
import { dctapRowsToTapir, type DctapRow } from '$lib/converters/dctap-parser';
import { parseCsvRecords } from '$lib/converters/csv';
import { readFile, readFileBytes } from '$lib/utils/file-io';

// ── Types ───────────────────────────────────────────────────────

/** Supported import file extensions. */
export const IMPORT_EXTENSIONS = '.yaml,.yml,.tsv,.csv,.xlsx';

/** Result of an import operation. */
export interface ImportResult {
	project: TapirProject;
	warnings: ParseMessage[];
	errors: ParseMessage[];
	format: string;
}

// ── Encoding Guard ──────────────────────────────────────────────

/**
 * Detects mojibake in decoded text. Files are decoded as UTF-8; a
 * Shift-JIS (or other legacy-encoded) SimpleDSP file decodes with
 * U+FFFD replacement characters instead of failing. Surfacing a
 * warning lets the user re-save the file as UTF-8 instead of silently
 * importing garbled labels.
 *
 * @param text - The decoded file content.
 * @returns A warning list (empty when the text decoded cleanly).
 */
function encodingWarnings(text: string): ParseMessage[] {
	if (!text.includes('�')) return [];
	return [
		{
			message:
				'The file contains characters that could not be decoded as UTF-8 (shown as �). ' +
				'It may be saved in a legacy encoding such as Shift-JIS — re-save it as UTF-8 and import again.',
		},
	];
}

// ── CSV/TSV Parsing ─────────────────────────────────────────────

/** DCTAP column headers used for auto-detection. */
const DCTAP_HEADERS = ['shapeid', 'propertyid'];

/**
 * Parses a CSV string into an array of row objects.
 *
 * Delegates to the shared RFC 4180 parser (`converters/csv`), so
 * quoted fields containing commas **and newlines** survive intact,
 * doubled quotes decode, a leading BOM is stripped, and whitespace
 * inside quoted cells is preserved (only unquoted cells are trimmed).
 *
 * @param text - The CSV text content.
 * @param delimiter - Field delimiter (default: `','`).
 * @returns Array of row objects keyed by header names.
 */
export function parseCsvRows(text: string, delimiter: string = ','): Record<string, string>[] {
	return parseCsvRecords(text, delimiter);
}

/**
 * Detects whether CSV rows are DCTAP format by checking for
 * DCTAP-specific column headers.
 *
 * @param headers - Array of column header names.
 * @returns True if the headers match DCTAP format.
 */
export function isDctapFormat(headers: string[]): boolean {
	const lowerHeaders = headers.map((h) => h.toLowerCase().trim());
	return DCTAP_HEADERS.every((dh) => lowerHeaders.includes(dh));
}

// ── XLSX Handling ───────────────────────────────────────────────

/**
 * Reads an XLSX file and converts it to row objects, detected headers,
 * and a tab-separated text serialization of the first sheet.
 *
 * The TSV serialization preserves layout — including SimpleDSP's
 * `[@NS]` / `[MAIN]` block markers, which are single-cell rows — so
 * it can be fed back through the text-based SimpleDSP parser when
 * the sheet doesn't match DCTAP's header-driven format.
 *
 * Uses SheetJS (xlsx) to parse the workbook and extract the first
 * sheet as both an array of row objects (for DCTAP) and a TSV string
 * (for SimpleDSP).
 *
 * @param bytes - The file's binary content.
 * @returns Row objects, detected headers, and a TSV serialization.
 */
async function readXlsx(bytes: Uint8Array): Promise<{
	rows: Record<string, string>[];
	headers: string[];
	tsv: string;
}> {
	const XLSX = await import('xlsx');
	const workbook = XLSX.read(bytes, { type: 'array' });
	const sheetName = workbook.SheetNames[0];
	const sheet = workbook.Sheets[sheetName];

	const rows: Record<string, string>[] = XLSX.utils.sheet_to_json(sheet, {
		header: undefined,
		defval: '',
	});

	const headers = rows.length > 0 ? Object.keys(rows[0]) : [];

	// Ensure all values are strings
	for (const row of rows) {
		for (const key of Object.keys(row)) {
			row[key] = String(row[key] ?? '');
		}
	}

	// Also emit a TSV view of the sheet — used for SimpleDSP parsing,
	// which relies on the raw `[@NS]` / `[MAIN]` block markers rather
	// than column headers.
	const tsv = XLSX.utils.sheet_to_csv(sheet, { FS: '\t', blankrows: true });

	return { rows, headers, tsv };
}

// ── Main Import Function ────────────────────────────────────────

/**
 * Imports a file and converts it to a `TapirProject`.
 *
 * Auto-detects the file format based on extension and content:
 *   - `.yaml` / `.yml` → YAMA YAML
 *   - `.tsv` → SimpleDSP
 *   - `.csv` → DCTAP if headers contain `shapeID`, else SimpleDSP CSV
 *   - `.xlsx` → determines format from headers
 *
 * @param file - The uploaded File object.
 * @returns The import result with parsed project and any warnings/errors.
 *
 * @example
 * const result = await importFile(fileInput.files[0]);
 * if (result.errors.length === 0) {
 *   currentProject.set(result.project);
 * }
 */
export async function importFile(file: File): Promise<ImportResult> {
	const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
	const projectName = file.name.replace(/\.[^.]+$/, '');

	let result: ImportResult;

	switch (ext) {
		case '.yaml':
		case '.yml':
			result = await importYaml(file, projectName);
			break;

		case '.tsv':
			result = await importSimpleDspTsv(file, projectName);
			break;

		case '.csv':
			result = await importCsv(file, projectName);
			break;

		case '.xlsx':
			result = await importXlsx(file, projectName);
			break;

		default: {
			const emptyProject = createProject({ name: projectName, flavor: 'simpledsp' });
			return {
				project: emptyProject,
				warnings: [],
				errors: [{ message: `Unsupported file format: ${ext}` }],
				format: 'unknown',
			};
		}
	}

	// Run project validation and merge results.
	//
	// "Unknown prefix" errors are common on import (the user often
	// hasn't declared the prefixes their CSV uses) and are now surfaced
	// non-disruptively by the editor's undeclared-prefixes banner with
	// one-click declare actions. Treating them as import errors here
	// would falsely imply the import failed, when the project was in
	// fact parsed successfully and is fully editable.
	//
	// We demote them to warnings; only structural validation errors
	// (broken cardinality, unresolved shape refs, etc.) remain as
	// import errors.
	const validation = validateProject(result.project);
	const isUnknownPrefix = (msg: string) => msg.startsWith('Unknown prefix ');
	const validationErrors = validation.errors.map((e) => ({ message: e.message }));
	result.warnings.push(
		...validation.warnings.map((w) => ({ message: w.message })),
		...validationErrors.filter((e) => isUnknownPrefix(e.message)),
	);
	result.errors.push(
		...validationErrors.filter((e) => !isUnknownPrefix(e.message)),
	);

	return result;
}

// ── Format-Specific Importers ───────────────────────────────────

async function importYaml(file: File, projectName: string): Promise<ImportResult> {
	const text = await readFile(file);
	const result = parseYamaYaml(text, projectName);
	return {
		project: result.data,
		warnings: [...encodingWarnings(text), ...result.warnings],
		errors: result.errors,
		format: 'yaml',
	};
}

async function importSimpleDspTsv(file: File, projectName: string): Promise<ImportResult> {
	const text = await readFile(file);
	const result = parseSimpleDsp(text, projectName);
	return {
		project: result.data,
		warnings: [...encodingWarnings(text), ...result.warnings],
		errors: result.errors,
		format: 'simpledsp',
	};
}

async function importCsv(file: File, projectName: string): Promise<ImportResult> {
	const raw = await readFile(file);
	const mojibake = encodingWarnings(raw);
	// Strip a UTF-8 BOM before sniffing the first line; the parsers
	// handle the BOM themselves, but format detection must not see it.
	const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
	const firstLine = text.split(/\r?\n/)[0] || '';

	// Check if it looks like a tab-separated SimpleDSP (sometimes saved as .csv)
	if (firstLine.startsWith('[') || firstLine.startsWith('#')) {
		const delimiter = firstLine.includes('\t') ? '\t' : ',';
		if (delimiter === '\t') {
			const result = parseSimpleDsp(text, projectName);
			return {
				project: result.data,
				warnings: [...mojibake, ...result.warnings],
				errors: result.errors,
				format: 'simpledsp',
			};
		}
	}

	// Parse as CSV and check headers
	const rows = parseCsvRows(text, ',');
	const headers = rows.length > 0 ? Object.keys(rows[0]) : [];

	if (isDctapFormat(headers)) {
		const dctapRows = rows as DctapRow[];
		const result = dctapRowsToTapir(dctapRows, projectName);
		return {
			project: result.data,
			warnings: [...mojibake, ...result.warnings],
			errors: result.errors,
			format: 'dctap',
		};
	}

	// Fallback: try as SimpleDSP
	const result = parseSimpleDsp(text, projectName);
	return {
		project: result.data,
		warnings: [...mojibake, ...result.warnings],
		errors: result.errors,
		format: 'simpledsp-csv',
	};
}

async function importXlsx(file: File, projectName: string): Promise<ImportResult> {
	const bytes = await readFileBytes(file);
	const { rows, headers, tsv } = await readXlsx(bytes);

	if (isDctapFormat(headers)) {
		const dctapRows = rows as DctapRow[];
		const result = dctapRowsToTapir(dctapRows, projectName);
		return {
			project: result.data,
			warnings: result.warnings,
			errors: result.errors,
			format: 'dctap',
		};
	}

	// Non-DCTAP sheet — treat as SimpleDSP. The TSV serialisation
	// preserves `[@NS]` / `[MAIN]` block markers, which the text parser
	// needs. If the sheet isn't SimpleDSP either, the parser simply
	// yields zero blocks (and the user sees an empty project).
	const result = parseSimpleDsp(tsv, projectName);
	return {
		project: result.data,
		warnings: result.warnings,
		errors: result.errors,
		format: 'simpledsp-xlsx',
	};
}
