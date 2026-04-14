/**
 * @fileoverview HTML report generator for Tapir projects.
 *
 * Produces a standalone single-page HTML document documenting an
 * application profile. Styling is inlined (no external CDN) so the
 * generated file works offline and keeps Tapir's privacy contract.
 *
 * Features:
 *   - Table of contents with internal links
 *   - Namespace table with prefix anchors
 *   - Per-description statement tables with cross-links
 *   - Property IRIs linked to external definitions
 *   - Shape references linked to internal description sections
 *   - Optional SVG diagram embedded inline
 *
 * Adapted from yama-cli `src/modules/report.js` for the Tapir
 * data model (TapirProject, Description, Statement).
 *
 * @module converters/report-generator
 */

import type { TapirProject, Description, Statement, NamespaceMap, FlavorLabels } from '$lib/types';
import { getFlavorLabels } from '$lib/types';
import { STANDARD_PREFIXES } from './simpledsp-generator';
import { expandPrefixed } from '$lib/utils/iri-utils';

// ── Inline report stylesheet ────────────────────────────────────

/**
 * Minimal classless stylesheet for generated reports. Kept inline so
 * the exported HTML file is fully self-contained — no CDN fetch, no
 * external dependency, no privacy surprise when a user opens the
 * report offline or shares it with colleagues.
 *
 * Roughly Pico-classless in feel: readable body copy, soft borders,
 * table zebra stripes, accent links. Light/dark via prefers-color-scheme.
 */
const REPORT_CSS = `
:root { color-scheme: light dark; --bg:#fff; --fg:#1d2d35; --muted:#5b7381; --accent:#0172ad; --border:#d7e0e6; --row:#f7fafc; --code:#f0f4f7; }
@media (prefers-color-scheme: dark) { :root { --bg:#11191f; --fg:#e7edf1; --muted:#8ea1ac; --accent:#3ab0ff; --border:#223038; --row:#182127; --code:#1a242c; } }
* { box-sizing: border-box; }
html, body { margin:0; padding:0; }
body { background:var(--bg); color:var(--fg); font:14px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; max-width:1100px; padding:2rem 1.25rem; margin:0 auto; }
h1,h2,h3,h4 { line-height:1.25; margin:1.4em 0 0.4em; font-weight:600; }
h1 { font-size:1.6rem; margin-top:0; }
h2 { font-size:1.2rem; border-bottom:1px solid var(--border); padding-bottom:0.25em; }
h3 { font-size:1rem; }
p { margin:0.5em 0; }
a { color:var(--accent); text-decoration:none; }
a:hover { text-decoration:underline; }
code { background:var(--code); border-radius:3px; padding:0.08em 0.3em; font-family:'SF Mono',Menlo,Consolas,monospace; font-size:0.88em; }
pre { background:var(--code); padding:0.75em; border-radius:4px; overflow-x:auto; }

/* Header block */
header { border-bottom:1px solid var(--border); padding-bottom:1em; margin-bottom:1.5em; }
header p { color:var(--muted); margin:0.25em 0; }

/* Table of Contents: compact, hierarchical, no bullets */
nav { background:var(--row); border:1px solid var(--border); border-radius:6px; padding:0.75em 1em; margin:1em 0 1.5em; }
nav h2 { font-size:0.85rem; text-transform:uppercase; letter-spacing:0.05em; margin:0 0 0.5em; border:none; padding:0; color:var(--muted); }
nav ul { list-style:none; padding:0; margin:0; }
nav li { margin:0.15em 0; padding:0; line-height:1.5; }
nav ul ul { padding-left:1.25em; margin:0.15em 0 0.4em; border-left:2px solid var(--border); }
nav a { display:inline-block; padding:0.05em 0; }

/* Tables use native display so column alignment stays consistent
   across all rows. When a table is genuinely wider than the page,
   the enclosing <section> wrapper scrolls horizontally so the
   layout doesn't collapse. */
section { overflow-x:auto; }
table { border-collapse:collapse; margin:0.75em 0; font-size:0.88em; width:100%; }
th, td { text-align:left; padding:0.4em 0.55em; border-bottom:1px solid var(--border); vertical-align:top; word-break:break-word; }
th { background:var(--row); font-weight:600; white-space:nowrap; }
tr:nth-child(even) td { background:var(--row); }
td code { white-space:nowrap; }

/* Diagram: scale the embedded SVG to fit the page. The source SVG
   has explicit width/height attributes; the !important overrides
   those so the image never bursts the column. */
figure { margin:1em 0; text-align:center; }
figure svg { max-width:100% !important; height:auto !important; width:auto !important; display:inline-block; }

aside { border-left:3px solid var(--border); padding:0.4em 0.8em; color:var(--muted); margin:1em 0; font-size:0.9em; }
hr { border:none; border-top:1px solid var(--border); margin:2em 0; }
footer { margin-top:2em; padding-top:1em; border-top:1px solid var(--border); color:var(--muted); font-size:0.85em; }
section { margin:1.5em 0; }
@media (max-width:640px) { body { padding:1rem 0.75rem; } table { font-size:0.82em; } h1 { font-size:1.35rem; } }
`;

// ── Helpers ─────────────────────────────────────────────────────

/**
 * Escapes a string for safe use in HTML content.
 *
 * @param s - The string to escape.
 * @returns The escaped string.
 */
function escHtml(s: string | undefined | null): string {
	if (!s) return '';
	return String(s)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

/**
 * Creates a URL-safe slug from a description name for use as HTML ID.
 *
 * @param name - The description name.
 * @returns A lowercase slug with non-alphanumeric characters replaced by hyphens.
 */
function descSlug(name: string): string {
	return name.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
}

/**
 * Returns the current date as an ISO date string (YYYY-MM-DD).
 */
function today(): string {
	return new Date().toISOString().split('T')[0];
}

/**
 * Resolves the display type for a statement using flavor-specific labels.
 *
 * Maps Tapir's flavor-neutral fields to a human-readable type label:
 *   - `datatype` present -> the datatype CURIE
 *   - `valueType === 'iri'` -> flavor label (e.g. "IRI")
 *   - `valueType === 'literal'` -> flavor label (e.g. "literal")
 *   - `valueType === 'bnode'` -> flavor label (e.g. "bnode")
 *   - Otherwise -> empty
 *
 * @param stmt - The statement.
 * @param labels - The flavor-specific labels.
 * @returns The display type string.
 */
function resolveType(stmt: Statement, labels: FlavorLabels): string {
	if (stmt.datatype) return stmt.datatype;
	if (stmt.valueType === 'iri') return labels.valueTypes.iri;
	if (stmt.valueType === 'literal') return labels.valueTypes.literal;
	if (stmt.valueType === 'bnode') return labels.valueTypes.bnode;
	if (stmt.valueType) return stmt.valueType;
	return '';
}

/**
 * Resolves the constraint display string for a statement.
 *
 * Checks fields in priority order:
 *   1. `shapeRefs` -> comma-separated shape names
 *   2. `classConstraint` -> comma-separated class names
 *   3. `inScheme` -> comma-separated scheme URIs
 *   4. `values` with `valueType === 'iri'` -> unquoted URIs
 *   5. `values` with `valueType === 'literal'` -> quoted strings
 *   6. `pattern` -> regex pattern
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

// ── Generator ───────────────────────────────────────────────────

/**
 * Generates a standalone HTML report documenting a Tapir application profile.
 *
 * Uses Pico CSS classless variant via CDN for zero-config styling.
 * The SVG diagram (if provided) is embedded inline in a `<figure>`.
 *
 * @param project - The Tapir project.
 * @param svgDiagram - Optional SVG string for the overview diagram.
 * @returns Complete HTML document string.
 *
 * @example
 * const html = generateHtmlReport(project, svgString);
 * downloadText(html, 'report.html', 'text/html');
 */
export function generateHtmlReport(project: TapirProject, svgDiagram?: string): string {
	const namespaces = project.namespaces || {};
	const allNs: NamespaceMap = { ...STANDARD_PREFIXES, ...namespaces };
	const base = project.base || '';
	const descriptions = project.descriptions || [];
	const descNames = descriptions.map((d) => d.name);
	const profileName = project.name || 'Profile';
	const date = today();
	const flavor = project.flavor || 'simpledsp';
	const labels = getFlavorLabels(flavor);
	const isDctap = flavor === 'dctap';

	const lines: string[] = [];

	// ── Head ──

	lines.push('<!DOCTYPE html>');
	lines.push('<html lang="en">');
	lines.push('<head>');
	lines.push('  <meta charset="utf-8">');
	lines.push('  <meta name="viewport" content="width=device-width, initial-scale=1">');
	lines.push(`  <title>${escHtml(profileName)} — Application Profile</title>`);
	// Inline CSS — no third-party CDN so the exported report is fully
	// self-contained and respects Tapir's privacy model. A minimal
	// Pico-inspired classless theme: body readability, soft borders on
	// tables, nav/header/aside layout. Users can restyle freely.
	lines.push('  <style>');
	lines.push(REPORT_CSS);
	lines.push('  </style>');
	lines.push('</head>');
	lines.push('<body>');

	// ── Header ──

	lines.push('<header>');
	lines.push(`  <h1>${escHtml(profileName)}</h1>`);
	lines.push(`  <p>Application Profile (${labels.specName}) · Generated ${date}</p>`);
	if (base) {
		lines.push(
			`  <p>Base: <a href="${escHtml(base)}"><code>${escHtml(base)}</code></a></p>`
		);
	}
	lines.push('</header>');

	// ── Main ──

	lines.push('<main>');

	// ── Table of Contents ──

	lines.push('<nav>');
	lines.push('  <h2>Contents</h2>');
	lines.push('  <ul>');
	if (svgDiagram) {
		lines.push('    <li><a href="#overview">Overview Diagram</a></li>');
	}
	lines.push('    <li><a href="#namespaces">Namespaces</a></li>');
	if (descriptions.length > 0) {
		lines.push(`    <li>${escHtml(labels.descriptionPlural)}`);
		lines.push('      <ul>');
		for (const desc of descriptions) {
			const displayName = desc.label || desc.name;
			const slug = descSlug(desc.name);
			lines.push(`        <li><a href="#desc-${slug}">${escHtml(displayName)}</a></li>`);
		}
		lines.push('      </ul>');
		lines.push('    </li>');
	}
	lines.push('  </ul>');
	lines.push('</nav>');

	// ── Overview Diagram ──

	if (svgDiagram) {
		lines.push('<section id="overview">');
		lines.push('  <h2>Overview Diagram</h2>');
		lines.push('  <figure>');
		lines.push(`    ${svgDiagram}`);
		lines.push('  </figure>');
		lines.push('</section>');
	}

	// ── Namespaces ──

	lines.push('<section id="namespaces">');
	lines.push('  <h2>Namespaces</h2>');
	lines.push('  <table>');
	lines.push('    <thead><tr><th>Prefix</th><th>Namespace URI</th></tr></thead>');
	lines.push('    <tbody>');
	for (const [prefix, uri] of Object.entries(namespaces)) {
		lines.push(
			`      <tr><td><a id="ns-${escHtml(prefix)}"><code>${escHtml(prefix)}</code></a></td>` +
				`<td><a href="${escHtml(uri)}"><code>${escHtml(uri)}</code></a></td></tr>`
		);
	}
	lines.push('    </tbody>');
	lines.push('  </table>');
	lines.push('</section>');

	// ── Description Sections ──

	for (const desc of descriptions) {
		const displayName = desc.label || desc.name;
		const slug = descSlug(desc.name);

		lines.push(`<section id="desc-${slug}">`);
		lines.push(`  <h2>${escHtml(displayName)}</h2>`);

		// Target class
		if (desc.targetClass) {
			const classIri = expandPrefixed(desc.targetClass, allNs, base);
			lines.push(
				`  <p>Target class: <a href="${escHtml(classIri || '')}"><code>${escHtml(desc.targetClass)}</code></a></p>`
			);
		}

		// Description note
		if (desc.note) {
			lines.push(`  <p>${escHtml(desc.note)}</p>`);
		}

		// Statements table
		if (desc.statements.length > 0) {
			const col = labels.columns;
			lines.push('  <table>');
			lines.push('    <thead><tr>');
			lines.push(
				`      <th>${escHtml(col.name)}</th><th>${escHtml(col.property)}</th><th>${escHtml(col.min)}</th><th>${escHtml(col.max)}</th><th>${escHtml(col.valueType)}</th><th>${escHtml(col.constraint)}</th><th>${escHtml(col.note)}</th>`
			);
			lines.push('    </tr></thead>');
			lines.push('    <tbody>');

			for (const stmt of desc.statements) {
				const stmtName = stmt.label || stmt.id;
				const property = stmt.propertyId || '';
				const propertyIri = expandPrefixed(property, allNs, base);
				// DCTAP: show mandatory/repeatable as TRUE/FALSE
				// SimpleDSP: show min/max as numbers
				let minDisplay: string;
				let maxDisplay: string;
				if (isDctap) {
					minDisplay = (stmt.min != null && stmt.min >= 1) ? 'TRUE' : 'FALSE';
					maxDisplay = (stmt.max == null || stmt.max > 1) ? 'TRUE' : 'FALSE';
				} else {
					minDisplay = stmt.min != null ? String(stmt.min) : '0';
					maxDisplay = stmt.max != null ? String(stmt.max) : '*';
				}
				const type = resolveType(stmt, labels);
				const constraint = resolveConstraint(stmt);
				const note = stmt.note || '';

				// Property cell: linked to external URI
				const propertyCell = propertyIri
					? `<a href="${escHtml(propertyIri)}"><code>${escHtml(property)}</code></a>`
					: `<code>${escHtml(property)}</code>`;

				// Constraint cell: shape references link internally, others are plain.
				// Multi-shape disjunctions render as comma-separated internal links.
				let constraintCell: string;
				const knownRefs = (stmt.shapeRefs ?? []).filter((r) => descNames.includes(r));
				if (knownRefs.length > 0) {
					const links = knownRefs.map((r) => {
						const refDesc = descriptions.find((d) => d.name === r);
						const refLabel = refDesc?.label || r;
						return `<a href="#desc-${descSlug(r)}">&rarr; ${escHtml(refLabel)}</a>`;
					});
					constraintCell = links.join(', ');
				} else if (constraint) {
					constraintCell = `<code>${escHtml(constraint)}</code>`;
				} else {
					constraintCell = '';
				}

				// Type cell: if it contains a colon, link to its expanded IRI
				let typeCell: string;
				if (type && type.includes(':')) {
					const typeIri = expandPrefixed(type, allNs, base);
					typeCell = typeIri
						? `<a href="${escHtml(typeIri)}"><code>${escHtml(type)}</code></a>`
						: `<code>${escHtml(type)}</code>`;
				} else {
					typeCell = escHtml(type);
				}

				lines.push('      <tr>');
				lines.push(`        <td>${escHtml(stmtName)}</td>`);
				lines.push(`        <td>${propertyCell}</td>`);
				lines.push(`        <td>${escHtml(minDisplay)}</td>`);
				lines.push(`        <td>${escHtml(maxDisplay)}</td>`);
				lines.push(`        <td>${typeCell}</td>`);
				lines.push(`        <td>${constraintCell}</td>`);
				lines.push(`        <td>${escHtml(note)}</td>`);
				lines.push('      </tr>');
			}

			lines.push('    </tbody>');
			lines.push('  </table>');
		} else {
			lines.push('  <p><em>No statements defined.</em></p>');
		}

		lines.push('</section>');
	}

	lines.push('</main>');

	// ── Footer ──

	lines.push('<footer>');
	lines.push(`  <p>Application Profile (${escHtml(labels.specName)}) · Generated with <a href="https://www.yamaml.org">YAMA</a> · ${date}</p>`);
	lines.push('</footer>');

	lines.push('</body>');
	lines.push('</html>');

	return lines.join('\n');
}
