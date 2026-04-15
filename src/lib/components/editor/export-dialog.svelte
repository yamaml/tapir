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
	import {
		simpleDspLang,
		diagramSettings,
		edgeLabelsDisabled,
		getDiagramSettings,
	} from '$lib/stores';
	import {
		DEFAULT_DIAGRAM_SETTINGS,
		toggleShowLabel,
		toggleShowProperty,
	} from '$lib/stores/diagram-settings-store';
	import { validateProject } from '$lib/utils/validation';
	import { buildYamaYaml } from '$lib/converters/yaml-generator';
	import { buildYamaJson } from '$lib/converters/json-generator';
	import { buildDataPackage } from '$lib/converters/datapackage-generator';
	import { buildDiagram } from '$lib/converters/diagram-generator';
	import { generateHtmlReport } from '$lib/converters/report-generator';
	import { generatePackageZip } from '$lib/converters/package-generator';
	import { buildExportSvg } from '$lib/converters/export-svg-builder';
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
	import Check from 'lucide-svelte/icons/check';
	import { fade } from 'svelte/transition';

	interface Props {
		project: TapirProject;
		open: boolean;
		onclose: () => void;
	}

	let { project, open = $bindable(), onclose }: Props = $props();

	let exporting = $state(false);
	let exportError = $state<string | null>(null);

	// ── Post-export feedback ────────────────────────────────────────
	//
	// After a successful individual-format export the modal now stays
	// open so the user can keep exporting from the same session
	// (they may want SVG + PDF + DOT of the same diagram, or several
	// tabular flavours in a row). We signal "the download fired" in
	// two ways that clear on the same timer so they stay in sync:
	//
	// - Banner: a thin green stripe just below the header showing the
	//   emitted filename, visible for 3 s.
	// - Card highlight: the card that was just clicked swaps its
	//   chevron for a check icon and tints its background green.
	//
	// The Profile Package (.zip) is treated as a terminal action and
	// still closes the modal — it's the "I'm done, give me everything"
	// exit path.
	let lastExportedId = $state<string | null>(null);
	let lastExportedFilename = $state<string | null>(null);
	let feedbackTimer: ReturnType<typeof setTimeout> | null = null;

	function flashSuccess(optionId: string, filename: string): void {
		if (feedbackTimer !== null) clearTimeout(feedbackTimer);
		lastExportedId = optionId;
		lastExportedFilename = filename;
		feedbackTimer = setTimeout(() => {
			lastExportedId = null;
			lastExportedFilename = null;
			feedbackTimer = null;
		}, 3000);
	}

	// ── SVG/PNG Export Helpers ──────────────────────────────────────

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
	 * Diagram exports. Style, palette, and the three display toggles
	 * all come from the shared `diagramSettings` store — see the
	 * settings panel above. Each button calls `generateExportSvg` with
	 * a snapshot of the current settings.
	 */
	const diagramOptions: ExportOption[] = [
		{ id: 'diagram-svg', label: 'SVG', ext: '.svg', category: 'Diagrams', description: 'Vector diagram (best quality, scalable).' },
		{ id: 'diagram-pdf', label: 'PDF', ext: '.pdf', category: 'Diagrams', description: 'Vector diagram as PDF — selectable text, ideal for LaTeX figures and archival.' },
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

			// Tracks the actual filename each branch emitted, so the
			// success banner can show it verbatim. `null` after the
			// switch means the branch didn't emit anything (error
			// case) — handled below.
			let emitted: string | null = null;

			switch (optionId) {
				case 'simpledsp-tsv': {
					const content = buildSimpleDsp(project, { lang: $simpleDspLang });
					emitted = `${name}.tsv`;
					downloadText(content, emitted, 'text/tab-separated-values');
					break;
				}
				case 'simpledsp-csv': {
					const tsvContent = buildSimpleDsp(project, { lang: $simpleDspLang });
					const content = tsvToCsv(tsvContent);
					emitted = `${name}-simpledsp.csv`;
					downloadText(content, emitted, 'text/csv');
					break;
				}
				case 'dctap-csv': {
					const content = dctapRowsToCsv(',');
					emitted = `${name}-dctap.csv`;
					downloadText(content, emitted, 'text/csv');
					break;
				}
				case 'dctap-tsv': {
					const content = dctapRowsToCsv('\t');
					emitted = `${name}-dctap.tsv`;
					downloadText(content, emitted, 'text/tab-separated-values');
					break;
				}
				case 'shacl-turtle': {
					const content = await buildShacl(project, 'turtle');
					emitted = `${name}.shacl.ttl`;
					downloadText(content, emitted, 'text/turtle');
					break;
				}
				case 'shex': {
					const content = buildShExC(project);
					emitted = `${name}.shex`;
					downloadText(content, emitted, 'text/shex');
					break;
				}
				case 'owldsp-turtle': {
					const content = await buildOwlDsp(project, 'turtle');
					emitted = `${name}.owldsp.ttl`;
					downloadText(content, emitted, 'text/turtle');
					break;
				}
				case 'yaml': {
					const content = buildYamaYaml(project);
					emitted = `${name}.yaml`;
					downloadText(content, emitted, 'text/yaml');
					break;
				}
				case 'json': {
					const content = buildYamaJson(project);
					emitted = `${name}.json`;
					downloadText(content, emitted, 'application/json');
					break;
				}
				case 'datapackage': {
					const content = buildDataPackage(project);
					emitted = `${name}-datapackage.json`;
					downloadText(content, emitted, 'application/json');
					break;
				}
				case 'diagram-svg': {
					const settings = getDiagramSettings();
					const svg = await buildExportSvg(project, settings);
					const suffix = settings.palette === 'bw' ? '-diagram-bw' : '-diagram';
					emitted = `${name}${suffix}.svg`;
					downloadText(svg, emitted, 'image/svg+xml');
					break;
				}
				case 'diagram-pdf': {
					// svgToPdfBlob lazy-loads jspdf + svg2pdf.js so the
					// PDF code only downloads when a user clicks this
					// option.
					const settings = getDiagramSettings();
					const svg = await buildExportSvg(project, settings);
					const { svgToPdfBlob } = await import('$lib/utils/svg-to-pdf');
					const pdfBlob = await svgToPdfBlob(svg);
					const suffix = settings.palette === 'bw' ? '-diagram-bw' : '-diagram';
					emitted = `${name}${suffix}.pdf`;
					downloadBlob(pdfBlob, emitted);
					break;
				}
				case 'diagram-png': {
					const settings = getDiagramSettings();
					const svgForPng = await buildExportSvg(project, settings);
					const suffix = settings.palette === 'bw' ? '-diagram-bw' : '-diagram';
					emitted = `${name}${suffix}.png`;
					await svgToPng(svgForPng, emitted);
					break;
				}
				case 'diagram-dot': {
					const dot = buildDiagram(project, $diagramSettings.palette);
					emitted = `${name}.dot`;
					downloadText(dot, emitted, 'text/vnd.graphviz');
					break;
				}
				case 'report-html': {
					// The HTML report's embedded diagram tracks the user's
					// current diagram settings — same "what you see is what
					// you export" model as the individual diagram formats.
					const reportSvg = await buildExportSvg(project, getDiagramSettings());
					const html = generateHtmlReport(project, reportSvg);
					emitted = `${name}-report.html`;
					downloadText(html, emitted, 'text/html');
					break;
				}
				case 'package-zip': {
					// The ZIP package is archive-grade: always uses hardcoded
					// defaults (detail + colour + all display toggles on) so
					// the bundle is predictable regardless of the user's
					// current UI state. If they want a custom-styled diagram
					// alongside, they can export it separately and add it
					// to the archive themselves.
					const pkgSvg = await buildExportSvg(project, DEFAULT_DIAGRAM_SETTINGS);
					const zipData = await generatePackageZip(project, pkgSvg);
					const zipBlob = new Blob([new Uint8Array(zipData) as BlobPart], { type: 'application/zip' });
					emitted = `${name}-package.zip`;
					downloadBlob(zipBlob, emitted);
					break;
				}
				default:
					exportError = `Unknown export format: ${optionId}`;
			}

			if (!exportError && emitted) {
				// The Profile Package is the "give me everything" exit
				// action — still close the modal on that one. Every
				// individual-format export keeps the modal open so
				// the user can chain multiple downloads from a single
				// session (a common real-world flow — e.g. SVG + PDF
				// + DOT of the same diagram).
				if (optionId === 'package-zip') {
					open = false;
					onclose();
				} else {
					flashSuccess(optionId, emitted);
				}
			}
		} catch (err) {
			exportError = err instanceof Error ? err.message : String(err);
		} finally {
			exporting = false;
		}
	}

</script>

{#snippet exportCard(opt: ExportOption)}
	{@const justExported = lastExportedId === opt.id}
	<button
		onclick={() => handleExport(opt.id)}
		disabled={exporting}
		class="group flex items-start gap-3 rounded-md border px-3 py-2.5 text-left transition-all hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:pointer-events-none {justExported
			? 'border-emerald-400/70 bg-emerald-50 hover:border-emerald-500 dark:border-emerald-500/50 dark:bg-emerald-900/30'
			: 'border-border bg-background hover:border-primary/50 hover:bg-accent/40'}"
	>
		<div class="min-w-0 flex-1">
			<div class="flex items-center gap-1.5">
				<span class="font-medium {justExported ? 'text-emerald-900 dark:text-emerald-100' : 'text-foreground'}">{opt.label}</span>
				<span class="rounded bg-muted px-1 py-px font-mono text-[10px] text-muted-foreground">{opt.ext}</span>
			</div>
			{#if opt.description}
				<p class="mt-0.5 text-[11px] leading-snug {justExported ? 'text-emerald-800/80 dark:text-emerald-200/70' : 'text-muted-foreground'}">{opt.description}</p>
			{/if}
		</div>
		{#if justExported}
			<Check class="mt-1 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
		{:else}
			<ChevronRight class="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground/40 transition-colors group-hover:text-primary" />
		{/if}
	</button>
{/snippet}

<Dialog
	bind:open
	onOpenChange={(v) => {
		if (!v) {
			// Clear any pending feedback timer so it can't fire on an
			// unmounted modal and wipe state on a newly reopened one.
			if (feedbackTimer !== null) {
				clearTimeout(feedbackTimer);
				feedbackTimer = null;
			}
			lastExportedId = null;
			lastExportedFilename = null;
			onclose();
		}
	}}
>
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
		{:else if lastExportedFilename}
			<!--
				Success banner. Appears on a 3-second timer set by
				`flashSuccess`; the matching per-card highlight below
				clears from the same timer so both signals stay in
				sync. Hidden whenever an error is present so the user
				never sees contradictory feedback at once.
			-->
			<div
				class="mx-5 mt-3 flex items-center gap-2 rounded-md border border-emerald-300/50 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-700/40 dark:bg-emerald-950/40 dark:text-emerald-300 [&_svg]:pointer-events-none"
				transition:fade={{ duration: 150 }}
			>
				<Check class="h-4 w-4 shrink-0" />
				<span>Downloaded</span>
				<code class="rounded bg-emerald-100 px-1.5 py-0.5 font-mono text-xs text-emerald-900 dark:bg-emerald-900/60 dark:text-emerald-100">{lastExportedFilename}</code>
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
					<!--
						Diagram Settings mirror the in-editor panel — they're
						backed by the shared `diagramSettings` store, so
						changing them here also updates the live preview (and
						vice versa). "What you see is what you export."
					-->
					<div class="rounded-md border border-border bg-muted/20 p-3 space-y-2.5">
						<!-- Style + Palette on a single row to save vertical space -->
						<div class="grid grid-cols-2 gap-3">
							<div class="flex items-center justify-between">
								<span class="text-xs font-medium text-muted-foreground">Style</span>
								<ToggleGroup
									type="single"
									value={$diagramSettings.style}
									onValueChange={(v) => {
										if (v === 'detail' || v === 'overview')
											diagramSettings.update((s) => ({ ...s, style: v }));
									}}
								>
									<ToggleGroupItem value="detail" class="h-7 px-2 text-xs">Detail</ToggleGroupItem>
									<ToggleGroupItem value="overview" class="h-7 px-2 text-xs">Overview</ToggleGroupItem>
								</ToggleGroup>
							</div>
							<div class="flex items-center justify-between">
								<span class="text-xs font-medium text-muted-foreground">Palette</span>
								<ToggleGroup
									type="single"
									value={$diagramSettings.palette}
									onValueChange={(v) => {
										if (v === 'color' || v === 'bw')
											diagramSettings.update((s) => ({ ...s, palette: v }));
									}}
								>
									<ToggleGroupItem value="color" class="h-7 px-2 text-xs">Color</ToggleGroupItem>
									<ToggleGroupItem value="bw" class="h-7 px-2 text-xs">B&amp;W</ToggleGroupItem>
								</ToggleGroup>
							</div>
						</div>

						<Separator />

						<!-- Display toggles in two columns: row content on the
							 left, edge content on the right. Cardinality lives
							 with the row toggles since it sits inside the row.
							 - Show labels / Show properties: at least one
							   always on (store helpers flip the other).
							 - Show edge labels is disabled when Show edges
							   is off (labels have nothing to attach to). -->
						<div class="grid grid-cols-2 gap-x-4 gap-y-1.5">
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
								<span class="text-xs text-foreground">Show edges</span>
								<input
									type="checkbox"
									checked={$diagramSettings.showEdges}
									onchange={(e) => diagramSettings.update((s) => ({ ...s, showEdges: (e.currentTarget as HTMLInputElement).checked }))}
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

					<div class="grid grid-cols-2 gap-2">
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
