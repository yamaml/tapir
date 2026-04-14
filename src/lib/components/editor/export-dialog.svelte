<script lang="ts">
	import type { TapirProject } from '$lib/types';
	import { downloadText, downloadBlob } from '$lib/utils/file-io';
	import {
		buildSimpleDsp,
	} from '$lib/converters/simpledsp-generator';
	import { buildDctapRows, DCTAP_COLUMNS } from '$lib/converters/dctap-generator';
	import { buildShExC } from '$lib/converters/shex-generator';
	import { buildShacl } from '$lib/converters/shacl-generator';
	import { buildOwlDsp } from '$lib/converters/owldsp-generator';
	import { simpleDspLang } from '$lib/stores';
	import { validateProject } from '$lib/utils/validation';
	import { buildYamaYaml } from '$lib/converters/yaml-generator';
	import { buildYamaJson } from '$lib/converters/json-generator';
	import { buildDataPackage } from '$lib/converters/datapackage-generator';
	import { buildDiagram, compactIRI, formatCard, typeLabel, COLOR_PALETTE, BW_PALETTE } from '$lib/converters/diagram-generator';
	import { generateHtmlReport } from '$lib/converters/report-generator';
	import { generatePackageZip } from '$lib/converters/package-generator';
	import { safeTextWidth } from '$lib/utils/text-measure';
	import ELK from 'elkjs/lib/elk.bundled.js';
	import { Dialog, DialogContent, DialogHeader, DialogTitle } from '$lib/components/ui/dialog';
	import { ScrollArea } from '$lib/components/ui/scroll-area';
	import { Separator } from '$lib/components/ui/separator';
	import { Button } from '$lib/components/ui/button';
	import { Tabs, TabsContent, TabsList, TabsTrigger } from '$lib/components/ui/tabs';
	import { ToggleGroup, ToggleGroupItem } from '$lib/components/ui/toggle-group';
	import Loader from 'lucide-svelte/icons/loader-circle';
	import ChevronRight from 'lucide-svelte/icons/chevron-right';
	import Download from 'lucide-svelte/icons/download';
	import AlertTriangle from 'lucide-svelte/icons/triangle-alert';
	import FileSpreadsheet from 'lucide-svelte/icons/file-spreadsheet';
	import FileCode from 'lucide-svelte/icons/file-code';
	import FileText from 'lucide-svelte/icons/file-text';
	import Image from 'lucide-svelte/icons/image';
	import ClipboardList from 'lucide-svelte/icons/clipboard-list';
	import PackageIcon from 'lucide-svelte/icons/package';

	interface Props {
		project: TapirProject;
		open: boolean;
		onclose: () => void;
	}

	let { project, open = $bindable(), onclose }: Props = $props();

	let exporting = $state(false);
	let exportError = $state<string | null>(null);

	// ── SVG/PNG Export Helpers ──────────────────────────────────────

	const elk = new ELK();

	/** Generate a standalone SVG string using Elk.js layout. */
	async function generateExportSvg(proj: TapirProject, mode: 'color' | 'bw'): Promise<string> {
		const pal = mode === 'bw' ? BW_PALETTE : COLOR_PALETTE;
		const ns = proj.namespaces || {};
		const descriptions = proj.descriptions || [];
		const descNames = new Set(descriptions.map((d) => d.name));

		if (descriptions.length === 0) {
			return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200"><text x="200" y="100" text-anchor="middle" fill="#999" font-size="14">No descriptions</text></svg>';
		}

		const HEADER_H = 48, ROW_H = 26, BASE_W = 280, PAD = 40;
		const NODE_PAD_H = 14, CARD_COL_W = 44;
		const children: Array<{ id: string; width: number; height: number }> = [];
		const edges: Array<{ id: string; sources: string[]; targets: string[] }> = [];
		const nodeMeta = new Map<string, { desc: typeof descriptions[0]; headerColor: string; stmts: Array<{ prop: string; tl: string; card: string; isRef: boolean; isSelfRef: boolean }> }>();
		const edgeMeta = new Map<string, { prop: string; card: string }>();
		let ei = 0;

		for (let i = 0; i < descriptions.length; i++) {
			const desc = descriptions[i];
			const stmts = desc.statements.map((s) => {
				const prop = compactIRI(s.propertyId, ns) || s.id;
				const refs = s.shapeRefs ?? [];
				const resolved = refs.filter((r) => descNames.has(r));
				const isRef = resolved.length > 0;
				const isSelfRef = resolved.length === 1 && resolved[0] === desc.name;
				return { prop, tl: typeLabel(s, ns), card: formatCard(s.min, s.max), isRef, isSelfRef };
			});
			// Use actual text measurement for node width
			let maxPropW = 0, maxTypeW = 0;
			for (const s of stmts) {
				maxPropW = Math.max(maxPropW, safeTextWidth(s.prop, 10, '600'));
				const prefix = s.isSelfRef ? '\u21BA ' : (s.isRef ? '\u2192 ' : '');
				maxTypeW = Math.max(maxTypeW, safeTextWidth(prefix + s.tl, 9, 'normal'));
			}
			const contentW = NODE_PAD_H + maxPropW + 20 + maxTypeW + CARD_COL_W + NODE_PAD_H;
			const headerLabelW = safeTextWidth(desc.label || desc.name, 12, 'bold') + 40;
			const w = Math.max(BASE_W, contentW, headerLabelW);
			const h = HEADER_H + Math.max(stmts.length, 1) * ROW_H + 6;
			const nid = `n${i}`;
			children.push({ id: nid, width: w, height: h });
			nodeMeta.set(nid, { desc, headerColor: pal.headers[i % pal.headers.length], stmts });

			for (const s of desc.statements) {
				for (const ref of s.shapeRefs ?? []) {
					if (ref === desc.name) continue;
					if (!descNames.has(ref)) continue;
					const ti = descriptions.findIndex((d) => d.name === ref);
					if (ti >= 0) {
						const eid = `e${ei++}`;
						edges.push({ id: eid, sources: [nid], targets: [`n${ti}`] });
						edgeMeta.set(eid, { prop: compactIRI(s.propertyId, ns) || s.id, card: formatCard(s.min, s.max) });
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
				'elk.edgeRouting': 'SPLINES',
				'elk.layered.mergeEdges': 'false',
			},
			children,
			edges,
		};
		const result = await elk.layout(graph);

		const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
		let maxX = 400, maxY = 200;
		const lines: string[] = [];

		// Defs block with arrowhead markers and self-ref marker
		lines.push(`<defs>`);
		lines.push(`<marker id="ah" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto"><polygon points="0 0, 8 3, 0 6" fill="${pal.edgeColor}"/></marker>`);
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

			// Outer border with full rounding
			lines.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="${pal.bodyBg}" stroke="${pal.border}" stroke-width="1.5"/>`);
			// Header background (top corners rounded)
			lines.push(`<rect x="${x + 0.75}" y="${y + 0.75}" width="${w - 1.5}" height="${HEADER_H}" rx="5" fill="${headerColor}"/>`);
			// Fill gap below header rounded corners
			lines.push(`<rect x="${x + 0.75}" y="${y + HEADER_H - 6}" width="${w - 1.5}" height="6.75" fill="${headerColor}"/>`);
			// Separator line between header and body
			lines.push(`<line x1="${x}" y1="${y + HEADER_H}" x2="${x + w}" y2="${y + HEADER_H}" stroke="${pal.border}" stroke-width="0.75" opacity="0.5"/>`);
			// Header text
			lines.push(`<text x="${x + w / 2}" y="${y + 20}" text-anchor="middle" font-size="12" font-weight="bold" fill="${pal.headerText}">${esc(label)}</text>`);
			if (tc) lines.push(`<text x="${x + w / 2}" y="${y + 34}" text-anchor="middle" font-size="9" fill="${pal.typeText}" font-style="italic">${esc(tc)}</text>`);

			if (stmts.length === 0) {
				lines.push(`<text x="${x + NODE_PAD_H}" y="${y + HEADER_H + 18}" font-size="10" fill="#999" font-style="italic">no properties</text>`);
			}
			for (let si = 0; si < stmts.length; si++) {
				const ry = y + HEADER_H + si * ROW_H;
				const isLast = si === stmts.length - 1;
				if (isLast) {
					lines.push(`<rect x="${x + 1}" y="${ry}" width="${w - 2}" height="${ROW_H}" fill="${si % 2 === 1 ? pal.stripeBg : pal.bodyBg}" rx="5"/>`);
				} else {
					lines.push(`<rect x="${x + 1}" y="${ry}" width="${w - 2}" height="${ROW_H}" fill="${si % 2 === 1 ? pal.stripeBg : pal.bodyBg}"/>`);
				}
				// Property name (bold)
				lines.push(`<text x="${x + NODE_PAD_H}" y="${ry + 17}" font-size="10" font-weight="600" fill="${pal.bodyText}">${esc(stmts[si].prop)}</text>`);
				// Type label
				const tColor = stmts[si].isSelfRef ? pal.selfRefText : stmts[si].isRef ? pal.refText : pal.typeText;
				const prefix = stmts[si].isSelfRef ? '&#x21BA; ' : stmts[si].isRef ? '&#x2192; ' : '';
				lines.push(`<text x="${x + w - CARD_COL_W - 6}" y="${ry + 17}" text-anchor="end" font-size="9" fill="${tColor}">${prefix}${esc(stmts[si].tl)}</text>`);
				// Cardinality
				lines.push(`<text x="${x + w - 10}" y="${ry + 17}" text-anchor="end" font-size="9" fill="${pal.cardText}">${esc(stmts[si].card)}</text>`);
			}

			// Self-reference loops
			const selfRefStmts = stmts.filter(s => s.isSelfRef);
			for (let sri = 0; sri < selfRefStmts.length; sri++) {
				const stmtIdx = stmts.indexOf(selfRefStmts[sri]);
				const yBase = y + HEADER_H + stmtIdx * ROW_H + ROW_H / 2;
				const loopW = 40 + sri * 12;
				const loopH = 28 + sri * 4;
				const path = `M ${x + w} ${yBase - 4} C ${x + w + loopW * 0.6} ${yBase - loopH}, ${x + w + loopW} ${yBase - loopH * 0.5}, ${x + w + loopW} ${yBase} C ${x + w + loopW} ${yBase + loopH * 0.5}, ${x + w + loopW * 0.6} ${yBase + loopH}, ${x + w} ${yBase + 4}`;
				lines.push(`<path d="${path}" fill="none" stroke="${pal.selfRefText}" stroke-width="1.5" marker-end="url(#ah-sr)" opacity="0.7"/>`);
				// Self-ref label
				const selfLabelText = `${selfRefStmts[sri].prop} [${selfRefStmts[sri].card}]`;
				const selfLabelW = safeTextWidth(selfLabelText, 8, 'normal') + 8;
				const labelX = x + w + loopW + 4;
				lines.push(`<rect x="${labelX}" y="${yBase - 6}" width="${selfLabelW}" height="13" fill="${pal.edgeLabelBg}" rx="2" opacity="0.9" stroke="#e0e0e0" stroke-width="0.5"/>`);
				lines.push(`<text x="${labelX + selfLabelW / 2}" y="${yBase + 4}" text-anchor="middle" font-size="8" fill="${pal.selfRefText}">${esc(selfLabelText)}</text>`);
				maxX = Math.max(maxX, labelX + selfLabelW);
			}
		}

		// Edges
		const totalEdges = (result.edges || []).length;
		for (let edgeIdx = 0; edgeIdx < (result.edges || []).length; edgeIdx++) {
			const edge = result.edges![edgeIdx];
			const sections = (edge as any).sections;
			const meta = edgeMeta.get(edge.id);
			if (!sections || !meta) continue;
			for (const sec of sections) {
				const pts = [sec.startPoint, ...(sec.bendPoints || []), sec.endPoint];
				let d = `M ${pts[0].x} ${pts[0].y}`;
				for (let i = 1; i < pts.length; i++) {
					const prev = pts[i - 1], curr = pts[i];
					const dx = (curr.x - prev.x) / 2;
					d += ` C ${prev.x + dx} ${prev.y}, ${curr.x - dx} ${curr.y}, ${curr.x} ${curr.y}`;
				}
				lines.push(`<path d="${d}" fill="none" stroke="${pal.edgeColor}" stroke-width="1.5" marker-end="url(#ah)"/>`);
				// Edge label with measured width
				const labelText = `${meta.prop} [${meta.card}]`;
				const lblW = safeTextWidth(labelText, 8, 'normal') + 12;
				let lx: number, ly: number;
				if (sec.bendPoints && sec.bendPoints.length > 0) {
					const mid = Math.floor(sec.bendPoints.length / 2);
					lx = sec.bendPoints[mid].x;
					ly = sec.bendPoints[mid].y - 8;
				} else {
					lx = (sec.startPoint.x + sec.endPoint.x) / 2;
					ly = (sec.startPoint.y + sec.endPoint.y) / 2 - 8;
				}
				// Offset labels vertically to avoid overlap
				if (totalEdges > 1) {
					const offset = (edgeIdx - (totalEdges - 1) / 2) * 18;
					ly += offset;
				}
				lines.push(`<rect x="${lx - lblW / 2}" y="${ly - 10}" width="${lblW}" height="16" fill="${pal.edgeLabelBg}" opacity="0.9" rx="3" stroke="#e0e0e0" stroke-width="0.5"/>`);
				lines.push(`<text x="${lx}" y="${ly + 2}" text-anchor="middle" font-size="8" fill="${pal.edgeLabelText}">${esc(labelText)}</text>`);
				maxX = Math.max(maxX, sec.startPoint.x, sec.endPoint.x, ...(sec.bendPoints || []).map((b: any) => b.x));
				maxY = Math.max(maxY, sec.startPoint.y, sec.endPoint.y, ...(sec.bendPoints || []).map((b: any) => b.y));
			}
		}

		return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-PAD} ${-PAD} ${maxX + PAD * 2} ${maxY + PAD * 2}" font-family="system-ui, -apple-system, sans-serif"><rect x="${-PAD}" y="${-PAD}" width="${maxX + PAD * 2}" height="${maxY + PAD * 2}" fill="${pal.graphBg}"/>${lines.join('')}</svg>`;
	}

	/** Convert SVG string to PNG and trigger download. */
	async function svgToPng(svgString: string, filename: string): Promise<void> {
		const vbMatch = svgString.match(/viewBox="([^"]+)"/);
		const vb = vbMatch ? vbMatch[1].split(/\s+/).map(Number) : [0, 0, 800, 600];
		const scale = 2;
		const width = vb[2] * scale;
		const height = vb[3] * scale;

		const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
		const url = URL.createObjectURL(blob);
		const img = new window.Image();
		await new Promise<void>((resolve, reject) => {
			img.onload = () => resolve();
			img.onerror = () => reject(new Error('Failed to render SVG'));
			img.src = url;
		});

		const canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		const ctx = canvas.getContext('2d');
		if (!ctx) throw new Error('Canvas not available');
		ctx.fillStyle = '#ffffff';
		ctx.fillRect(0, 0, width, height);
		ctx.drawImage(img, 0, 0, width, height);
		URL.revokeObjectURL(url);

		const pngBlob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
		if (pngBlob) {
			const dUrl = URL.createObjectURL(pngBlob);
			const a = document.createElement('a');
			a.href = dUrl;
			a.download = filename;
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			URL.revokeObjectURL(dUrl);
		}
	}

	// ── Export Categories ──────────────────────────────────────────

	interface ExportOption {
		id: string;
		label: string;
		ext: string;
		category: string;
		/** Short, one-sentence "what is this" hint shown under the label. */
		description: string;
	}

	const tabularOptions: ExportOption[] = [
		{ id: 'simpledsp-tsv', label: 'SimpleDSP', ext: '.tsv', category: 'Tabular', description: 'Native tab-separated SimpleDSP file.' },
		{ id: 'simpledsp-csv', label: 'SimpleDSP', ext: '.csv', category: 'Tabular', description: 'Comma-separated SimpleDSP for spreadsheet apps.' },
		{ id: 'dctap-csv', label: 'DCTAP', ext: '.csv', category: 'Tabular', description: 'DC Tabular Application Profile (canonical CSV).' },
		{ id: 'dctap-tsv', label: 'DCTAP', ext: '.tsv', category: 'Tabular', description: 'DCTAP as tab-separated values.' },
	];

	const constraintOptions: ExportOption[] = [
		{ id: 'shacl-turtle', label: 'SHACL', ext: '.ttl', category: 'Constraint Languages', description: 'W3C Shapes Constraint Language in Turtle.' },
		{ id: 'shex', label: 'ShEx', ext: '.shex', category: 'Constraint Languages', description: 'Shape Expressions in compact syntax.' },
		{ id: 'owldsp-turtle', label: 'OWL-DSP', ext: '.ttl', category: 'Constraint Languages', description: 'Description Set Profile as OWL ontology.' },
	];

	const otherOptions: ExportOption[] = [
		{ id: 'yaml', label: 'YAMA YAML', ext: '.yaml', category: 'Other', description: 'Source profile in YAMAML for the yama CLI.' },
		{ id: 'json', label: 'JSON', ext: '.json', category: 'Other', description: 'JSON representation for programmatic use.' },
		{ id: 'datapackage', label: 'DataPackage', ext: '.json', category: 'Other', description: 'Frictionless Data Package descriptor.' },
	];

	/**
	 * Diagram exports are flattened to three primary formats — the colour
	 * palette is a separate toggle, cutting the original 5 buttons to 3.
	 */
	let diagramColor = $state<'color' | 'bw'>('color');
	const diagramOptions: ExportOption[] = [
		{ id: 'diagram-svg', label: 'SVG', ext: '.svg', category: 'Diagrams', description: 'Vector diagram (best quality, scalable).' },
		{ id: 'diagram-png', label: 'PNG', ext: '.png', category: 'Diagrams', description: 'Bitmap diagram for documents and slides.' },
		{ id: 'diagram-dot', label: 'DOT', ext: '.dot', category: 'Diagrams', description: 'Graphviz source for re-rendering.' },
	];

	const reportOptions: ExportOption[] = [
		{ id: 'report-html', label: 'Profile Report', ext: '.html', category: 'Reports', description: 'Self-contained HTML documentation with embedded diagram.' },
	];

	const packageOptions: ExportOption[] = [
		{ id: 'package-zip', label: 'Profile Package', ext: '.zip', category: 'Package', description: 'Every format bundled into one archive.' },
	];

	// ── Export Handler ──────────────────────────────────────────────

	function baseFilename(): string {
		return project.name.replace(/\s+/g, '-').toLowerCase() || 'export';
	}

	/** Converts tab-separated SimpleDSP text to proper comma-separated CSV. */
	function tsvToCsv(tsv: string): string {
		return tsv
			.split('\n')
			.map((line) =>
				line
					.split('\t')
					.map((cell) => {
						if (cell.includes(',') || cell.includes('"') || cell.includes('\n')) {
							return `"${cell.replace(/"/g, '""')}"`;
						}
						return cell;
					})
					.join(',')
			)
			.join('\n');
	}

	/** Hard-block: export would produce empty/broken file. */
	function getStructuralError(formatId: string): string | null {
		if (formatId.startsWith('simpledsp') && project.descriptions.length === 0) {
			return 'SimpleDSP export requires at least one description template.';
		}
		if (formatId.startsWith('dctap')) {
			const hasProperty = project.descriptions.some((d) => d.statements.some((s) => s.propertyId));
			if (!hasProperty) return 'DCTAP export requires at least one statement with a propertyID.';
		}
		if ((formatId === 'shacl-turtle' || formatId === 'shex' || formatId === 'owldsp-turtle') && project.descriptions.length === 0) {
			const name = formatId === 'shex' ? 'ShEx' : formatId === 'owldsp-turtle' ? 'OWL-DSP' : 'SHACL';
			return `${name} export requires at least one shape/description.`;
		}
		return null;
	}

	/** Soft-warn: validation issues that don't break the file. */
	function getValidationWarnings(): string[] {
		const result = validateProject(project);
		return [...result.errors, ...result.warnings].map((e) => e.message);
	}

	// State for the validation confirmation modal
	let pendingExportId = $state<string | null>(null);
	let validationIssues = $state<string[]>([]);

	function dctapRowsToCsv(delimiter: string): string {
		const rows = buildDctapRows(project);
		const header = DCTAP_COLUMNS.join(delimiter);
		const body = rows
			.map((row) =>
				DCTAP_COLUMNS.map((col) => {
					const val = row[col] || '';
					if (delimiter === ',' && (val.includes(',') || val.includes('"') || val.includes('\n'))) {
						return `"${val.replace(/"/g, '""')}"`;
					}
					return val;
				}).join(delimiter)
			)
			.join('\n');
		return `${header}\n${body}\n`;
	}

	async function handleExport(optionId: string, skipValidation = false): Promise<void> {
		exporting = true;
		exportError = null;

		try {
			// Hard block: structural issues that would produce broken files
			const structural = getStructuralError(optionId);
			if (structural) {
				exportError = structural;
				exporting = false;
				return;
			}

			// Soft warn: validation issues — show confirmation, don't block
			if (!skipValidation) {
				const warnings = getValidationWarnings();
				if (warnings.length > 0) {
					pendingExportId = optionId;
					validationIssues = warnings;
					exporting = false;
					return;
				}
			}

			const name = baseFilename();

			switch (optionId) {
				case 'simpledsp-tsv': {
					const content = buildSimpleDsp(project, { lang: $simpleDspLang });
					downloadText(content, `${name}.tsv`, 'text/tab-separated-values');
					break;
				}
				case 'simpledsp-csv': {
					const tsvContent = buildSimpleDsp(project, { lang: $simpleDspLang });
					const content = tsvToCsv(tsvContent);
					downloadText(content, `${name}-simpledsp.csv`, 'text/csv');
					break;
				}
				case 'dctap-csv': {
					const content = dctapRowsToCsv(',');
					downloadText(content, `${name}-dctap.csv`, 'text/csv');
					break;
				}
				case 'dctap-tsv': {
					const content = dctapRowsToCsv('\t');
					downloadText(content, `${name}-dctap.tsv`, 'text/tab-separated-values');
					break;
				}
				case 'shacl-turtle': {
					const content = await buildShacl(project, 'turtle');
					downloadText(content, `${name}.shacl.ttl`, 'text/turtle');
					break;
				}
				case 'shex': {
					const content = buildShExC(project);
					downloadText(content, `${name}.shex`, 'text/shex');
					break;
				}
				case 'owldsp-turtle': {
					const content = await buildOwlDsp(project, 'turtle');
					downloadText(content, `${name}.owldsp.ttl`, 'text/turtle');
					break;
				}
				case 'yaml': {
					const content = buildYamaYaml(project);
					downloadText(content, `${name}.yaml`, 'text/yaml');
					break;
				}
				case 'json': {
					const content = buildYamaJson(project);
					downloadText(content, `${name}.json`, 'application/json');
					break;
				}
				case 'datapackage': {
					const content = buildDataPackage(project);
					downloadText(content, `${name}-datapackage.json`, 'application/json');
					break;
				}
				case 'diagram-svg': {
					const svg = await generateExportSvg(project, diagramColor);
					const suffix = diagramColor === 'bw' ? '-diagram-bw' : '-diagram';
					downloadText(svg, `${name}${suffix}.svg`, 'image/svg+xml');
					break;
				}
				case 'diagram-png': {
					const svgForPng = await generateExportSvg(project, diagramColor);
					const suffix = diagramColor === 'bw' ? '-diagram-bw' : '-diagram';
					await svgToPng(svgForPng, `${name}${suffix}.png`);
					break;
				}
				case 'diagram-dot': {
					const dot = buildDiagram(project, diagramColor);
					downloadText(dot, `${name}.dot`, 'text/vnd.graphviz');
					break;
				}
				case 'report-html': {
					const reportSvg = await generateExportSvg(project, 'color');
					const html = generateHtmlReport(project, reportSvg);
					downloadText(html, `${name}-report.html`, 'text/html');
					break;
				}
				case 'package-zip': {
					const pkgSvg = await generateExportSvg(project, 'color');
					const zipData = await generatePackageZip(project, pkgSvg);
					const zipBlob = new Blob([new Uint8Array(zipData) as BlobPart], { type: 'application/zip' });
					downloadBlob(zipBlob, `${name}-package.zip`);
					break;
				}
				default:
					exportError = `Unknown export format: ${optionId}`;
			}

			if (!exportError) {
				open = false;
				onclose();
			}
		} catch (err) {
			exportError = err instanceof Error ? err.message : String(err);
		} finally {
			exporting = false;
		}
	}

</script>

{#snippet exportCard(opt: ExportOption)}
	<button
		onclick={() => handleExport(opt.id)}
		disabled={exporting}
		class="group flex items-start gap-3 rounded-md border border-border bg-background px-3 py-2.5 text-left transition-all hover:border-primary/50 hover:bg-accent/40 hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:pointer-events-none"
	>
		<div class="min-w-0 flex-1">
			<div class="flex items-center gap-1.5">
				<span class="font-medium text-foreground">{opt.label}</span>
				<span class="rounded bg-muted px-1 py-px font-mono text-[10px] text-muted-foreground">{opt.ext}</span>
			</div>
			{#if opt.description}
				<p class="mt-0.5 text-[11px] text-muted-foreground leading-snug">{opt.description}</p>
			{/if}
		</div>
		<ChevronRight class="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground/40 transition-colors group-hover:text-primary" />
	</button>
{/snippet}

<Dialog bind:open onOpenChange={(v) => { if (!v) onclose(); }}>
	<DialogContent class="max-w-2xl max-h-[90vh] flex flex-col gap-0 p-0">
		<DialogHeader class="border-b border-border px-5 py-4">
			<DialogTitle class="flex items-center gap-2">
				<Download class="h-4 w-4 text-muted-foreground" />
				Export profile
			</DialogTitle>
		</DialogHeader>

		{#if exportError}
			<div class="mx-5 mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
				{exportError}
			</div>
		{/if}

		<!--
			Hero CTA: most users want "everything as a zip", so promote it
			to a single primary action above the per-format tabs.
		-->
		<div class="border-b border-border px-5 py-4">
			<button
				onclick={() => handleExport('package-zip')}
				disabled={exporting}
				class="group flex w-full items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-left transition-all hover:border-primary hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:pointer-events-none"
			>
				<div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary">
					{#if exporting}
						<Loader class="h-5 w-5 animate-spin" />
					{:else}
						<PackageIcon class="h-5 w-5" />
					{/if}
				</div>
				<div class="min-w-0 flex-1">
					<div class="flex items-center gap-2">
						<span class="font-semibold text-foreground">Profile package</span>
						<span class="rounded bg-primary/15 px-1.5 py-0.5 font-mono text-[10px] text-primary">.zip</span>
					</div>
					<p class="mt-0.5 text-xs text-muted-foreground leading-snug">
						All formats in one archive — SimpleDSP, DCTAP, SHACL, ShEx, OWL-DSP, YAMA, JSON, diagram, README, and HTML/Markdown report.
					</p>
				</div>
				<ChevronRight class="h-4 w-4 shrink-0 text-muted-foreground/60 transition-colors group-hover:text-primary" />
			</button>
		</div>

		<!--
			Individual formats grouped into tabs. Each tab fits in the
			dialog without scrolling for typical screen sizes.
		-->
		<Tabs value="tabular" class="flex-1 min-h-0 flex flex-col">
			<TabsList class="mx-5 mt-3 grid grid-cols-5 gap-1">
				<TabsTrigger value="tabular" class="text-xs">
					<FileSpreadsheet class="mr-1 h-3.5 w-3.5" />
					Tabular
				</TabsTrigger>
				<TabsTrigger value="constraint" class="text-xs">
					<FileCode class="mr-1 h-3.5 w-3.5" />
					Shapes
				</TabsTrigger>
				<TabsTrigger value="other" class="text-xs">
					<FileText class="mr-1 h-3.5 w-3.5" />
					Source
				</TabsTrigger>
				<TabsTrigger value="diagram" class="text-xs">
					<Image class="mr-1 h-3.5 w-3.5" />
					Diagram
				</TabsTrigger>
				<TabsTrigger value="report" class="text-xs">
					<ClipboardList class="mr-1 h-3.5 w-3.5" />
					Report
				</TabsTrigger>
			</TabsList>

			<ScrollArea class="flex-1 min-h-0">
				<TabsContent value="tabular" class="px-5 py-4 mt-0">
					<div class="grid grid-cols-2 gap-2">
						{#each tabularOptions as opt}
							{@render exportCard(opt)}
						{/each}
					</div>
				</TabsContent>

				<TabsContent value="constraint" class="px-5 py-4 mt-0">
					<div class="grid grid-cols-1 gap-2">
						{#each constraintOptions as opt}
							{@render exportCard(opt)}
						{/each}
					</div>
				</TabsContent>

				<TabsContent value="other" class="px-5 py-4 mt-0">
					<div class="grid grid-cols-1 gap-2">
						{#each otherOptions as opt}
							{@render exportCard(opt)}
						{/each}
					</div>
				</TabsContent>

				<TabsContent value="diagram" class="px-5 py-4 mt-0 space-y-3">
					<!-- Color/B&W toggle applies to all diagram formats -->
					<div class="flex items-center justify-between rounded-md border border-border bg-muted/20 px-3 py-2">
						<span class="text-xs font-medium text-muted-foreground">Palette</span>
						<ToggleGroup
							type="single"
							value={diagramColor}
							onValueChange={(v) => { if (v === 'color' || v === 'bw') diagramColor = v; }}
						>
							<ToggleGroupItem value="color" class="h-7 px-2.5 text-xs">Color</ToggleGroupItem>
							<ToggleGroupItem value="bw" class="h-7 px-2.5 text-xs">Black &amp; White</ToggleGroupItem>
						</ToggleGroup>
					</div>
					<div class="grid grid-cols-1 gap-2">
						{#each diagramOptions as opt}
							{@render exportCard(opt)}
						{/each}
					</div>
				</TabsContent>

				<TabsContent value="report" class="px-5 py-4 mt-0">
					<div class="grid grid-cols-1 gap-2">
						{#each reportOptions as opt}
							{@render exportCard(opt)}
						{/each}
					</div>
				</TabsContent>
			</ScrollArea>
		</Tabs>
	</DialogContent>
</Dialog>

<!-- Validation issues confirmation modal -->
{#if pendingExportId}
	<Dialog open={!!pendingExportId} onOpenChange={(v) => { if (!v) { pendingExportId = null; validationIssues = []; } }}>
		<DialogContent class="max-w-md">
			<DialogHeader>
				<DialogTitle class="flex items-center gap-2">
					<AlertTriangle class="h-5 w-5 text-amber-500" />
					Validation Issues
				</DialogTitle>
			</DialogHeader>

			<p class="text-sm text-muted-foreground">
				The profile has {validationIssues.length} issue{validationIssues.length !== 1 ? 's' : ''} that may affect the exported file:
			</p>

			<ScrollArea class="max-h-[200px]">
				<ul class="space-y-1 text-sm">
					{#each validationIssues as issue}
						<li class="flex items-start gap-2 py-1">
							<AlertTriangle class="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
							<span class="text-muted-foreground">{issue}</span>
						</li>
					{/each}
				</ul>
			</ScrollArea>

			<div class="flex justify-end gap-2 pt-2">
				<Button variant="outline" size="sm" onclick={() => { pendingExportId = null; validationIssues = []; }}>
					Fix Issues
				</Button>
				<Button size="sm" onclick={() => { const id = pendingExportId; pendingExportId = null; validationIssues = []; if (id) handleExport(id, true); }}>
					Export Anyway
				</Button>
			</div>
		</DialogContent>
	</Dialog>
{/if}
