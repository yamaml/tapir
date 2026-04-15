/**
 * @fileoverview Standalone SVG builder for diagram exports.
 *
 * Produces a self-contained SVG string — the same output the Export
 * dialog feeds to its PDF/PNG/SVG download buttons — from a `TapirProject`
 * plus the shared `DiagramSettings`. Extracted from `export-dialog.svelte`
 * so the in-editor diagram panel's settings popover can share the same
 * export pipeline without duplicating ~300 lines of Elk/SVG plumbing.
 *
 * Key design notes:
 *
 * - **Per-statement ports** keep cross-reference edges anchored to the
 *   correct source row rather than the node's geometric centre.
 * - **Font declarations are explicit on every `<text>`** so svg2pdf.js
 *   resolves them against the registered Inter / JetBrains Mono fonts
 *   rather than falling back to Times-Roman.
 * - **Edge labels use `text-anchor="start"` with a pre-computed left x**
 *   so svg2pdf's internal text-width measurement can't drift the label
 *   relative to its background rect.
 *
 * @module converters/export-svg-builder
 */

import type { TapirProject } from '$lib/types';
import type { DiagramSettings } from '$lib/stores/diagram-settings-store';
import {
	compactIRI,
	formatCard,
	typeLabel,
	COLOR_PALETTE,
	BW_PALETTE,
} from './diagram-generator';
import { safeTextWidth } from '$lib/utils/text-measure';
import { roundedPath, pointAlongPath } from '$lib/utils/edge-path';
import ELK from 'elkjs/lib/elk.bundled.js';

const elk = new ELK();

// ── Geometry constants ──────────────────────────────────────────

const HEADER_H = 48;
const ROW_H = 26;
const BASE_W = 280;
const PAD = 40;
const NODE_PAD_H = 14;
const CARD_COL_W = 44;
const SELF_LOOP_R = 8;

// ── Helpers ─────────────────────────────────────────────────────

function esc(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

// ── Public API ──────────────────────────────────────────────────

/**
 * Generates a standalone SVG string using Elk.js layout. Driven by
 * `settings` for palette, display toggles, and style.
 *
 * Callers wanting the archive-grade defaults (everything on, colour)
 * can import `DEFAULT_DIAGRAM_SETTINGS` from the store module.
 *
 * @param proj - The Tapir project to render.
 * @param settings - Display configuration from the shared store.
 * @returns A full `<?xml?>`-prefixed SVG document.
 */
export async function buildExportSvg(
	proj: TapirProject,
	settings: DiagramSettings,
): Promise<string> {
	const pal = settings.palette === 'bw' ? BW_PALETTE : COLOR_PALETTE;
	const ns = proj.namespaces || {};
	const descriptions = proj.descriptions || [];
	const descNames = new Set(descriptions.map((d) => d.name));

	if (descriptions.length === 0) {
		return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200"><text x="200" y="100" text-anchor="middle" fill="#999" font-size="14" font-family="Inter, sans-serif">No descriptions</text></svg>';
	}

	interface ElkChild {
		id: string;
		width: number;
		height: number;
		ports?: Array<{ id: string; x: number; y: number; width: number; height: number }>;
		properties?: Record<string, string>;
	}

	const children: ElkChild[] = [];
	const edges: Array<{ id: string; sources: string[]; targets: string[] }> = [];
	const nodeMeta = new Map<string, { desc: typeof descriptions[0]; headerColor: string; stmts: Array<{ id: string; prop: string; label: string; tl: string; card: string; isRef: boolean; isSelfRef: boolean }> }>();
	const edgeMeta = new Map<string, { prop: string; label: string; card: string }>();
	let ei = 0;

	for (let i = 0; i < descriptions.length; i++) {
		const desc = descriptions[i];
		const stmts = desc.statements.map((s) => {
			const prop = compactIRI(s.propertyId, ns) || s.id;
			const refs = s.shapeRefs ?? [];
			const resolved = refs.filter((r) => descNames.has(r));
			const isRef = resolved.length > 0;
			const isSelfRef = resolved.length === 1 && resolved[0] === desc.name;
			return { id: s.id, prop, label: s.label || '', tl: typeLabel(s, ns), card: formatCard(s.min, s.max), isRef, isSelfRef };
		});

		let maxPropW = 0, maxTypeW = 0;
		for (const s of stmts) {
			maxPropW = Math.max(maxPropW, safeTextWidth(s.prop, 10, 'bold', 'mono'));
			const prefix = s.isSelfRef ? '\u21BA ' : (s.isRef ? '\u2192 ' : '');
			maxTypeW = Math.max(maxTypeW, safeTextWidth(prefix + s.tl, 9, 'normal'));
		}
		const contentW = NODE_PAD_H + maxPropW + 20 + maxTypeW + CARD_COL_W + NODE_PAD_H;
		const headerLabelW = safeTextWidth(desc.label || desc.name, 12, 'bold') + 40;
		const w = Math.max(BASE_W, contentW, headerLabelW);
		const h = HEADER_H + Math.max(stmts.length, 1) * ROW_H + 6;
		const nid = `n${i}`;

		const ports = desc.statements.map((s, si) => ({
			id: `p_${desc.id}_${s.id}`,
			x: w,
			y: HEADER_H + si * ROW_H + ROW_H / 2,
			width: 1,
			height: 1,
		}));
		const child: ElkChild = { id: nid, width: w, height: h };
		if (ports.length > 0) {
			child.ports = ports;
			child.properties = { 'org.eclipse.elk.portConstraints': 'FIXED_POS' };
		}
		children.push(child);
		nodeMeta.set(nid, { desc, headerColor: pal.headers[i % pal.headers.length], stmts });

		for (const s of desc.statements) {
			for (const ref of s.shapeRefs ?? []) {
				if (ref === desc.name) continue;
				if (!descNames.has(ref)) continue;
				const ti = descriptions.findIndex((d) => d.name === ref);
				if (ti >= 0) {
					const eid = `e${ei++}`;
					edges.push({ id: eid, sources: [`p_${desc.id}_${s.id}`], targets: [`n${ti}`] });
					edgeMeta.set(eid, {
						prop: compactIRI(s.propertyId, ns) || s.id,
						label: s.label || '',
						card: formatCard(s.min, s.max),
					});
				}
			}
		}
	}

	const graph = {
		id: 'root',
		layoutOptions: {
			'elk.algorithm': 'layered',
			'elk.direction': 'RIGHT',
			'elk.spacing.nodeNode': '50',
			'elk.layered.spacing.nodeNodeBetweenLayers': '100',
			'elk.spacing.edgeNode': '30',
			'elk.spacing.edgeEdge': '25',
			'elk.layered.spacing.edgeNodeBetweenLayers': '40',
			// Orthogonal routing gives straight horizontal/vertical
			// runs; the render pass below then rounds each corner
			// via `roundedPath`. SPLINES's organic curves were
			// replaced in beta.65 for a cleaner, more-diagramming-
			// tool-like aesthetic.
			'elk.edgeRouting': 'ORTHOGONAL',
			'elk.layered.mergeEdges': 'false',
		},
		children,
		edges,
	};
	const result = await elk.layout(graph);

	let maxX = 400, maxY = 200;
	const lines: string[] = [];

	lines.push(`<defs>`);
	// Arrowheads scale with the edge stroke. The cross-edge marker
	// (`ah`) is sized for the thin 0.6–0.75 px edge; the self-ref
	// marker (`ah-sr`) keeps its original weight because self-loops
	// are a signal and stay at 1.5 px. `refX` sits inside the triangle
	// (not at the tip) so the arrowhead meets the node border cleanly —
	// a tip-anchored arrowhead leaves a ~1 px gap when the edge stroke
	// is thinner than the node border.
	lines.push(`<marker id="ah" markerWidth="6" markerHeight="4.5" refX="5" refY="2.25" orient="auto"><polygon points="0 0, 6 2.25, 0 4.5" fill="${pal.edgeColor}"/></marker>`);
	lines.push(`<marker id="ah-sr" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto"><polygon points="0 0, 8 3, 0 6" fill="${pal.selfRefText}"/></marker>`);
	lines.push(`</defs>`);

	for (const child of result.children || []) {
		const meta = nodeMeta.get(child.id);
		if (!meta) continue;
		const x = child.x ?? 0, y = child.y ?? 0, w = child.width ?? BASE_W, h = child.height ?? 100;
		maxX = Math.max(maxX, x + w);
		maxY = Math.max(maxY, y + h);
		const { desc, headerColor, stmts } = meta;
		const label = desc.label || desc.name;
		const tc = desc.targetClass ? compactIRI(desc.targetClass, ns) : '';

		lines.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="${pal.bodyBg}" stroke="${pal.border}" stroke-width="1.5"/>`);
		lines.push(`<rect x="${x + 0.75}" y="${y + 0.75}" width="${w - 1.5}" height="${HEADER_H}" rx="5" fill="${headerColor}"/>`);
		lines.push(`<rect x="${x + 0.75}" y="${y + HEADER_H - 6}" width="${w - 1.5}" height="6.75" fill="${headerColor}"/>`);
		lines.push(`<line x1="${x}" y1="${y + HEADER_H}" x2="${x + w}" y2="${y + HEADER_H}" stroke="${pal.border}" stroke-width="0.75" opacity="0.5"/>`);
		lines.push(`<text x="${x + w / 2}" y="${y + 20}" text-anchor="middle" font-size="12" font-weight="bold" font-family="Inter, sans-serif" fill="${pal.headerText}">${esc(label)}</text>`);
		if (tc) lines.push(`<text x="${x + w / 2}" y="${y + 34}" text-anchor="middle" font-size="9" font-family="Inter, sans-serif" fill="${pal.typeText}" font-style="italic">${esc(tc)}</text>`);

		if (stmts.length === 0) {
			lines.push(`<text x="${x + NODE_PAD_H}" y="${y + HEADER_H + 18}" font-size="10" font-family="Inter, sans-serif" fill="#999" font-style="italic">no properties</text>`);
		}
		for (let si = 0; si < stmts.length; si++) {
			const ry = y + HEADER_H + si * ROW_H;
			const isLast = si === stmts.length - 1;
			if (isLast) {
				lines.push(`<rect x="${x + 1}" y="${ry}" width="${w - 2}" height="${ROW_H}" fill="${si % 2 === 1 ? pal.stripeBg : pal.bodyBg}" rx="5"/>`);
			} else {
				lines.push(`<rect x="${x + 1}" y="${ry}" width="${w - 2}" height="${ROW_H}" fill="${si % 2 === 1 ? pal.stripeBg : pal.bodyBg}"/>`);
			}
			const s = stmts[si];
			const labelText = s.label || s.prop;
			if (settings.showLabel && settings.showProperty) {
				lines.push(`<text x="${x + NODE_PAD_H}" y="${ry + 11}" font-size="10" font-weight="bold" font-family="Inter, sans-serif" fill="${pal.bodyText}">${esc(labelText)}</text>`);
				lines.push(`<text x="${x + NODE_PAD_H}" y="${ry + 22}" font-size="8" font-family="JetBrains Mono, monospace" fill="${pal.typeText}">${esc(s.prop)}</text>`);
			} else if (settings.showLabel) {
				lines.push(`<text x="${x + NODE_PAD_H}" y="${ry + 17}" font-size="10" font-weight="bold" font-family="Inter, sans-serif" fill="${pal.bodyText}">${esc(labelText)}</text>`);
			} else {
				lines.push(`<text x="${x + NODE_PAD_H}" y="${ry + 17}" font-size="10" font-weight="bold" font-family="JetBrains Mono, monospace" fill="${pal.bodyText}">${esc(s.prop)}</text>`);
			}
			const tColor = s.isSelfRef ? pal.selfRefText : s.isRef ? pal.refText : pal.typeText;
			const prefix = s.isSelfRef ? '&#x21BA; ' : s.isRef ? '&#x2192; ' : '';
			const metaY = settings.showLabel && settings.showProperty ? ry + 11 : ry + 17;
			lines.push(`<text x="${x + w - CARD_COL_W - 6}" y="${metaY}" text-anchor="end" font-size="9" font-family="Inter, sans-serif" fill="${tColor}">${prefix}${esc(s.tl)}</text>`);
			if (settings.showCardinality) {
				lines.push(`<text x="${x + w - 10}" y="${metaY}" text-anchor="end" font-size="9" font-family="JetBrains Mono, monospace" fill="${pal.cardText}">${esc(s.card)}</text>`);
			}
		}

		if (settings.showEdges) {
			for (let si = 0; si < stmts.length; si++) {
				if (!stmts[si].isSelfRef) continue;
				const yRow = y + HEADER_H + si * ROW_H + ROW_H / 2;
				const exitY = yRow - 3;
				const returnY = yRow + 3;
				const path = `M ${x + w} ${exitY} A ${SELF_LOOP_R} ${SELF_LOOP_R} 0 1 1 ${x + w} ${returnY}`;
				lines.push(`<path d="${path}" fill="none" stroke="${pal.selfRefText}" stroke-width="1.5" marker-end="url(#ah-sr)" opacity="0.7"/>`);
				if (settings.showEdgeLabels) {
					const selfLabelText = `${stmts[si].label || stmts[si].prop} [${stmts[si].card}]`;
					const selfLabelW = safeTextWidth(selfLabelText, 8, 'normal', 'mono') + 8;
					const labelX = x + w + SELF_LOOP_R * 2 + 4;
					lines.push(`<rect x="${labelX}" y="${yRow - 6}" width="${selfLabelW}" height="13" fill="${pal.edgeLabelBg}" rx="2" opacity="0.9" stroke="#e0e0e0" stroke-width="0.5"/>`);
					lines.push(`<text x="${labelX + 4}" y="${yRow + 4}" font-size="8" font-family="JetBrains Mono, monospace" fill="${pal.selfRefText}">${esc(selfLabelText)}</text>`);
					maxX = Math.max(maxX, labelX + selfLabelW);
				}
			}
		}
	}

	if (settings.showEdges) {
		for (const edge of result.edges || []) {
			const sections = (edge as { sections?: Array<{ startPoint: { x: number; y: number }; endPoint: { x: number; y: number }; bendPoints?: Array<{ x: number; y: number }> }> }).sections;
			const meta = edgeMeta.get(edge.id);
			if (!sections || !meta) continue;
			for (const sec of sections) {
				const pts = [sec.startPoint, ...(sec.bendPoints || []), sec.endPoint];
				// Orthogonal polyline with rounded corners. The helper
				// collapses any collinear runs Elk emits before
				// inserting 8-px arcs at the real bends, clamped to
				// 40 % of each adjacent segment so short runs degrade
				// gracefully to a sharp join.
				const d = roundedPath(pts, 8);
				lines.push(`<path d="${d}" fill="none" stroke="${pal.edgeColor}" stroke-width="${pal.edgeWidth}" marker-end="url(#ah)"/>`);
				if (settings.showEdgeLabels) {
					const labelText = `${meta.label || meta.prop} [${meta.card}]`;
					const lblW = safeTextWidth(labelText, 8, 'normal', 'mono') + 12;
					const { x: lx, y: ly } = pointAlongPath(pts);
					const labelLeft = lx - lblW / 2;
					const textX = labelLeft + 6;
					lines.push(`<rect x="${labelLeft}" y="${ly - 10}" width="${lblW}" height="16" fill="${pal.edgeLabelBg}" opacity="0.9" rx="3" stroke="#e0e0e0" stroke-width="0.5"/>`);
					lines.push(`<text x="${textX}" y="${ly + 2}" font-size="8" font-family="JetBrains Mono, monospace" fill="${pal.edgeLabelText}">${esc(labelText)}</text>`);
				}
				maxX = Math.max(maxX, sec.startPoint.x, sec.endPoint.x, ...(sec.bendPoints || []).map((b: { x: number; y: number }) => b.x));
				maxY = Math.max(maxY, sec.startPoint.y, sec.endPoint.y, ...(sec.bendPoints || []).map((b: { x: number; y: number }) => b.y));
			}
		}
	}

	return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-PAD} ${-PAD} ${maxX + PAD * 2} ${maxY + PAD * 2}" font-family="Inter, system-ui, -apple-system, sans-serif"><rect x="${-PAD}" y="${-PAD}" width="${maxX + PAD * 2}" height="${maxY + PAD * 2}" fill="${pal.graphBg}"/>${lines.join('')}</svg>`;
}
