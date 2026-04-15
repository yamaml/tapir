<script lang="ts">
	import type { TapirProject } from '$lib/types';
	import type { DiagramStyle } from '$lib/types/export';
	import { buildDiagram } from '$lib/converters/diagram-generator';
	import {
		compactIRI,
		formatCard,
		typeLabel,
		COLOR_PALETTE,
	} from '$lib/converters/diagram-generator';
	import {
		selectedDescriptionId,
		diagramSettings,
		edgeLabelsDisabled,
		getDiagramSettings,
	} from '$lib/stores';
	import { buildExportSvg } from '$lib/converters/export-svg-builder';
	import { downloadBlob } from '$lib/utils/file-io';
	import {
		toggleShowLabel,
		toggleShowProperty,
	} from '$lib/stores/diagram-settings-store';
	import { downloadText } from '$lib/utils/file-io';
	import { safeTextWidth } from '$lib/utils/text-measure';
	import { roundedPath, pointAlongPath } from '$lib/utils/edge-path';
	import ELK from 'elkjs/lib/elk.bundled.js';
	import { Popover, PopoverContent, PopoverTrigger } from '$lib/components/ui/popover';
	import { Separator } from '$lib/components/ui/separator';
	import Download from 'lucide-svelte/icons/download';
	import FileCode2 from 'lucide-svelte/icons/file-code-2';
	import FileText from 'lucide-svelte/icons/file-text';
	import Maximize2 from 'lucide-svelte/icons/maximize-2';
	import Minimize2 from 'lucide-svelte/icons/minimize-2';
	import ZoomIn from 'lucide-svelte/icons/zoom-in';
	import ZoomOut from 'lucide-svelte/icons/zoom-out';
	import Locate from 'lucide-svelte/icons/locate';
	import Settings2 from 'lucide-svelte/icons/settings-2';

	interface Props {
		project: TapirProject;
	}

	let { project }: Props = $props();

	// Diagram settings come from the shared store so the in-editor
	// preview and the Export dialog stay synchronised. The derived
	// values below collapse the dependency rule (edge labels require
	// edges) so rendering code can treat them as simple booleans.
	let style = $derived($diagramSettings.style);
	const showEdges = $derived($diagramSettings.showEdges);
	const showEdgeLabels = $derived($diagramSettings.showEdges && $diagramSettings.showEdgeLabels);
	const showCardinality = $derived($diagramSettings.showCardinality);
	// Alias preserved for template blocks that previously read
	// `showLabels` — SVG-rendered edge text is gated by both: we
	// only draw edge-label text when edges are on *and* labels are on.
	const showLabels = $derived(showEdgeLabels);
	// Row-content toggles (at-least-one invariant enforced by the
	// store). Rendering logic:
	//   both on  → label (bold) on top, IRI (muted) beneath
	//   label    → just the label
	//   property → just the IRI
	const showLabel = $derived($diagramSettings.showLabel);
	const showProperty = $derived($diagramSettings.showProperty);
	const showBoth = $derived(showLabel && showProperty);
	let expanded = $state(false);
	let svgEl: SVGSVGElement | undefined = $state();
	let hoveredEdgeId = $state<string | null>(null);
	let hoveredNodeId = $state<string | null>(null);

	// ── Color palette ───────────────────────────────────────────────
	const pal = COLOR_PALETTE;

	// ── ELK layout state ────────────────────────────────────────────

	interface LayoutNode {
		id: string;
		descId: string;
		name: string;
		label: string;
		targetClass: string;
		x: number;
		y: number;
		width: number;
		height: number;
		headerColor: string;
		colorIndex: number;
		statements: Array<{
			id: string;
			propertyId: string;
			label: string;
			typeLabel: string;
			cardinality: string;
			isRef: boolean;
			isSelfRef: boolean;
			shapeRefs: string[];
		}>;
		selfRefs: Array<{ prop: string; card: string }>;
	}

	interface LayoutEdge {
		id: string;
		sourceId: string;
		targetId: string;
		propertyLabel: string;
		stmtLabel: string;
		cardinality: string;
		sections: Array<{
			startPoint: { x: number; y: number };
			endPoint: { x: number; y: number };
			bendPoints?: Array<{ x: number; y: number }>;
		}>;
	}

	let layoutNodes = $state<LayoutNode[]>([]);
	let layoutEdges = $state<LayoutEdge[]>([]);
	/** Base viewBox produced by the Elk layout — the "fit all" view. */
	let baseViewBox = $state('0 0 800 600');
	let layoutReady = $state(false);
	let layoutError = $state<string | null>(null);

	// ── Zoom + pan (expanded full-screen mode only) ─────────────────
	/** 1.0 = fit-to-viewport. Clamped to [0.25, 4]. */
	let zoom = $state(1);
	/** Pan offset in viewBox units (x, y). */
	let panX = $state(0);
	let panY = $state(0);

	/** The viewBox the SVG actually uses: scaled + translated from the base. */
	let viewBox = $derived.by(() => {
		const parts = baseViewBox.split(/\s+/).map(Number);
		if (parts.length !== 4) return baseViewBox;
		const [x, y, w, h] = parts;
		if (!expanded) return baseViewBox;
		const scaledW = w / zoom;
		const scaledH = h / zoom;
		// Centre the zoomed window on the original centre + pan offset.
		const cx = x + w / 2 + panX;
		const cy = y + h / 2 + panY;
		return `${cx - scaledW / 2} ${cy - scaledH / 2} ${scaledW} ${scaledH}`;
	});

	function resetView() {
		zoom = 1;
		panX = 0;
		panY = 0;
	}

	function zoomIn() {
		zoom = Math.min(4, zoom * 1.25);
	}

	function zoomOut() {
		zoom = Math.max(0.25, zoom / 1.25);
	}

	// Drag-to-pan state
	let isDragging = $state(false);
	let dragStart = { x: 0, y: 0, panX: 0, panY: 0 };

	function handlePointerDown(e: PointerEvent) {
		if (!expanded) return;
		if (e.button !== 0) return;
		isDragging = true;
		dragStart = { x: e.clientX, y: e.clientY, panX, panY };
		try {
			(e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
		} catch {
			// Not all pointer events (synthetic, older browsers) support capture.
		}
	}

	function handlePointerMove(e: PointerEvent) {
		if (!isDragging) return;
		const parts = baseViewBox.split(/\s+/).map(Number);
		if (parts.length !== 4) return;
		const [, , w] = parts;
		const svg = e.currentTarget as SVGSVGElement;
		const rect = svg.getBoundingClientRect();
		// Convert pixel delta to viewBox units at the current zoom.
		const vbUnitsPerPx = (w / zoom) / rect.width;
		panX = dragStart.panX - (e.clientX - dragStart.x) * vbUnitsPerPx;
		panY = dragStart.panY - (e.clientY - dragStart.y) * vbUnitsPerPx;
	}

	function handlePointerUp(e: PointerEvent) {
		if (!isDragging) return;
		isDragging = false;
		try {
			(e.currentTarget as SVGSVGElement).releasePointerCapture(e.pointerId);
		} catch {
			// See handlePointerDown — some pointer types reject capture.
		}
	}

	function handleWheel(e: WheelEvent) {
		if (!expanded) return;
		e.preventDefault();
		// Wheel up = zoom in; wheel down = zoom out.
		if (e.deltaY < 0) zoomIn();
		else zoomOut();
	}

	const elk = new ELK();

	// ── Sizing constants ────────────────────────────────────────────

	const HEADER_HEIGHT = 48;
	const ROW_HEIGHT = 26;
	const OVERVIEW_HEIGHT = 60;
	const OVERVIEW_WIDTH = 180;
	const DETAIL_BASE_WIDTH = 280;
	const PADDING = 40;
	const NODE_PAD_H = 14;
	const NODE_PAD_V = 6;
	const CARD_COL_WIDTH = 44;

	// Self-reference loop geometry — compact circular arc anchored to
	// the right edge of the statement row that owns the self-ref.
	const SELF_LOOP_RADIUS = 8;

	/**
	 * Computes the horizontal extent of the self-reference loops that a
	 * node draws to its right, so Elk can reserve layout space for them
	 * and neighbours don't overlap the loop.
	 *
	 * Mirrors the geometry in `selfRefPath`: each loop extends to
	 * `2 * SELF_LOOP_RADIUS` to the right, plus label width.
	 */
	function selfLoopRightPad(
		desc: (typeof project.descriptions)[0],
		descName: string
	): number {
		const selfRefStmts = desc.statements.filter((s) =>
			(s.shapeRefs ?? []).includes(descName),
		);
		if (selfRefStmts.length === 0) return 0;
		// Loop extent (constant across stacked loops) + label budget.
		const loopExtent = SELF_LOOP_RADIUS * 2;
		const labelW = 80;
		return loopExtent + labelW + 8;
	}

	function measureNodeSize(
		desc: (typeof project.descriptions)[0],
		diagramStyle: 'detail' | 'overview',
		ns: Record<string, string>
	): { width: number; height: number; selfLoopPad: number } {
		if (diagramStyle === 'overview') {
			const displayName = desc.label || desc.name;
			const nameW = safeTextWidth(displayName, 13, 'bold') + 40;
			const w = Math.max(OVERVIEW_WIDTH, nameW);
			let h = OVERVIEW_HEIGHT;
			const selfRefCount = desc.statements.filter(
				(s) => (s.shapeRefs ?? []).includes(desc.name)
			).length;
			if (selfRefCount > 0) {
				h += selfRefCount * 16;
			}
			return { width: w, height: h, selfLoopPad: 0 };
		}
		// Detail mode: compute width from content using actual text measurement
		let maxPropWidth = 0;
		let maxTypeWidth = 0;
		for (const stmt of desc.statements) {
			const prop = compactIRI(stmt.propertyId, ns) || stmt.id;
			// Row property IRIs are rendered in JetBrains Mono; measure
			// with mono metrics so node width accommodates actual glyph
			// widths, not Inter's narrower ones.
			maxPropWidth = Math.max(maxPropWidth, safeTextWidth(prop, 10, 'bold', 'mono'));
			const tl = typeLabel(stmt, ns);
			const refs = stmt.shapeRefs ?? [];
			const prefix = refs.includes(desc.name) ? '\u21BA ' : (refs.length > 0 ? '\u2192 ' : '');
			maxTypeWidth = Math.max(maxTypeWidth, safeTextWidth(prefix + tl, 9, 'normal'));
		}
		const contentWidth = NODE_PAD_H + maxPropWidth + 20 + maxTypeWidth + CARD_COL_WIDTH + NODE_PAD_H;
		const headerLabelW = safeTextWidth(desc.label || desc.name, 12, 'bold') + 40;
		const width = Math.max(DETAIL_BASE_WIDTH, contentWidth, headerLabelW);
		const height =
			HEADER_HEIGHT + Math.max(desc.statements.length, 1) * ROW_HEIGHT + NODE_PAD_V;
		return { width, height, selfLoopPad: selfLoopRightPad(desc, desc.name) };
	}

	// ── Build ELK graph and compute layout ──────────────────────────

	async function computeLayout(
		proj: TapirProject,
		diagramStyle: 'detail' | 'overview'
	): Promise<void> {
		const descriptions = proj.descriptions || [];
		if (descriptions.length === 0) {
			layoutNodes = [];
			layoutEdges = [];
			baseViewBox = '0 0 400 200';
			layoutReady = true;
			layoutError = null;
			return;
		}

		const ns = proj.namespaces || {};
		const descNames = new Set(descriptions.map((d) => d.name));

		// Build ELK children and edges
		const children: Array<{
			id: string;
			width: number;
			height: number;
			ports?: Array<{ id: string; x: number; y: number; width: number; height: number }>;
			properties?: Record<string, string>;
		}> = [];
		const edges: Array<{
			id: string;
			sources: string[];
			targets: string[];
		}> = [];

		// Track node metadata for rendering
		const nodeMeta = new Map<string, LayoutNode>();
		const edgeMeta = new Map<
			string,
			{ propertyLabel: string; stmtLabel: string; cardinality: string }
		>();
		let edgeIdx = 0;

		for (let i = 0; i < descriptions.length; i++) {
			const desc = descriptions[i];
			const { width, height, selfLoopPad } = measureNodeSize(desc, diagramStyle, ns);
			const headerColor = pal.headers[i % pal.headers.length];

			const stmts = desc.statements.map((stmt) => {
				const prop = compactIRI(stmt.propertyId, ns) || stmt.id;
				const tl = typeLabel(stmt, ns);
				const card = formatCard(stmt.min, stmt.max);
				const refs = stmt.shapeRefs ?? [];
				const resolvedRefs = refs.filter((r) => descNames.has(r));
				const isRef = resolvedRefs.length > 0;
				const isSelfRef = resolvedRefs.length === 1 && resolvedRefs[0] === desc.name;
				return {
					id: stmt.id,
					propertyId: prop,
					label: stmt.label || '',
					typeLabel: tl,
					cardinality: card,
					isRef,
					isSelfRef,
					shapeRefs: refs,
				};
			});

			// Collect self-refs for overview
			const selfRefs: Array<{ prop: string; card: string }> = [];
			for (const stmt of desc.statements) {
				if ((stmt.shapeRefs ?? []).includes(desc.name)) {
					const prop = compactIRI(stmt.propertyId, ns) || stmt.id;
					const card = formatCard(stmt.min, stmt.max);
					selfRefs.push({ prop, card });
				}
			}

			const nodeId = `n_${desc.id}`;
			// Ports: one per statement row, anchored on the right edge at
			// the row's vertical centre. Each cross-reference edge targets
			// the port for its statement, so the edge emerges from the
			// correct row rather than from an arbitrary point on the node.
			// Elk's node width equals the visual width so the port x
			// coordinate aligns exactly with the rendered right edge.
			const portList = diagramStyle === 'detail'
				? desc.statements.map((stmt, si) => ({
					id: `p_${desc.id}_${stmt.id}`,
					x: width,
					y: HEADER_HEIGHT + si * ROW_HEIGHT + ROW_HEIGHT / 2,
					width: 1,
					height: 1,
				}))
				: [];
			// Reserve extra horizontal space for self-reference loops via
			// per-node layoutOptions rather than inflating the width, so
			// port x-coordinates remain on the rendered right edge.
			const nodeProperties: Record<string, string> = {};
			if (portList.length > 0) {
				nodeProperties['org.eclipse.elk.portConstraints'] = 'FIXED_POS';
			}
			if (selfLoopPad > 0) {
				// Keep-right padding tells Elk to reserve space on the right
				// of the node that counts toward inter-node spacing.
				nodeProperties['org.eclipse.elk.spacing.nodeNode'] = String(
					50 + selfLoopPad,
				);
			}
			children.push({
				id: nodeId,
				width,
				height,
				...(portList.length > 0 ? { ports: portList } : {}),
				...(Object.keys(nodeProperties).length > 0
					? { properties: nodeProperties }
					: {}),
			});

			nodeMeta.set(nodeId, {
				id: nodeId,
				descId: desc.id,
				name: desc.name,
				label: desc.label || desc.name,
				targetClass: desc.targetClass
					? compactIRI(desc.targetClass, ns)
					: '',
				x: 0,
				y: 0,
				width,
				height,
				headerColor,
				colorIndex: i,
				statements: stmts,
				selfRefs,
			});

			// Create edges for cross-references (not self-refs). One edge
			// per shape ref in the statement's list, sourced from the
			// statement's specific port so multi-ref statements emit
			// each edge from the correct row.
			for (const stmt of desc.statements) {
				for (const ref of stmt.shapeRefs ?? []) {
					if (ref === desc.name) continue;
					if (!descNames.has(ref)) continue;
					const targetDesc = descriptions.find((d) => d.name === ref);
					if (!targetDesc) continue;
					const prop = compactIRI(stmt.propertyId, ns) || stmt.id;
					const stmtLabel = stmt.label || '';
					const card = formatCard(stmt.min, stmt.max);
					const eid = `e_${edgeIdx++}`;
					const sourcePort = diagramStyle === 'detail'
						? `p_${desc.id}_${stmt.id}`
						: nodeId;
					edges.push({
						id: eid,
						sources: [sourcePort],
						targets: [`n_${targetDesc.id}`],
					});
					edgeMeta.set(eid, {
						propertyLabel: prop,
						stmtLabel: stmtLabel,
						cardinality: card,
					});
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
				// Orthogonal routing + rounded corners (beta.65).
				// `buildEdgePath` below collapses Elk's collinear
				// runs and rounds each real bend with a small arc.
				'elk.edgeRouting': 'ORTHOGONAL',
				'elk.layered.mergeEdges': 'false',
			},
			children,
			edges,
		};

		try {
			const result = await elk.layout(graph);

			// Map positions back to layout nodes
			const newNodes: LayoutNode[] = [];
			for (const child of result.children || []) {
				const meta = nodeMeta.get(child.id);
				if (meta) {
					newNodes.push({
						...meta,
						x: child.x ?? 0,
						y: child.y ?? 0,
						width: child.width ?? meta.width,
						height: child.height ?? meta.height,
					});
				}
			}

			// Map edges with routing
			const newEdges: LayoutEdge[] = [];
			for (const edge of result.edges || []) {
				const meta = edgeMeta.get(edge.id);
				const sections = (
					edge as unknown as {
						sections?: Array<{
							startPoint: { x: number; y: number };
							endPoint: { x: number; y: number };
							bendPoints?: Array<{ x: number; y: number }>;
						}>;
					}
				).sections;
				if (meta && sections) {
					newEdges.push({
						id: edge.id,
						sourceId: (edge.sources as string[])[0],
						targetId: (edge.targets as string[])[0],
						propertyLabel: meta.propertyLabel,
						stmtLabel: meta.stmtLabel || '',
						cardinality: meta.cardinality,
						sections,
					});
				}
			}

			layoutNodes = newNodes;
			layoutEdges = newEdges;

			// Compute viewBox from layout bounds
			let maxX = 400;
			let maxY = 200;

			for (const n of newNodes) {
				maxX = Math.max(maxX, n.x + n.width);
				maxY = Math.max(maxY, n.y + n.height);
			}
			// Account for self-ref loops extending beyond nodes
			for (const n of newNodes) {
				const selfRefCount = n.statements.filter(s => s.isSelfRef).length;
				if (selfRefCount > 0) {
					maxX = Math.max(maxX, n.x + n.width + 60 + selfRefCount * 10);
				}
			}
			for (const e of newEdges) {
				for (const s of e.sections) {
					maxX = Math.max(maxX, s.startPoint.x, s.endPoint.x);
					maxY = Math.max(maxY, s.startPoint.y, s.endPoint.y);
					for (const bp of s.bendPoints || []) {
						maxX = Math.max(maxX, bp.x);
						maxY = Math.max(maxY, bp.y);
					}
				}
			}

			baseViewBox = `${-PADDING} ${-PADDING} ${maxX + PADDING * 2} ${maxY + PADDING * 2}`;
			layoutReady = true;
			layoutError = null;
		} catch (err) {
			layoutError = String(err);
			layoutReady = true;
		}
	}

	// ── Debounced layout ────────────────────────────────────────────

	let debounceTimer: ReturnType<typeof setTimeout> | undefined;

	$effect(() => {
		const _proj = project;
		const _style = style;
		// Track the three display toggles so the effect re-runs when
		// they change — Elk's edge routing depends on label presence
		// and width reservations, so the layout has to recompute.
		const _showEdges = showEdges;
		const _showEdgeLabels = showEdgeLabels;
		const _showCard = showCardinality;

		if (debounceTimer) clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => {
			computeLayout(_proj, _style);
		}, 300);

		return () => {
			if (debounceTimer) clearTimeout(debounceTimer);
		};
	});

	// ── Edge path helpers ───────────────────────────────────────────

	/**
	 * Builds the SVG path string for an Elk-routed edge. Elk is
	 * configured with orthogonal routing; `roundedPath` collapses any
	 * collinear runs and rounds the remaining bends with small arcs
	 * so the preview matches the aesthetic of the PDF export.
	 */
	function buildEdgePath(section: LayoutEdge['sections'][0]): string {
		const points = [
			section.startPoint,
			...(section.bendPoints ?? []),
			section.endPoint,
		];
		return roundedPath(points, 8);
	}

	/**
	 * Position for the edge label — midpoint of the routed polyline,
	 * lifted 8 pt above the line so the label rect floats just above.
	 */
	function edgeLabelPos(section: LayoutEdge['sections'][0]): { x: number; y: number } {
		const points = [
			section.startPoint,
			...(section.bendPoints ?? []),
			section.endPoint,
		];
		return pointAlongPath(points);
	}

	// ── Self-ref loop path ──────────────────────────────────────────

	/**
	 * Builds the self-reference loop path for a statement at row
	 * `rowIndex` (absolute position in the statement list). The loop
	 * is a compact circular arc anchored to the row's right edge,
	 * exiting and returning at points 3 px above/below the row centre
	 * so the arrowhead lands cleanly on the row.
	 */
	function selfRefPath(
		node: LayoutNode,
		rowIndex: number
	): string {
		const x = node.x + node.width;
		const yRow =
			style === 'detail'
				? node.y + HEADER_HEIGHT + rowIndex * ROW_HEIGHT + ROW_HEIGHT / 2
				: node.y + node.height / 2;
		const r = SELF_LOOP_RADIUS;
		const exitY = yRow - 3;
		const returnY = yRow + 3;
		// SVG arc: rx ry x-axis-rot large-arc sweep endX endY.
		// sweep-flag=1 draws the arc clockwise (outward to the right).
		return (
			`M ${x} ${exitY}` +
			` A ${r} ${r} 0 1 1 ${x} ${returnY}`
		);
	}

	function selfRefLabelPos(
		node: LayoutNode,
		rowIndex: number
	): { x: number; y: number } {
		const x = node.x + node.width;
		const yRow =
			style === 'detail'
				? node.y + HEADER_HEIGHT + rowIndex * ROW_HEIGHT + ROW_HEIGHT / 2
				: node.y + node.height / 2;
		// Place the label just to the right of the loop's outer arc.
		return { x: x + SELF_LOOP_RADIUS * 2 + 4, y: yRow };
	}

	// ── Edge label sizing ───────────────────────────────────────────

	function edgeLabelWidth(edge: LayoutEdge): number {
		// Edge labels always display as "{label-or-property} [card]" when
		// rendered at all. This function computes the width reservation
		// for Elk; the rendering gate lives in the template. Prefer the
		// statement's human-readable label when present, fall back to
		// the property IRI.
		const labelText = edge.stmtLabel || edge.propertyLabel;
		// Edge labels render in JetBrains Mono; measure with mono
		// metrics so the background rect actually covers the text.
		return safeTextWidth(`${labelText} [${edge.cardinality}]`, 8, 'normal', 'mono') + 12;
	}

	// ── Interactivity ───────────────────────────────────────────────

	/**
	 * Clicking a shape in the *collapsed* sidebar view selects that
	 * description in the editor — handy as a navigation shortcut. In
	 * the expanded full-screen view the diagram is a read-only
	 * exploration surface (zoom/pan), so clicks are suppressed.
	 */
	function handleNodeClick(descId: string): void {
		if (expanded) return;
		selectedDescriptionId.set(descId);
	}

	// ── Exports ─────────────────────────────────────────────────────

	function exportSvg(): void {
		if (!svgEl) return;
		const serializer = new XMLSerializer();
		const svgString = '<?xml version="1.0" encoding="UTF-8"?>\n' +
			serializer.serializeToString(svgEl);
		downloadText(svgString, `${project.name || 'diagram'}.svg`, 'image/svg+xml');
	}

	let exportingPng = $state(false);

	async function exportPng(): Promise<void> {
		if (!svgEl || exportingPng) return;
		exportingPng = true;

		try {
			const serializer = new XMLSerializer();
			const svgString = serializer.serializeToString(svgEl);

			const vb = svgEl.getAttribute('viewBox')?.split(/\s+/).map(Number) || [0, 0, 800, 600];
			// Use 4x scale for high-DPI / print quality (min 4000px wide)
			const minWidth = 4000;
			const scale = Math.max(4, Math.ceil(minWidth / vb[2]));
			const width = vb[2] * scale;
			const height = vb[3] * scale;

			// Set explicit dimensions on the SVG so the browser renders at full resolution
			const sizedSvg = svgString
				.replace(/<svg([^>]*)>/, `<svg$1 width="${width}" height="${height}">`);

			const blob = new Blob([sizedSvg], { type: 'image/svg+xml;charset=utf-8' });
			const url = URL.createObjectURL(blob);
			const img = new Image();

			await new Promise<void>((resolve, reject) => {
				img.onload = () => resolve();
				img.onerror = () => reject(new Error('Failed to load SVG as image'));
				img.src = url;
			});

			const canvas = document.createElement('canvas');
			canvas.width = width;
			canvas.height = height;
			const ctx = canvas.getContext('2d');
			if (!ctx) throw new Error('Canvas 2D context not available');

			ctx.fillStyle = '#ffffff';
			ctx.fillRect(0, 0, width, height);
			ctx.drawImage(img, 0, 0, width, height);

			URL.revokeObjectURL(url);

			const pngBlob = await new Promise<Blob | null>((resolve) => {
				canvas.toBlob(resolve, 'image/png');
			});

			if (pngBlob) {
				const downloadUrl = URL.createObjectURL(pngBlob);
				const a = document.createElement('a');
				a.href = downloadUrl;
				a.download = `${project.name || 'diagram'}.png`;
				document.body.appendChild(a);
				a.click();
				document.body.removeChild(a);
				URL.revokeObjectURL(downloadUrl);
			}
		} catch (err) {
			console.error('PNG export failed:', err);
		} finally {
			exportingPng = false;
		}
	}

	function exportDot(): void {
		const diagramStyle: DiagramStyle =
			style === 'overview' ? 'overview' : 'color';
		const dot = buildDiagram(project, diagramStyle);
		downloadText(dot, `${project.name || 'diagram'}.dot`, 'text/vnd.graphviz');
	}

	let exportingPdf = $state(false);

	async function exportPdf(): Promise<void> {
		if (exportingPdf) return;
		exportingPdf = true;
		try {
			// Re-render through the shared SVG builder rather than the
			// live DOM. svg2pdf needs `text-anchor="start"` for edge
			// labels and explicit font-family declarations on every
			// `<text>`; the live preview SVG uses `text-anchor="middle"`
			// for browser layout, so feeding it directly to svg2pdf
			// drifts the labels relative to their backgrounds.
			const settings = getDiagramSettings();
			const svg = await buildExportSvg(project, settings);
			const { svgToPdfBlob } = await import('$lib/utils/svg-to-pdf');
			const pdfBlob = await svgToPdfBlob(svg);
			const suffix = settings.palette === 'bw' ? '-diagram-bw' : '-diagram';
			downloadBlob(pdfBlob, `${project.name || 'diagram'}${suffix}.pdf`);
		} catch (err) {
			console.error('PDF export failed:', err);
		} finally {
			exportingPdf = false;
		}
	}

	// ── XML escape ──────────────────────────────────────────────────

	function escXml(s: string): string {
		return s
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;');
	}
</script>

<div
	class="flex h-full flex-col border-l border-border bg-card"
	class:fixed={expanded}
	class:inset-0={expanded}
	class:z-40={expanded}
>
	<!-- Toolbar -->
	<div class="flex items-center justify-between border-b border-border px-2 py-1.5">
		<span class="text-xs font-medium text-muted-foreground">Diagram</span>

		<div class="flex items-center gap-0.5">
			<!-- Settings popover -->
			<Popover>
				<PopoverTrigger>
					<button
						class="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground [&_svg]:pointer-events-none"
						title="Diagram settings"
					>
						<Settings2 class="h-3.5 w-3.5" />
					</button>
				</PopoverTrigger>
				<PopoverContent class="w-52 p-0" align="end">
					<div class="px-3 py-2">
						<p class="text-xs font-medium text-foreground">Diagram Settings</p>
					</div>
					<Separator />
					<div class="p-2 space-y-2">
						<!-- Style -->
						<div>
							<p class="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">Style</p>
							<div class="flex rounded-md border border-border text-xs w-full">
								<button
									class="flex-1 px-2 py-1 transition {style === 'detail'
										? 'bg-accent font-medium text-accent-foreground'
										: 'text-muted-foreground hover:bg-accent/50'}"
									onclick={() => diagramSettings.update((s) => ({ ...s, style: 'detail' }))}
								>
									Detail
								</button>
								<button
									class="flex-1 px-2 py-1 transition {style === 'overview'
										? 'bg-accent font-medium text-accent-foreground'
										: 'text-muted-foreground hover:bg-accent/50'}"
									onclick={() => diagramSettings.update((s) => ({ ...s, style: 'overview' }))}
								>
									Overview
								</button>
							</div>
						</div>

						<!-- Display toggles.
							 - Show edge labels depends on Show edges: labels
							   have nothing to attach to if edges are hidden,
							   so the checkbox greys out when edges are off.
							 - Show label / Show property have an at-least-
							   one-on invariant enforced by the store helpers.
							   Turning off the only on option auto-flips the
							   other. -->
						<div>
							<p class="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">Display</p>
							<div class="space-y-1.5">
								<label class="flex items-center justify-between cursor-pointer">
									<span class="text-xs text-foreground">Show labels</span>
									<input
										type="checkbox"
										checked={$diagramSettings.showLabel}
										onchange={(e) => toggleShowLabel((e.currentTarget as HTMLInputElement).checked)}
										class="h-3.5 w-3.5 rounded border-border accent-primary"
									/>
								</label>
								<label class="flex items-center justify-between cursor-pointer">
									<span class="text-xs text-foreground">Show properties</span>
									<input
										type="checkbox"
										checked={$diagramSettings.showProperty}
										onchange={(e) => toggleShowProperty((e.currentTarget as HTMLInputElement).checked)}
										class="h-3.5 w-3.5 rounded border-border accent-primary"
									/>
								</label>
								<label class="flex items-center justify-between cursor-pointer">
									<span class="text-xs text-foreground">Show edges</span>
									<input
										type="checkbox"
										checked={$diagramSettings.showEdges}
										onchange={(e) => diagramSettings.update((s) => ({ ...s, showEdges: (e.currentTarget as HTMLInputElement).checked }))}
										class="h-3.5 w-3.5 rounded border-border accent-primary"
									/>
								</label>
								<label class="flex items-center justify-between {$edgeLabelsDisabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}">
									<span class="text-xs text-foreground">Show edge labels</span>
									<input
										type="checkbox"
										checked={$diagramSettings.showEdgeLabels}
										disabled={$edgeLabelsDisabled}
										onchange={(e) => diagramSettings.update((s) => ({ ...s, showEdgeLabels: (e.currentTarget as HTMLInputElement).checked }))}
										class="h-3.5 w-3.5 rounded border-border accent-primary"
									/>
								</label>
								<label class="flex items-center justify-between cursor-pointer">
									<span class="text-xs text-foreground">Show cardinality</span>
									<input
										type="checkbox"
										checked={$diagramSettings.showCardinality}
										onchange={(e) => diagramSettings.update((s) => ({ ...s, showCardinality: (e.currentTarget as HTMLInputElement).checked }))}
										class="h-3.5 w-3.5 rounded border-border accent-primary"
									/>
								</label>
							</div>
						</div>

						<!-- Export -->
						<Separator />
						<div>
							<p class="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">Export</p>
							<div class="grid grid-cols-2 gap-1.5">
								<button
									onclick={exportSvg}
									class="flex items-center justify-center gap-1 rounded-md border border-border px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground [&_svg]:pointer-events-none"
								>
									<Download class="h-3 w-3" />
									SVG
								</button>
								<button
									onclick={exportPng}
									disabled={exportingPng}
									class="flex items-center justify-center gap-1 rounded-md border border-border px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-50 [&_svg]:pointer-events-none"
								>
									<Download class="h-3 w-3" />
									{exportingPng ? '...' : 'PNG'}
								</button>
								<button
									onclick={exportPdf}
									disabled={exportingPdf}
									class="flex items-center justify-center gap-1 rounded-md border border-border px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-50 [&_svg]:pointer-events-none"
								>
									<FileText class="h-3 w-3" />
									{exportingPdf ? '...' : 'PDF'}
								</button>
								<button
									onclick={exportDot}
									class="flex items-center justify-center gap-1 rounded-md border border-border px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground [&_svg]:pointer-events-none"
								>
									<FileCode2 class="h-3 w-3" />
									DOT
								</button>
							</div>
						</div>
					</div>
				</PopoverContent>
			</Popover>

			<!-- Zoom controls (only in expanded/full-screen view) -->
			{#if expanded}
				<div class="flex items-center gap-1 border-r border-border pr-2 mr-1">
					<button
						onclick={zoomOut}
						class="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground [&_svg]:pointer-events-none disabled:opacity-40"
						disabled={zoom <= 0.25}
						title="Zoom out (wheel down)"
					>
						<ZoomOut class="h-3.5 w-3.5" />
					</button>
					<input
						type="range"
						min="0.25"
						max="4"
						step="0.05"
						value={zoom}
						oninput={(e) => (zoom = Number((e.target as HTMLInputElement).value))}
						class="h-1 w-32 cursor-pointer accent-primary"
						title="Zoom: {Math.round(zoom * 100)}%"
					/>
					<button
						onclick={zoomIn}
						class="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground [&_svg]:pointer-events-none disabled:opacity-40"
						disabled={zoom >= 4}
						title="Zoom in (wheel up)"
					>
						<ZoomIn class="h-3.5 w-3.5" />
					</button>
					<button
						onclick={resetView}
						class="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground [&_svg]:pointer-events-none"
						title="Reset zoom and pan"
					>
						<Locate class="h-3.5 w-3.5" />
					</button>
					<span class="text-[10px] text-muted-foreground tabular-nums w-10 text-right">
						{Math.round(zoom * 100)}%
					</span>
				</div>
			{/if}

			<!-- Expand/collapse -->
			<button
				onclick={() => {
					expanded = !expanded;
					// Reset zoom/pan when leaving expanded mode so
					// collapsing always shows the full fit view.
					if (!expanded) resetView();
				}}
				class="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground [&_svg]:pointer-events-none"
				title={expanded ? 'Minimize' : 'Maximize'}
			>
				{#if expanded}
					<Minimize2 class="h-3.5 w-3.5" />
				{:else}
					<Maximize2 class="h-3.5 w-3.5" />
				{/if}
			</button>
		</div>
	</div>

	<!-- SVG Viewport -->
	<div class="flex-1 overflow-auto p-4">
		{#if !layoutReady}
			<div
				class="flex h-full items-center justify-center text-sm text-muted-foreground"
			>
				Loading diagram...
			</div>
		{:else if layoutError}
			<div
				class="flex h-full items-center justify-center text-sm text-destructive"
			>
				Layout error: {layoutError}
			</div>
		{:else if layoutNodes.length === 0}
			<svg
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 400 200"
				class="h-full w-full"
			>
				<text
					x="200"
					y="100"
					text-anchor="middle"
					fill="#999"
					font-family="Inter, system-ui, sans-serif"
					font-size="14"
				>
					No descriptions to display
				</text>
			</svg>
		{:else}
			<!--
				The SVG fits the viewport in both collapsed and expanded
				modes. In expanded mode the viewBox is also scaled +
				translated by the zoom/pan state so the user can explore
				dense graphs with the zoom controls or drag-to-pan.
			-->
			<svg
				bind:this={svgEl}
				xmlns="http://www.w3.org/2000/svg"
				{viewBox}
				class="h-full w-full {expanded
					? `select-none ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`
					: ''}"
				font-family="Inter, system-ui, -apple-system, sans-serif"
				onpointerdown={handlePointerDown}
				onpointermove={handlePointerMove}
				onpointerup={handlePointerUp}
				onpointercancel={handlePointerUp}
				onwheel={handleWheel}
			>
				<!-- Arrowhead markers -->
				<defs>
					<!-- Cross-edge arrowhead — sized for the thin 0.6–0.75 px
						 stroke. Hover and self-ref markers keep the original
						 chunkier 8×6 so they read as signals. refX is pulled
						 inside the triangle so the arrowhead meets the node
						 border without the tiny gap a tip-anchored marker
						 leaves on a thin stroke. -->
					<marker
						id="arrowhead"
						markerWidth="6"
						markerHeight="4.5"
						refX="5"
						refY="2.25"
						orient="auto"
					>
						<polygon points="0 0, 6 2.25, 0 4.5" fill={pal.edgeColor} />
					</marker>
					<!-- Hover arrowhead — same refX inset trick as the
						 cross-edge marker to close the gap against the node
						 border. Kept at the full 8×6 so the hover state
						 still reads as a prominent highlight. -->
					<marker
						id="arrowhead-hover"
						markerWidth="8"
						markerHeight="6"
						refX="7"
						refY="3"
						orient="auto"
					>
						<polygon points="0 0, 8 3, 0 6" fill="#1565C0" />
					</marker>
					<marker
						id="arrowhead-selfref"
						markerWidth="8"
						markerHeight="6"
						refX="8"
						refY="3"
						orient="auto"
					>
						<polygon points="0 0, 8 3, 0 6" fill="#6A1B9A" />
					</marker>
					<!-- Clip paths for rounded corners per-node -->
					{#each layoutNodes as node (node.id)}
						<clipPath id="clip-header-{node.id}">
							<rect
								x={node.x}
								y={node.y}
								width={node.width}
								height={HEADER_HEIGHT}
								rx="6"
								ry="6"
							/>
							<rect
								x={node.x}
								y={node.y + HEADER_HEIGHT - 6}
								width={node.width}
								height="6"
							/>
						</clipPath>
						<clipPath id="clip-body-{node.id}">
							<rect
								x={node.x}
								y={node.y + HEADER_HEIGHT}
								width={node.width}
								height={node.height - HEADER_HEIGHT}
								rx="0"
								ry="0"
							/>
							<rect
								x={node.x}
								y={node.y + node.height - 6}
								width={node.width}
								height="6"
								rx="6"
								ry="6"
							/>
						</clipPath>
					{/each}
				</defs>

				<!-- Background -->
				<rect
					x={-PADDING}
					y={-PADDING}
					width="100%"
					height="100%"
					fill={pal.graphBg}
				/>

				<!-- Edges (render behind nodes). Entire group is
					 suppressed when Show-edges is off — neither the
					 visible path, the hit area, nor the label block
					 renders. -->
				{#if showEdges}
				{#each layoutEdges as edge, edgeIdx (edge.id)}
					{#each edge.sections as section, si}
						{@const isHovered = hoveredEdgeId === edge.id}
						<!-- Invisible wider hit area for hover -->
						<path
							d={buildEdgePath(section)}
							fill="none"
							stroke="transparent"
							stroke-width="12"
							onmouseenter={() => (hoveredEdgeId = edge.id)}
							onmouseleave={() => (hoveredEdgeId = null)}
							style="cursor: {expanded ? 'inherit' : 'pointer'};"
						/>
						<!-- Visible edge -->
						<path
							d={buildEdgePath(section)}
							fill="none"
							stroke={isHovered ? '#1565C0' : pal.edgeColor}
							stroke-width={isHovered ? 2 : pal.edgeWidth}
							marker-end={isHovered
								? 'url(#arrowhead-hover)'
								: 'url(#arrowhead)'}
							style="transition: stroke 0.15s, stroke-width 0.15s; pointer-events: none;"
						/>
						<!-- Edge label: the `property [card]` text riding on
							 the edge line. Gated on `showEdgeLabels` so the
							 user can strip decoration without losing the
							 edge itself. The inline "stmtLabel vs
							 propertyLabel" choice below simply prefers the
							 statement's display label when non-empty. -->
						{#if showEdgeLabels}
							{@const labelPos = edgeLabelPos(section)}
							{@const lblWidth = edgeLabelWidth(edge)}
							<g
								onmouseenter={() => (hoveredEdgeId = edge.id)}
								onmouseleave={() => (hoveredEdgeId = null)}
								style="cursor: {expanded ? 'inherit' : 'pointer'};"
							>
								<rect
									x={labelPos.x - lblWidth / 2}
									y={labelPos.y - 10}
									width={lblWidth}
									height="16"
									fill={pal.edgeLabelBg}
									opacity="0.9"
									rx="3"
									stroke={isHovered ? '#1565C0' : '#e0e0e0'}
									stroke-width="0.5"
								/>
								<text
									x={labelPos.x}
									y={labelPos.y + 2}
									text-anchor="middle"
									font-size="8"
									font-family="var(--font-mono, monospace)"
									fill={isHovered ? '#1565C0' : pal.edgeLabelText}
									style="transition: fill 0.15s;"
								>
									{edge.stmtLabel || edge.propertyLabel} [{edge.cardinality}]
								</text>
							</g>
						{/if}
					{/each}
				{/each}
				{/if}

				<!-- Nodes -->
				{#each layoutNodes as node (node.id)}
					{@const isHovered = hoveredNodeId === node.id}
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
					<g
						onclick={() => handleNodeClick(node.descId)}
						onmouseenter={() => (hoveredNodeId = node.id)}
						onmouseleave={() => (hoveredNodeId = null)}
						style="cursor: {expanded ? 'inherit' : 'pointer'};"
					>
						{#if style === 'detail'}
							<!-- Detail mode: ER-style table -->
							<!-- Outer border with full rounding -->
							<rect
								x={node.x}
								y={node.y}
								width={node.width}
								height={node.height}
								rx="6"
								fill={pal.bodyBg}
								stroke={isHovered ? '#1565C0' : pal.border}
								stroke-width={isHovered ? 2 : 1.5}
								style="transition: stroke 0.15s, stroke-width 0.15s;"
							/>
							<!-- Header background (top corners rounded) -->
							<rect
								x={node.x + 0.75}
								y={node.y + 0.75}
								width={node.width - 1.5}
								height={HEADER_HEIGHT}
								rx="5"
								fill={node.headerColor}
							/>
							<!-- Fill gap below header rounded corners -->
							<rect
								x={node.x + 0.75}
								y={node.y + HEADER_HEIGHT - 6}
								width={node.width - 1.5}
								height="6.75"
								fill={node.headerColor}
							/>
							<!-- Separator line between header and body -->
							<line
								x1={node.x}
								y1={node.y + HEADER_HEIGHT}
								x2={node.x + node.width}
								y2={node.y + HEADER_HEIGHT}
								stroke={pal.border}
								stroke-width="0.75"
								opacity="0.5"
							/>
							<!-- Header text -->
							<text
								x={node.x + node.width / 2}
								y={node.y + 20}
								text-anchor="middle"
								font-size="12"
								font-weight="bold"
								font-family="var(--font-sans, sans-serif)"
								fill={pal.headerText}
							>
								{node.label}
							</text>
							{#if node.targetClass}
								<text
									x={node.x + node.width / 2}
									y={node.y + 34}
									text-anchor="middle"
									font-size="9"
									font-family="var(--font-mono, monospace)"
									fill={pal.typeText}
									font-style="italic"
								>
									{node.targetClass}
								</text>
							{/if}

							<!-- Statement rows -->
							{#if node.statements.length === 0}
								<text
									x={node.x + NODE_PAD_H}
									y={node.y + HEADER_HEIGHT + 18}
									font-size="10"
									font-family="var(--font-sans, sans-serif)"
									fill="#999"
									font-style="italic"
								>
									no properties
								</text>
							{:else}
								{#each node.statements as stmt, si}
									{@const rowY =
										node.y + HEADER_HEIGHT + si * ROW_HEIGHT}
									<!-- Row stripe -->
									<rect
										x={node.x + 1}
										y={rowY}
										width={node.width - 2}
										height={ROW_HEIGHT}
										fill={si % 2 === 1
											? pal.stripeBg
											: pal.bodyBg}
										rx={si === node.statements.length - 1 ? '5' : '0'}
									/>
									<!-- Row content.
										 - label only: human-readable "Creator"
										 - property only: IRI "dct:creator" (monospace)
										 - both: label bold on top, IRI muted below.
										 The at-least-one invariant lives in the
										 store, so at least one branch always
										 fires. `stmt.label` may be empty even
										 when showLabel is on; we fall back to
										 the propertyId in that case so the row
										 never renders blank. -->
									{#if showBoth}
										<text
											x={node.x + NODE_PAD_H}
											y={rowY + 11}
											font-size="10"
											font-weight="bold"
											font-family="var(--font-sans, sans-serif)"
											fill={pal.bodyText}
										>
											{stmt.label || stmt.propertyId}
										</text>
										<text
											x={node.x + NODE_PAD_H}
											y={rowY + 22}
											font-size="8"
											font-family="var(--font-mono, monospace)"
											fill={pal.typeText}
										>
											{stmt.propertyId}
										</text>
									{:else if showLabel}
										<text
											x={node.x + NODE_PAD_H}
											y={rowY + 17}
											font-size="10"
											font-weight="bold"
											font-family="var(--font-sans, sans-serif)"
											fill={pal.bodyText}
										>
											{stmt.label || stmt.propertyId}
										</text>
									{:else}
										<text
											x={node.x + NODE_PAD_H}
											y={rowY + 17}
											font-size="10"
											font-weight="bold"
											font-family="var(--font-mono, monospace)"
											fill={pal.bodyText}
										>
											{stmt.propertyId}
										</text>
									{/if}
									<!-- Type label. Aligns with the top line when
										 both label + property are shown (two-
										 line rows), otherwise centred. Uses
										 the sans face — the right-hand text is
										 always a short word or shape name
										 ("Literal", "→ Person"), never IRI-
										 shaped, so proportional reads better. -->
									{@const metaY = showBoth ? rowY + 11 : rowY + 17}
									{#if stmt.isSelfRef}
										<text
											x={node.x + node.width - CARD_COL_WIDTH - NODE_PAD_H + 4}
											y={metaY}
											text-anchor="end"
											font-size="9"
											font-weight="normal"
											font-family="var(--font-sans, sans-serif)"
											fill={pal.selfRefText}
										>
											&#x21BA; {stmt.typeLabel}
										</text>
									{:else if stmt.isRef}
										<text
											x={node.x + node.width - CARD_COL_WIDTH - NODE_PAD_H + 4}
											y={metaY}
											text-anchor="end"
											font-size="9"
											font-weight="normal"
											font-family="var(--font-sans, sans-serif)"
											fill={pal.refText}
										>
											&#x2192; {stmt.typeLabel}
										</text>
									{:else}
										<text
											x={node.x + node.width - CARD_COL_WIDTH - NODE_PAD_H + 4}
											y={metaY}
											text-anchor="end"
											font-size="9"
											font-family="var(--font-sans, sans-serif)"
											fill={pal.typeText}
										>
											{stmt.typeLabel}
										</text>
									{/if}
									<!-- Cardinality — monospace because it's a
										 structural code (`0..*`, `1..1`), not
										 prose; tabular numerals stay lined up. -->
									{#if showCardinality}
										<text
											x={node.x + node.width - NODE_PAD_H}
											y={metaY}
											text-anchor="end"
											font-size="9"
											font-family="var(--font-mono, monospace)"
											fill={pal.cardText}
										>
											{stmt.cardinality}
										</text>
									{/if}
								{/each}
							{/if}
						{:else}
							<!-- Overview mode: simple rounded box -->
							<rect
								x={node.x}
								y={node.y}
								width={node.width}
								height={node.height}
								rx="8"
								fill={node.headerColor}
								stroke={isHovered ? '#1565C0' : pal.border}
								stroke-width={isHovered ? 2 : 1.5}
								style="transition: stroke 0.15s, stroke-width 0.15s;"
							/>
							<text
								x={node.x + node.width / 2}
								y={node.y + 22}
								text-anchor="middle"
								font-size="13"
								font-weight="bold"
								font-family="var(--font-sans, sans-serif)"
								fill={pal.headerText}
							>
								{node.label}
							</text>
							{#if node.targetClass}
								<text
									x={node.x + node.width / 2}
									y={node.y + 38}
									text-anchor="middle"
									font-size="11"
									font-family="var(--font-mono, monospace)"
									fill={pal.typeText}
								>
									{node.targetClass}
								</text>
							{/if}
							<!-- Self-refs in overview -->
							{#each node.selfRefs as ref, ri}
								<text
									x={node.x + node.width / 2}
									y={node.y + 54 + ri * 16}
									text-anchor="middle"
									font-size="9"
									font-style="italic"
									font-family="var(--font-mono, monospace)"
									fill={pal.selfRefText}
								>
									&#x21BA; {ref.prop} [{ref.card}]
								</text>
							{/each}
						{/if}
					</g>

					<!-- Self-reference loops (rendered outside the clickable group).
						 Iterate statements in their absolute order so the loop
						 anchor y matches the row's y exactly. Non-self-ref
						 statements are skipped inside the block — this keeps
						 the index tied to the row position rather than a
						 filtered sub-array. -->
					{#if style === 'detail' && showEdges}
						{#each node.statements as stmt, stmtIdx}
						{#if stmt.isSelfRef}
							{@const loopLabelPos = selfRefLabelPos(node, stmtIdx)}
							<path
								d={selfRefPath(node, stmtIdx)}
								fill="none"
								stroke={pal.selfRefText}
								stroke-width="1.5"
								marker-end="url(#arrowhead-selfref)"
								opacity="0.7"
							/>
							<!-- Self-ref label — gated on Show-edge-labels
								 so the loop can be drawn bare (just the
								 arrow) when the user wants a cleaner view. -->
							{#if showEdgeLabels}
								{@const selfLabelText = (stmt.label || stmt.propertyId) + ` [${stmt.cardinality}]`}
								{@const selfLabelW = safeTextWidth(selfLabelText, 8, 'normal', 'mono') + 8}
								<rect
									x={loopLabelPos.x}
									y={loopLabelPos.y - 6}
									width={selfLabelW}
									height="13"
									fill={pal.edgeLabelBg}
									rx="2"
									opacity="0.9"
									stroke="#e0e0e0"
									stroke-width="0.5"
								/>
								<text
									x={loopLabelPos.x + selfLabelW / 2}
									y={loopLabelPos.y + 4}
									text-anchor="middle"
									font-size="8"
									font-family="var(--font-mono, monospace)"
									fill={pal.selfRefText}
								>
									{selfLabelText}
								</text>
							{/if}
						{/if}
						{/each}
					{/if}
				{/each}
			</svg>
		{/if}
	</div>
</div>
