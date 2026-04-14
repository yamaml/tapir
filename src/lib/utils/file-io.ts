/**
 * @fileoverview Browser file I/O utilities.
 *
 * Provides functions for downloading generated content and reading
 * uploaded files in the browser environment.
 *
 * @module utils/file-io
 */

// ── Download Functions ──────────────────────────────────────────

/**
 * Triggers a browser download of a text string as a file.
 *
 * Creates a temporary `<a>` element with an object URL, clicks it
 * to trigger the download, then cleans up.
 *
 * @param content - The text content to download.
 * @param filename - The filename for the download.
 * @param mimeType - MIME type (default: `'text/plain'`).
 *
 * @example
 * downloadText(csvContent, 'export.csv', 'text/csv');
 */
export function downloadText(
	content: string,
	filename: string,
	mimeType: string = 'text/plain'
): void {
	const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
	downloadBlob(blob, filename);
}

/**
 * Triggers a browser download of a Blob as a file.
 *
 * @param blob - The Blob to download.
 * @param filename - The filename for the download.
 *
 * @example
 * const blob = new Blob([svgContent], { type: 'image/svg+xml' });
 * downloadBlob(blob, 'diagram.svg');
 */
export function downloadBlob(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob);
	const link = document.createElement('a');
	link.href = url;
	link.download = filename;
	link.style.display = 'none';
	document.body.appendChild(link);
	link.click();

	// Clean up after a short delay to ensure download initiates
	setTimeout(() => {
		URL.revokeObjectURL(url);
		document.body.removeChild(link);
	}, 100);
}

// ── Read Functions ──────────────────────────────────────────────

/**
 * Reads a File object as a UTF-8 text string.
 *
 * @param file - The File to read.
 * @returns Promise resolving to the file's text content.
 *
 * @example
 * const text = await readFile(inputElement.files[0]);
 */
export function readFile(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result as string);
		reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`));
		reader.readAsText(file);
	});
}

/**
 * Reads a File object as a Uint8Array (binary).
 *
 * @param file - The File to read.
 * @returns Promise resolving to the file's binary content.
 *
 * @example
 * const bytes = await readFileBytes(inputElement.files[0]);
 */
export function readFileBytes(file: File): Promise<Uint8Array> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
		reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`));
		reader.readAsArrayBuffer(file);
	});
}

// ── MIME Type Helpers ───────────────────────────────────────────

/** Maps file extensions to MIME types for downloads. */
export const MIME_TYPES: Record<string, string> = {
	'.tsv': 'text/tab-separated-values',
	'.csv': 'text/csv',
	'.yaml': 'text/yaml',
	'.yml': 'text/yaml',
	'.json': 'application/json',
	'.ttl': 'text/turtle',
	'.shex': 'text/shex',
	'.svg': 'image/svg+xml',
	'.dot': 'text/vnd.graphviz',
	'.png': 'image/png',
};

/**
 * Returns the MIME type for a given filename based on its extension.
 *
 * @param filename - The filename to check.
 * @returns The MIME type string, or `'application/octet-stream'` if unknown.
 */
export function getMimeType(filename: string): string {
	const ext = filename.slice(filename.lastIndexOf('.'));
	return MIME_TYPES[ext] || 'application/octet-stream';
}
