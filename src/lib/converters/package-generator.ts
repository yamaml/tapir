/**
 * @fileoverview Profile Package (ZIP) generator.
 *
 * Bundles all profile artifacts into a single ZIP file for download.
 * Uses `fflate` for browser-side ZIP creation.
 *
 * Included artifacts:
 *   - `index.html`      — HTML report with embedded diagram
 *   - `profile.md`      — Markdown documentation
 *   - `README.md`       — Format descriptions with spec links
 *   - `profile.yaml`    — YAMA YAML source
 *   - `profile.json`    — JSON representation
 *   - `simpledsp.tsv`   — SimpleDSP (English)
 *   - `simpledsp-jp.tsv` — SimpleDSP (Japanese)
 *   - `dctap.csv`       — DCTAP CSV
 *   - `shacl.ttl`       — SHACL shapes (Turtle)
 *   - `shex.shex`       — ShEx shapes
 *   - `owldsp.ttl`      — OWL-DSP (Turtle)
 *   - `diagram.svg`     — Overview diagram (if provided)
 *   - `diagram.pdf`     — Overview diagram as vector PDF (if the SVG converts)
 *
 * Optional artifacts that fail to generate are dropped from the ZIP
 * with a `GeneratorWarning`, and the bundled README lists only the
 * files actually included.
 *
 * @module converters/package-generator
 */

import { zipSync, strToU8 } from 'fflate';
import type { TapirProject, Description, Statement } from '$lib/types';
import type { GeneratorWarning } from '$lib/types/export';
import { getFlavorLabels } from '$lib/types';
import { generateHtmlReport } from './report-generator';
import { buildYamaYaml } from './yaml-generator';
import { buildYamaJson } from './json-generator';
import { buildSimpleDsp } from './simpledsp-generator';
import { buildDctapRows, DCTAP_COLUMNS } from './dctap-generator';
import { buildShacl } from './shacl-generator';
import { buildShExC } from './shex-generator';
import { buildOwlDsp } from './owldsp-generator';

// ── Markdown Report ─────────────────────────────────────────────

/**
 * Resolves a human-readable display type for a statement (Markdown output).
 *
 * @param stmt - The statement.
 * @returns The display type string.
 */
function resolveType(stmt: Statement): string {
	if (stmt.datatype && stmt.datatype.length > 0) return stmt.datatype.join(' ');
	if (stmt.valueType === 'iri') return 'IRI';
	if (stmt.valueType === 'literal') return 'literal';
	if (stmt.valueType === 'bnode') return 'bnode';
	if (stmt.valueType) return stmt.valueType;
	return '';
}

/**
 * Resolves the constraint display string for a statement (Markdown output).
 *
 * @param stmt - The statement.
 * @returns The constraint string.
 */
function resolveConstraint(stmt: Statement): string {
	if (stmt.shapeRefs && stmt.shapeRefs.length > 0) return stmt.shapeRefs.join(', ');
	if (stmt.classConstraint.length > 0) return stmt.classConstraint.join(', ');
	if (stmt.inScheme.length > 0) return stmt.inScheme.join(', ');
	if (Array.isArray(stmt.values) && stmt.values.length > 0) {
		if (stmt.valueType === 'iri') return stmt.values.join(', ');
		return stmt.values.map((v) => `"${v}"`).join(', ');
	}
	if (stmt.pattern) return `/${stmt.pattern}/`;
	return '';
}

/**
 * Generates a Markdown documentation report from a TapirProject.
 *
 * Mirrors the structure of the HTML report: namespaces table,
 * per-description sections with statement tables.
 *
 * @param project - The Tapir project.
 * @returns Markdown string.
 */
function generateMarkdownReport(project: TapirProject): string {
	const namespaces = project.namespaces || {};
	const descriptions = project.descriptions || [];
	const profileName = project.name || 'Profile';
	const date = new Date().toISOString().split('T')[0];
	const flavor = project.flavor || 'simpledsp';
	const labels = getFlavorLabels(flavor);
	const isDctap = flavor === 'dctap';
	const lines: string[] = [];

	lines.push(`# ${profileName}`);
	lines.push('');
	lines.push(`Application Profile (${labels.specName})`);
	lines.push('');

	if (project.base) {
		lines.push(`**Base:** \`${project.base}\``);
		lines.push('');
	}

	// Table of contents
	lines.push('## Contents');
	lines.push('');
	lines.push('- [Namespaces](#namespaces)');
	for (const desc of descriptions) {
		const displayName = desc.label || desc.name;
		lines.push(`- [${displayName}](#${desc.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')})`);
	}
	lines.push('');

	// Namespaces
	if (Object.keys(namespaces).length > 0) {
		lines.push('## Namespaces');
		lines.push('');
		lines.push('| Prefix | Namespace URI |');
		lines.push('|--------|---------------|');
		for (const [prefix, uri] of Object.entries(namespaces)) {
			lines.push(`| \`${prefix}\` | \`${uri}\` |`);
		}
		lines.push('');
	}

	// Description sections
	for (const desc of descriptions) {
		const displayName = desc.label || desc.name;
		lines.push(`## ${displayName}`);
		lines.push('');

		if (desc.targetClass) {
			lines.push(`**Target class:** \`${desc.targetClass}\``);
			lines.push('');
		}

		if (desc.note) {
			lines.push(desc.note);
			lines.push('');
		}

		if (desc.statements.length > 0) {
			const col = labels.columns;
			lines.push(`| ${col.name} | ${col.property} | ${col.min} | ${col.max} | ${col.valueType} | ${col.constraint} | ${col.note} |`);
			lines.push('|------|----------|-----|-----|-----------|------------|------|');

			for (const stmt of desc.statements) {
				const name = stmt.label || stmt.id;
				const prop = stmt.propertyId ? `\`${stmt.propertyId}\`` : '';

				let minDisplay: string;
				let maxDisplay: string;
				if (isDctap) {
					minDisplay = stmt.min != null && stmt.min >= 1 ? 'TRUE' : 'FALSE';
					maxDisplay = stmt.max == null || stmt.max > 1 ? 'TRUE' : 'FALSE';
				} else {
					minDisplay = stmt.min != null ? String(stmt.min) : '0';
					maxDisplay = stmt.max != null ? String(stmt.max) : '*';
				}

				const type = resolveType(stmt);
				const constraint = resolveConstraint(stmt);
				const note = stmt.note || '';

				lines.push(`| ${name} | ${prop} | ${minDisplay} | ${maxDisplay} | ${type} | ${constraint} | ${note} |`);
			}
			lines.push('');
		} else {
			lines.push('*No statements defined.*');
			lines.push('');
		}
	}

	lines.push('---');
	lines.push(`Generated ${date} with [YAMA](https://www.yamaml.org)`);
	lines.push('');

	return lines.join('\n');
}

// ── DCTAP CSV ───────────────────────────────────────────────────

/**
 * Serializes DCTAP rows to CSV string.
 *
 * @param project - The Tapir project.
 * @param warnings - Optional accumulator for lossy-mapping warnings.
 * @returns CSV string with header row.
 */
function buildDctapCsv(project: TapirProject, warnings?: GeneratorWarning[]): string {
	const rows = buildDctapRows(project, { warnings });
	const header = DCTAP_COLUMNS.join(',');
	const body = rows
		.map((row) =>
			DCTAP_COLUMNS.map((col) => {
				const val = row[col] || '';
				if (val.includes(',') || val.includes('"') || val.includes('\n')) {
					return `"${val.replace(/"/g, '""')}"`;
				}
				return val;
			}).join(',')
		)
		.join('\n');
	return `${header}\n${body}\n`;
}

// ── README ──────────────────────────────────────────────────────

/**
 * README table rows for every artifact the package can contain, in
 * canonical order. `generatePackageReadme` filters this list down to
 * the files actually present in the ZIP.
 */
const ARTIFACT_ROWS: ReadonlyArray<{ file: string; format: string; description: string }> = [
	{ file: 'index.html', format: 'HTML', description: 'Profile documentation with embedded diagram' },
	{ file: 'profile.md', format: 'Markdown', description: 'Profile documentation' },
	{ file: 'profile.yaml', format: 'YAMAML', description: 'Source profile ([spec](https://www.yamaml.org))' },
	{ file: 'profile.json', format: 'JSON', description: 'JSON representation' },
	{ file: 'simpledsp.tsv', format: 'SimpleDSP', description: 'Tab-separated schema definition' },
	{ file: 'simpledsp-jp.tsv', format: 'SimpleDSP', description: 'Japanese headers and value types' },
	{ file: 'dctap.csv', format: 'DCTAP', description: 'DC Tabular Application Profile ([spec](https://dcmi.github.io/dctap/))' },
	{ file: 'shacl.ttl', format: 'SHACL', description: 'Shapes Constraint Language ([spec](https://www.w3.org/TR/shacl/))' },
	{ file: 'shex.shex', format: 'ShEx', description: 'Shape Expressions ([spec](https://shex.io/))' },
	{ file: 'owldsp.ttl', format: 'OWL-DSP', description: 'Description Set Profile as OWL ([spec](https://docs.yamaml.org/specs/owl-dsp/))' },
	{ file: 'diagram.svg', format: 'SVG', description: 'Overview diagram' },
	{ file: 'diagram.pdf', format: 'PDF', description: 'Overview diagram (vector PDF)' },
];

/**
 * Generates the README.md content for the profile package.
 *
 * Lists only the artifacts actually included in the ZIP, with format
 * descriptions and spec links — an artifact whose generator failed
 * must not appear here. Exported so the file-list logic can be
 * unit-tested without fabricating generator failures.
 *
 * @param projectName - The project name.
 * @param includedFiles - Filenames actually present in the ZIP.
 * @returns README markdown string.
 *
 * @example
 * generatePackageReadme('My Profile', ['index.html', 'dctap.csv']);
 * // README table lists only index.html and dctap.csv
 */
export function generatePackageReadme(
	projectName: string,
	includedFiles: readonly string[]
): string {
	const date = new Date().toISOString().split('T')[0];
	const included = new Set(includedFiles);
	const fileRows = ARTIFACT_ROWS.filter((row) => included.has(row.file))
		.map((row) => `| \`${row.file}\` | ${row.format} | ${row.description} |`)
		.join('\n');

	return `# ${projectName}

Application profile package generated with [YAMA](https://www.yamaml.org).

## Files

| File | Format | Description |
|------|--------|-------------|
${fileRows}

For Data Package output, use the CLI: \`yama package -i profile.yaml -o dist/\`

## Generated

${date} with [YAMA](https://www.yamaml.org)
`;
}

// ── Main Generator ──────────────────────────────────────────────

/**
 * Generates a ZIP file containing all profile artifacts.
 *
 * Calls each converter to produce text content, then bundles
 * everything into a ZIP using fflate. When an optional artifact
 * (SHACL, OWL-DSP, diagram PDF) fails to generate, it is dropped
 * from the archive, a warning naming the artifact is pushed to the
 * accumulator, and the bundled README lists only the files actually
 * included.
 *
 * @param project - The Tapir project to export.
 * @param svgDiagram - Optional SVG diagram string.
 * @param warnings - Optional accumulator for lossy-mapping and
 *   skipped-artifact warnings (same contract as the other generators).
 * @returns ZIP file as a Uint8Array.
 *
 * @example
 * const warnings: GeneratorWarning[] = [];
 * const zip = await generatePackageZip(project, svgString, warnings);
 * downloadBlob(new Blob([zip]), 'profile.zip');
 */
export async function generatePackageZip(
	project: TapirProject,
	svgDiagram?: string,
	warnings?: GeneratorWarning[]
): Promise<Uint8Array> {
	const projectName = project.name || 'Profile';

	// Generate all text artifacts, threading the caller's warning
	// accumulator through every generator that supports one.
	const htmlContent = generateHtmlReport(project, svgDiagram);
	const mdContent = generateMarkdownReport(project);
	const yamlContent = buildYamaYaml(project);
	const jsonContent = buildYamaJson(project);
	const simpleDspContent = buildSimpleDsp(project, { lang: 'en', warnings });
	const simpleDspJpContent = buildSimpleDsp(project, { lang: 'jp', warnings });
	const dctapContent = buildDctapCsv(project, warnings);
	const shexContent = buildShExC(project, warnings);

	// SHACL and OWL-DSP are async (N3 serialization). A failure must
	// not sink the whole package, but it must not be silent either:
	// the artifact is dropped, a warning names it, and the README
	// below lists only what actually made it into the archive.
	let shaclContent = '';
	try {
		shaclContent = await buildShacl(project, 'turtle', warnings);
	} catch {
		warnings?.push({
			message: 'shacl.ttl could not be generated and was left out of the package',
		});
	}

	let owlDspContent = '';
	try {
		owlDspContent = await buildOwlDsp(project, 'turtle', warnings);
	} catch {
		warnings?.push({
			message: 'owldsp.ttl could not be generated and was left out of the package',
		});
	}

	// Build file map
	const files: Record<string, Uint8Array> = {
		'index.html': strToU8(htmlContent),
		'profile.md': strToU8(mdContent),
		'profile.yaml': strToU8(yamlContent),
		'profile.json': strToU8(jsonContent),
		'simpledsp.tsv': strToU8(simpleDspContent),
		'simpledsp-jp.tsv': strToU8(simpleDspJpContent),
		'dctap.csv': strToU8(dctapContent),
		'shex.shex': strToU8(shexContent),
	};

	if (shaclContent) {
		files['shacl.ttl'] = strToU8(shaclContent);
	}

	if (owlDspContent) {
		files['owldsp.ttl'] = strToU8(owlDspContent);
	}

	// Only include diagram if provided
	if (svgDiagram) {
		files['diagram.svg'] = strToU8(svgDiagram);
		// Also bundle a vector PDF of the diagram — same content as
		// the SVG, but in a form LaTeX users can `\includegraphics`
		// directly and archivists can rely on years from now. The
		// PDF path lazy-loads `jspdf` + `svg2pdf.js`, so it's only
		// brought in when a user actually builds a package.
		try {
			const { svgToPdfBlob } = await import('$lib/utils/svg-to-pdf');
			const pdfBlob = await svgToPdfBlob(svgDiagram);
			const pdfBytes = new Uint8Array(await pdfBlob.arrayBuffer());
			files['diagram.pdf'] = pdfBytes;
		} catch {
			// PDF generation can fail (e.g. in a headless environment
			// without full DOM text metrics). The SVG is already in the
			// package, so the archive is still useful — but say so.
			warnings?.push({
				message:
					'diagram.pdf could not be generated and was left out of the package (diagram.svg is still included)',
			});
		}
	}

	// README reflects exactly what made it into the archive.
	files['README.md'] = strToU8(generatePackageReadme(projectName, Object.keys(files)));

	return zipSync(files);
}
