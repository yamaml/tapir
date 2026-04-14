/**
 * @fileoverview Diagram DOT generator for Tapir projects.
 *
 * Two diagram styles:
 *   - Detail (default): ER-style tables showing descriptions as entities
 *     with their properties, and relationships as labeled edges.
 *   - Overview: simplified graph showing descriptions as rounded boxes
 *     connected by labeled relationship edges.
 *
 * Output is DOT source text for Graphviz. The actual rendering
 * (SVG, PNG, etc.) is handled separately.
 *
 * Ported from yama-cli `src/modules/diagram.js`.
 *
 * @module converters/diagram-generator
 */

import type { TapirProject, Description, Statement, NamespaceMap } from '$lib/types';
import type { DiagramStyle } from '$lib/types/export';

// ── Color Palettes ──────────────────────────────────────────────

/** Color palette for diagram rendering. */
interface Palette {
	headers: string[];
	headerText: string;
	border: string;
	bodyBg: string;
	stripeBg: string;
	bodyText: string;
	typeText: string;
	refText: string;
	selfRefText: string;
	cardText: string;
	edgeColor: string;
	edgeLabelBg: string;
	edgeLabelText: string;
	graphBg: string;
}

/** Full-color palette. */
export const COLOR_PALETTE: Palette = {
	headers: [
		'#FFCE9F', // peach
		'#B8D4E3', // soft blue
		'#C8E6C9', // sage green
		'#F8CECC', // rose
		'#D1C4E9', // lavender
		'#FFE0B2', // apricot
		'#B2DFDB', // mint
		'#F0F4C3', // lime
	],
	headerText: '#000000',
	border: '#666666',
	bodyBg: '#ffffff',
	stripeBg: '#f5f5f5',
	bodyText: '#333333',
	typeText: '#666666',
	refText: '#1565C0',
	selfRefText: '#6A1B9A',
	cardText: '#888888',
	edgeColor: '#555555',
	edgeLabelBg: '#ffffff',
	edgeLabelText: '#333333',
	graphBg: '#ffffff',
};

/** Black-and-white palette. */
export const BW_PALETTE: Palette = {
	headers: ['#d9d9d9'],
	headerText: '#000000',
	border: '#000000',
	bodyBg: '#ffffff',
	stripeBg: '#f0f0f0',
	bodyText: '#000000',
	typeText: '#444444',
	refText: '#000000',
	selfRefText: '#000000',
	cardText: '#666666',
	edgeColor: '#000000',
	edgeLabelBg: '#ffffff',
	edgeLabelText: '#000000',
	graphBg: '#ffffff',
};

// ── Helpers ─────────────────────────────────────────────────────

/**
 * Compacts a full IRI to prefixed form if a matching namespace exists.
 *
 * @param iri - The IRI to compact.
 * @param namespaces - Prefix-to-URI namespace map.
 * @returns The compacted IRI, or the original if no match found.
 */
export function compactIRI(iri: string | undefined, namespaces: NamespaceMap): string {
	if (!iri) return '';
	const ns = namespaces || {};

	// Already compact (prefix:localName) -- check that prefix is known
	const colon = iri.indexOf(':');
	if (colon > 0 && !iri.startsWith('http') && !iri.startsWith('urn:')) {
		const prefix = iri.slice(0, colon);
		if (prefix in ns) return iri;
	}

	// Try to compact a full IRI against known namespaces
	for (const [prefix, nsUri] of Object.entries(ns)) {
		if (iri.startsWith(nsUri)) return `${prefix}:${iri.slice(nsUri.length)}`;
	}

	return iri;
}

/**
 * Escapes a string for HTML/XML content inside Graphviz HTML-like labels.
 *
 * @param s - The string to escape.
 * @returns The escaped string.
 */
export function esc(s: string | undefined): string {
	if (!s) return '';
	return String(s)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

/**
 * Escapes a string for DOT double-quoted strings (node IDs, port names).
 *
 * @param s - The string to escape.
 * @returns The escaped string.
 */
export function dotEsc(s: string | undefined): string {
	if (!s) return '';
	return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Formats cardinality as a compact range string.
 *
 * @param min - Minimum cardinality.
 * @param max - Maximum cardinality (null = unbounded).
 * @returns Formatted cardinality string (e.g. "0..*", "1", "1..3").
 */
export function formatCard(
	min: number | null | undefined,
	max: number | null | undefined
): string {
	const lo = min != null ? String(min) : '0';
	const hi = max != null ? String(max) : '*';
	if (lo === hi) return lo;
	return `${lo}..${hi}`;
}

/**
 * Determines the type label to display for a statement.
 *
 * @param stmt - The statement.
 * @param ns - Namespace map for compacting IRIs.
 * @returns The display label for the type column.
 */
export function typeLabel(stmt: Statement, ns: NamespaceMap): string {
	if (stmt.shapeRefs && stmt.shapeRefs.length > 0) return stmt.shapeRefs.join(' ');
	if (stmt.datatype) return compactIRI(stmt.datatype, ns);
	if (stmt.valueType === 'iri') return 'URI';
	if (stmt.valueType === 'literal') return 'Literal';
	if (stmt.valueType) return stmt.valueType;
	return '\u00A0';
}

// ── Edge Tracking ───────────────────────────────────────────────

/** A relationship edge between two descriptions. */
interface DiagramEdge {
	from: string;
	fromPort: string;
	to: string;
	card: string;
	prop: string;
}

/** An overview edge (may aggregate multiple relationships). */
interface OverviewEdge {
	from: string;
	to: string;
	labels: string[];
}

// ── Detail DOT Generation ───────────────────────────────────────

/**
 * Builds a detail ER-style DOT diagram from a `TapirProject`.
 *
 * Each description becomes a table node with its statements as rows.
 * Cross-references between descriptions create labeled edges.
 *
 * @param project - The Tapir project.
 * @param mode - Color mode: `"color"` or `"bw"`.
 * @returns DOT source string.
 */
export function buildDot(
	project: TapirProject,
	{ mode = 'color' }: { mode?: 'color' | 'bw' } = {}
): string {
	const pal = mode === 'bw' ? BW_PALETTE : COLOR_PALETTE;
	const ns = project.namespaces || {};
	const descriptions = project.descriptions || [];
	const descNames = descriptions.map((d) => d.name);

	// Pre-scan for cross-references to determine layout
	const hasEdges = descriptions.some((desc) =>
		desc.statements.some(
			(s) => (s.shapeRefs ?? []).some((r) => r !== desc.name && descNames.includes(r))
		)
	);

	const lines: string[] = [];
	lines.push('digraph YAMA {');
	lines.push(`  bgcolor="${pal.graphBg}";`);
	lines.push(`  rankdir=${hasEdges ? 'LR' : 'TB'};`);
	lines.push('  pad="0.6";');
	lines.push(`  nodesep=${hasEdges ? '1.0' : '0.5'};`);
	lines.push(`  ranksep=${hasEdges ? '3.0' : '0.8'};`);
	lines.push('  splines=curved;');
	lines.push('  fontname="Helvetica";');
	lines.push('  node [shape=plaintext fontname="Helvetica"];');
	lines.push('  edge [fontname="Helvetica" fontsize=9];');
	lines.push('');

	const edges: DiagramEdge[] = [];

	for (let di = 0; di < descriptions.length; di++) {
		const desc = descriptions[di];
		const headerBg = pal.headers[di % pal.headers.length];
		const displayName = desc.label || desc.name;
		const rdfClass = desc.targetClass ? compactIRI(desc.targetClass, ns) : '';

		const stmtEntries = desc.statements;

		let label = '<\n';
		label += `    <TABLE BORDER="2" CELLBORDER="0" CELLSPACING="0" CELLPADDING="0" COLOR="${pal.border}" BGCOLOR="${pal.bodyBg}">\n`;

		// Header with PORT for incoming edges
		label += `      <TR><TD COLSPAN="4" BGCOLOR="${headerBg}" CELLPADDING="8" ALIGN="CENTER" PORT="_header">`;
		label += `<FONT POINT-SIZE="14"><B>${esc(displayName)}</B></FONT>`;
		if (rdfClass) {
			label += `<BR/><FONT POINT-SIZE="10" COLOR="${pal.typeText}"><I>${esc(rdfClass)}</I></FONT>`;
		}
		label += '</TD></TR>\n';

		// Separator
		label += '      <HR/>\n';

		// Properties
		if (stmtEntries.length === 0) {
			label += `      <TR><TD COLSPAN="4" CELLPADDING="6"><FONT COLOR="${pal.cardText}" POINT-SIZE="9"><I>no properties</I></FONT></TD></TR>\n`;
		}

		for (let si = 0; si < stmtEntries.length; si++) {
			const stmt = stmtEntries[si];
			const propName = compactIRI(stmt.propertyId, ns) || stmt.id;
			const card = formatCard(stmt.min, stmt.max);
			const type = typeLabel(stmt, ns);
			const rowBg = si % 2 === 1 ? pal.stripeBg : pal.bodyBg;

			const refs = stmt.shapeRefs ?? [];
			const resolvedRefs = refs.filter((r) => descNames.includes(r));
			const hasRef = resolvedRefs.length > 0;
			const isSelfRef = resolvedRefs.length === 1 && resolvedRefs[0] === desc.name;
			let typeCell: string;
			if (isSelfRef) {
				typeCell = `<FONT COLOR="${pal.selfRefText}" POINT-SIZE="9"><B>&#x21BA; ${esc(type)}</B></FONT>`;
			} else if (hasRef) {
				typeCell = `<FONT COLOR="${pal.refText}" POINT-SIZE="9"><B>&#x2192; ${esc(type)}</B></FONT>`;
			} else {
				typeCell = `<FONT COLOR="${pal.typeText}" POINT-SIZE="9">${esc(type)}</FONT>`;
			}

			label += '      <TR>';
			label += `<TD BGCOLOR="${rowBg}" CELLPADDING="5" ALIGN="LEFT"><FONT COLOR="${pal.bodyText}" POINT-SIZE="10"><B>${esc(propName)}</B></FONT></TD>`;
			label += `<TD BGCOLOR="${rowBg}" CELLPADDING="5" ALIGN="LEFT">${typeCell}</TD>`;
			label += `<TD BGCOLOR="${rowBg}" CELLPADDING="5" ALIGN="RIGHT"><FONT COLOR="${pal.cardText}" POINT-SIZE="9">${esc(card)}</FONT></TD>`;
			label += `<TD BGCOLOR="${rowBg}" CELLPADDING="2" WIDTH="2" PORT="${esc(stmt.id)}"></TD>`;
			label += '</TR>\n';

			// One edge per shape ref (excluding self-refs, which get their
			// own curly loop rendering below).
			for (const ref of resolvedRefs) {
				if (ref === desc.name) continue;
				edges.push({
					from: desc.name,
					fromPort: stmt.id,
					to: ref,
					card,
					prop: propName,
				});
			}
		}

		label += '    </TABLE>\n  >';

		lines.push(`  "${dotEsc(desc.name)}" [label=${label}];`);
		lines.push('');
	}

	// Relationship edges: source port -> target header
	for (const edge of edges) {
		lines.push(
			`  "${dotEsc(edge.from)}":"${dotEsc(edge.fromPort)}":e -> "${dotEsc(edge.to)}":"_header":w [` +
				`color="${pal.edgeColor}" ` +
				`penwidth=1.5 ` +
				`arrowhead=normal ` +
				`arrowsize=0.9 ` +
				`label=<` +
				`<TABLE BORDER="0" CELLBORDER="0" CELLSPACING="0" CELLPADDING="2">` +
				`<TR><TD BGCOLOR="${pal.edgeLabelBg}"><FONT FACE="Helvetica" POINT-SIZE="9" COLOR="${pal.edgeLabelText}">${esc(edge.prop)}  [${esc(edge.card)}]</FONT></TD></TR>` +
				`</TABLE>` +
				`> ` +
				`];`
		);
	}

	lines.push('}');
	return lines.join('\n');
}

// ── Overview DOT Generation ─────────────────────────────────────

/**
 * Builds an overview DOT diagram from a `TapirProject`.
 *
 * Descriptions appear as simple rounded boxes. Cross-references
 * between descriptions create labeled edges. Multiple references
 * to the same target are merged into a single edge with multiple
 * label rows.
 *
 * @param project - The Tapir project.
 * @param mode - Color mode: `"color"` or `"bw"`.
 * @returns DOT source string.
 */
export function buildOverviewDot(
	project: TapirProject,
	{ mode = 'color' }: { mode?: 'color' | 'bw' } = {}
): string {
	const pal = mode === 'bw' ? BW_PALETTE : COLOR_PALETTE;
	const ns = project.namespaces || {};
	const descriptions = project.descriptions || [];
	const descNames = descriptions.map((d) => d.name);

	// Pre-collect self-refs per description
	const selfRefs: Record<string, Array<{ prop: string; card: string }>> = {};
	for (const desc of descriptions) {
		selfRefs[desc.name] = [];
		for (const stmt of desc.statements) {
			if ((stmt.shapeRefs ?? []).includes(desc.name)) {
				const propName = compactIRI(stmt.propertyId, ns) || stmt.id;
				const card = formatCard(stmt.min, stmt.max);
				selfRefs[desc.name].push({ prop: propName, card });
			}
		}
	}

	const lines: string[] = [];
	lines.push('digraph YAMA {');
	lines.push(`  bgcolor="${pal.graphBg}";`);
	lines.push('  rankdir=LR;');
	lines.push('  pad="0.6";');
	lines.push('  nodesep=0.8;');
	lines.push('  ranksep=1.5;');
	lines.push('  splines=curved;');
	lines.push('  fontname="Helvetica";');
	lines.push('  node [shape=plaintext fontname="Helvetica"];');
	lines.push(
		`  edge [fontname="Helvetica" fontsize=10 color="${pal.edgeColor}" penwidth=1.5 arrowsize=0.9];`
	);
	lines.push('');

	const edges: OverviewEdge[] = [];
	const edgeMap = new Map<string, OverviewEdge>();

	for (let di = 0; di < descriptions.length; di++) {
		const desc = descriptions[di];
		const headerBg = pal.headers[di % pal.headers.length];
		const displayName = desc.label || desc.name;
		const rdfClass = desc.targetClass ? compactIRI(desc.targetClass, ns) : '';
		const refs = selfRefs[desc.name];

		// Build HTML label with optional self-ref annotation
		let label = '<\n';
		label += `    <TABLE BORDER="2" CELLBORDER="0" CELLSPACING="0" CELLPADDING="0" COLOR="${pal.border}" BGCOLOR="${headerBg}">\n`;
		label += `      <TR><TD CELLPADDING="10" ALIGN="CENTER">`;
		label += `<FONT POINT-SIZE="13"><B>${esc(displayName)}</B></FONT>`;
		if (rdfClass) {
			label += `<BR/><FONT POINT-SIZE="11" COLOR="${pal.typeText}">${esc(rdfClass)}</FONT>`;
		}
		if (refs.length > 0) {
			for (const ref of refs) {
				label += `<BR/><FONT POINT-SIZE="9" COLOR="${pal.selfRefText}"><I>&#x21BA; ${esc(ref.prop)}  [${esc(ref.card)}]</I></FONT>`;
			}
		}
		label += `</TD></TR>\n`;
		label += `    </TABLE>\n  >`;

		lines.push(`  "${dotEsc(desc.name)}" [label=${label}];`);
		lines.push('');

		// Collect cross-references, merging duplicates to same target.
		// A statement with multiple shape refs produces one edge per ref.
		for (const stmt of desc.statements) {
			for (const ref of stmt.shapeRefs ?? []) {
				if (ref === desc.name) continue;
				if (!descNames.includes(ref)) continue;
				const propName = compactIRI(stmt.propertyId, ns) || stmt.id;
				const card = formatCard(stmt.min, stmt.max);
				const key = `${desc.name}->${ref}`;
				if (edgeMap.has(key)) {
					edgeMap.get(key)!.labels.push(`${propName}  [${card}]`);
				} else {
					const entry: OverviewEdge = {
						from: desc.name,
						to: ref,
						labels: [`${propName}  [${card}]`],
					};
					edgeMap.set(key, entry);
					edges.push(entry);
				}
			}
		}
	}

	lines.push('');

	for (const edge of edges) {
		const labelRows = edge.labels
			.map(
				(l) =>
					`<TR><TD BGCOLOR="${pal.edgeLabelBg}"><FONT FACE="Helvetica" POINT-SIZE="10" COLOR="${pal.edgeLabelText}">${esc(l)}</FONT></TD></TR>`
			)
			.join('');
		const labelHtml = `<TABLE BORDER="0" CELLBORDER="0" CELLSPACING="0" CELLPADDING="2">${labelRows}</TABLE>`;
		lines.push(
			`  "${dotEsc(edge.from)}" -> "${dotEsc(edge.to)}" [label=<${labelHtml}>];`
		);
	}

	lines.push('}');
	return lines.join('\n');
}

// ── Public API ──────────────────────────────────────────────────

/**
 * Generates a DOT diagram from a `TapirProject`.
 *
 * @param project - The Tapir project.
 * @param style - Diagram style: `"color"`, `"bw"`, `"overview"`, or `"overview-bw"`.
 * @returns DOT source string.
 *
 * @example
 * const dot = buildDiagram(project, 'color');
 * // Render with Graphviz or write to .dot file
 */
export function buildDiagram(project: TapirProject, style: DiagramStyle = 'color'): string {
	const isOverview = style === 'overview' || style === 'overview-bw';
	const mode = style === 'bw' || style === 'overview-bw' ? 'bw' : 'color';

	return isOverview
		? buildOverviewDot(project, { mode })
		: buildDot(project, { mode });
}
