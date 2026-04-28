<script lang="ts">
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { createProject, createDescription } from '$lib/types';
	import type { Flavor, NamespaceMap, TapirProject } from '$lib/types';
	import type { ParseMessage } from '$lib/types/export';
	import { saveProject, projectNameExists } from '$lib/db';
	import { refreshProjectsList, projectsList } from '$lib/stores';
	import { STANDARD_PREFIXES } from '$lib/converters/simpledsp-generator';
	import zazukoPrefixes from '@zazuko/prefixes';
	import { importFile } from '$lib/components/editor/import-handler';
	import {
		Dialog,
		DialogContent,
		DialogHeader,
		DialogTitle,
		DialogDescription,
		DialogFooter
	} from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Badge } from '$lib/components/ui/badge';
	import { Separator } from '$lib/components/ui/separator';
	import Upload from 'lucide-svelte/icons/upload';
	import FileIcon from 'lucide-svelte/icons/file';
	import Plus from 'lucide-svelte/icons/plus';
	import X from 'lucide-svelte/icons/x';
	import Globe from 'lucide-svelte/icons/globe';
	import Loader from 'lucide-svelte/icons/loader-circle';
	import AlertTriangle from 'lucide-svelte/icons/triangle-alert';

	interface Props {
		open: boolean;
	}

	let { open = $bindable() }: Props = $props();

	let projectName = $state('');
	let selectedFlavor = $state<Flavor>('simpledsp');
	let baseIri = $state('');
	let projectNamespaces = $state<NamespaceMap>({});
	let creating = $state(false);
	let newPrefix = $state('');
	let newUri = $state('');

	// ── Prefix suggestion state ─────────────────────────────────
	// The prefix input offers an autocomplete dropdown of known
	// vocabularies that match what the user has typed so far. We
	// no longer fill the URI field automatically while typing —
	// that caused "dc" to win before the user could finish typing
	// "dcterms". Users explicitly pick a suggestion (click, or
	// ArrowDown + Enter) to fill both prefix and URI.
	let prefixFocused = $state(false);
	let prefixHighlight = $state(0);
	let prefixInputEl = $state<HTMLInputElement | null>(null);

	// ── File import state ───────────────────────────────────────
	let importedFile = $state<File | null>(null);
	let importedProject = $state<TapirProject | null>(null);
	let importWarnings = $state<ParseMessage[]>([]);
	let importErrors = $state<ParseMessage[]>([]);
	let importing = $state(false);
	let fileInputEl = $state<HTMLInputElement | null>(null);

	// ── Common prefixes for quick add ───────────────────────────

	const COMMON = [
		{ prefix: 'schema', uri: 'http://schema.org/', label: 'Schema.org' },
		{ prefix: 'foaf', uri: 'http://xmlns.com/foaf/0.1/', label: 'FOAF' },
		{ prefix: 'dcterms', uri: 'http://purl.org/dc/terms/', label: 'DC Terms' },
		{ prefix: 'dc', uri: 'http://purl.org/dc/elements/1.1/', label: 'DC Elements' },
		{ prefix: 'skos', uri: 'http://www.w3.org/2004/02/skos/core#', label: 'SKOS' },
		{ prefix: 'dcat', uri: 'http://www.w3.org/ns/dcat#', label: 'DCAT' },
		{ prefix: 'prov', uri: 'http://www.w3.org/ns/prov#', label: 'PROV' },
		{ prefix: 'org', uri: 'http://www.w3.org/ns/org#', label: 'ORG' },
		{ prefix: 'rdfs', uri: 'http://www.w3.org/2000/01/rdf-schema#', label: 'RDFS' },
	];

	let availableCommon = $derived(COMMON.filter((c) => !(c.prefix in projectNamespaces)));
	let namespaceCount = $derived(Object.keys(projectNamespaces).length);
	let hasNamespace = $derived(namespaceCount > 0);

	// Union of three sources, keyed by prefix:
	//   1. @zazuko/prefixes (~116 curated RDF-ecosystem vocabularies),
	//   2. STANDARD_PREFIXES from the SimpleDSP generator,
	//   3. COMMON (labelled for the quick-add chips above).
	// COMMON wins on collision because it carries friendly labels;
	// zazuko fills the long tail with entries like sioc, geo, wgs, etc.
	// Already-added prefixes are filtered out so we never suggest
	// a duplicate.
	type PrefixSuggestion = { prefix: string; uri: string; label?: string };
	let allKnownPrefixes = $derived.by<PrefixSuggestion[]>(() => {
		const map = new Map<string, PrefixSuggestion>();
		for (const [prefix, uri] of Object.entries(zazukoPrefixes)) {
			map.set(prefix, { prefix, uri });
		}
		for (const [prefix, uri] of Object.entries(STANDARD_PREFIXES)) {
			map.set(prefix, { prefix, uri });
		}
		for (const c of COMMON) {
			map.set(c.prefix, { prefix: c.prefix, uri: c.uri, label: c.label });
		}
		return [...map.values()]
			.filter((s) => !(s.prefix in projectNamespaces))
			.sort((a, b) => a.prefix.localeCompare(b.prefix));
	});

	// Prefix-substring match on the typed text. If the text is empty
	// we still show nothing (the popover only opens once the user
	// starts typing) — quick-add chips above already cover the "show
	// me everything" case.
	let prefixSuggestions = $derived.by(() => {
		const q = newPrefix.trim().toLowerCase();
		if (!q) return [] as PrefixSuggestion[];
		return allKnownPrefixes.filter((s) => s.prefix.toLowerCase().startsWith(q));
	});
	let showPrefixSuggestions = $derived(
		prefixFocused && prefixSuggestions.length > 0
	);

	// Live duplicate-name check against the cached projects list. We
	// still re-verify against IndexedDB at submit time (the list can be
	// stale if another tab added a project), but showing the conflict
	// inline as the user types gives immediate feedback without a round
	// trip. Comparison is case-insensitive and trim-normalised to match
	// `projectNameExists`.
	let nameDuplicate = $derived.by(() => {
		const normalized = projectName.trim().toLowerCase();
		if (!normalized) return false;
		return $projectsList.some((p) => p.name.trim().toLowerCase() === normalized);
	});
	let canCreate = $derived(
		projectName.trim().length > 0 && !creating && !importing && !nameDuplicate
	);

	function resetForm() {
		projectName = '';
		selectedFlavor = 'simpledsp';
		baseIri = '';
		projectNamespaces = {};
		creating = false;
		newPrefix = '';
		newUri = '';
		clearImport();
	}

	function clearImport() {
		importedFile = null;
		importedProject = null;
		importWarnings = [];
		importErrors = [];
		importing = false;
		// Also clear the <input type="file"> so the same filename can be re-picked.
		if (fileInputEl) fileInputEl.value = '';
	}

	/**
	 * Processes an imported `File` regardless of whether it came from
	 * the file picker or a URL load. Parses immediately so the dialog
	 * can show the detected flavor, namespaces, and base IRI before
	 * the user clicks Create, and so any parse issues surface up-front.
	 */
	async function processImportedFile(file: File): Promise<void> {
		importedFile = file;
		importedProject = null;
		importWarnings = [];
		importErrors = [];
		importing = true;

		try {
			const result = await importFile(file);
			importedProject = result.project;
			importWarnings = result.warnings;
			importErrors = result.errors;

			// Default the project name to the filename (without extension)
			// if the user hasn't typed one yet.
			if (!projectName.trim()) {
				projectName = file.name.replace(/\.[^.]+$/, '');
			}

			// Carry over detected flavor, base, and namespaces.
			if (result.project.flavor) selectedFlavor = result.project.flavor;
			if (result.project.base) baseIri = result.project.base;
			if (
				result.project.namespaces &&
				Object.keys(result.project.namespaces).length > 0
			) {
				projectNamespaces = {
					...projectNamespaces,
					...result.project.namespaces,
				};
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			importErrors = [{ message: `Failed to read file: ${message}` }];
		} finally {
			importing = false;
		}
	}

	/**
	 * Handles file selection from the import input.
	 */
	async function handleFileSelect(e: Event): Promise<void> {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		await processImportedFile(file);
	}

	function handleQuickAdd(prefix: string, uri: string) {
		projectNamespaces = { ...projectNamespaces, [prefix]: uri };
	}

	function handleRemoveNs(prefix: string) {
		const updated = { ...projectNamespaces };
		delete updated[prefix];
		projectNamespaces = updated;
	}

	function handleAddCustomNs() {
		const prefix = newPrefix.trim();
		const uri = newUri.trim();
		if (!prefix || !uri) return;
		projectNamespaces = { ...projectNamespaces, [prefix]: uri };
		newPrefix = '';
		newUri = '';
	}

	/** Picks a suggestion — fills both prefix and URI. */
	function acceptPrefixSuggestion(s: { prefix: string; uri: string }) {
		newPrefix = s.prefix;
		newUri = s.uri;
		prefixFocused = false;
		// Move focus to the URI field is not ideal — users often just
		// want to click Add. Leave focus on the prefix input so a
		// follow-up Enter in the URI field (bound separately) or the
		// Add button works naturally.
	}

	/** Resets the highlight whenever the typed prefix changes. */
	function handlePrefixInput() {
		prefixHighlight = 0;
	}

	function handlePrefixFocus() {
		prefixFocused = true;
	}

	function handlePrefixBlur() {
		// Delay so a click on a suggestion fires before we close the
		// popover. 150ms is the usual trick; the suggestion mousedown
		// handler uses preventDefault as a secondary guard.
		setTimeout(() => {
			prefixFocused = false;
		}, 150);
	}

	async function handleCreate() {
		if (!canCreate) return;
		creating = true;
		try {
			// Re-check against IndexedDB in case the cached list is stale
			// (e.g. another browser tab created a project with this name
			// since the dialog opened). The reactive `nameDuplicate` flag
			// catches the common case; this catches the race.
			if (await projectNameExists(projectName.trim())) {
				creating = false;
				return;
			}

			const project = createProject({
				name: projectName.trim(),
				flavor: selectedFlavor,
				base: baseIri.trim(),
				namespaces: { ...projectNamespaces },
			});

			if (importedProject && importedProject.descriptions.length > 0) {
				// User selected a file to import — carry its parsed
				// descriptions into the new project. Snapshot first so
				// IndexedDB's structured-clone doesn't choke on Svelte 5's
				// reactive proxy wrappers.
				project.descriptions = $state.snapshot(importedProject.descriptions) as typeof project.descriptions;
			} else if (selectedFlavor === 'simpledsp') {
				// SimpleDSP requires 'MAIN' as the first block ID.
				project.descriptions = [createDescription({ name: 'MAIN' })];
			} else {
				// DCTAP shapes are optional — start empty, user adds shapes as needed.
				project.descriptions = [];
			}

			await saveProject(project);
			await refreshProjectsList();
			open = false;
			resetForm();
			goto(`${base}/editor/${project.id}`);
		} catch (err) {
			console.error('[new-project-dialog] handleCreate failed:', err);
			creating = false;
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && canCreate) {
			handleCreate();
		}
	}

	function handleNsKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') handleAddCustomNs();
	}

	/**
	 * Keyboard handling for the prefix input: arrows navigate the
	 * suggestion list, Enter accepts (or submits the row if no
	 * suggestions are visible), Escape closes the popover.
	 */
	function handlePrefixKeydown(e: KeyboardEvent) {
		if (showPrefixSuggestions) {
			if (e.key === 'ArrowDown') {
				e.preventDefault();
				prefixHighlight = Math.min(prefixHighlight + 1, prefixSuggestions.length - 1);
				return;
			}
			if (e.key === 'ArrowUp') {
				e.preventDefault();
				prefixHighlight = Math.max(prefixHighlight - 1, 0);
				return;
			}
			if (e.key === 'Enter') {
				e.preventDefault();
				const picked = prefixSuggestions[prefixHighlight];
				if (picked) acceptPrefixSuggestion(picked);
				return;
			}
			if (e.key === 'Escape') {
				e.preventDefault();
				prefixFocused = false;
				return;
			}
			if (e.key === 'Tab') {
				// Tab accepts the highlighted suggestion and moves focus
				// on to the URI field, which is usually empty at this
				// point (or overridden by the picked URI).
				const picked = prefixSuggestions[prefixHighlight];
				if (picked) {
					e.preventDefault();
					acceptPrefixSuggestion(picked);
				}
				return;
			}
		}
		if (e.key === 'Enter') handleAddCustomNs();
	}
</script>

<Dialog bind:open onOpenChange={(v) => { if (!v) resetForm(); }}>
	<DialogContent class="sm:max-w-lg max-h-[90vh] overflow-y-auto">
		<DialogHeader>
			<DialogTitle>New Project</DialogTitle>
			<DialogDescription>Create a new application profile project.</DialogDescription>
		</DialogHeader>

		<div class="grid gap-5 py-2">
			<!-- Project name -->
			<div class="grid gap-2">
				<Label for="project-name">Project name <span class="text-destructive">*</span></Label>
				<Input
					id="project-name"
					placeholder="My Application Profile"
					bind:value={projectName}
					onkeydown={handleKeydown}
					aria-invalid={nameDuplicate ? 'true' : undefined}
					class={nameDuplicate ? 'border-destructive focus-visible:ring-destructive' : ''}
				/>
				{#if nameDuplicate}
					<p class="text-xs text-destructive">
						A project named <span class="font-semibold">“{projectName.trim()}”</span> already exists. Pick a different name.
					</p>
				{/if}
			</div>

			<!-- Flavor selection -->
			<div class="grid gap-2">
				<Label>Profile flavor</Label>
				<div class="grid grid-cols-2 gap-3">
					<button
						type="button"
						class="rounded-lg border-2 p-3 text-left transition-colors {selectedFlavor === 'simpledsp'
							? 'border-blue-500 bg-blue-500/10'
							: 'border-border hover:border-muted-foreground/30'}"
						onclick={() => (selectedFlavor = 'simpledsp')}
					>
						<div class="flex items-center gap-2">
							<div class="h-2.5 w-2.5 rounded-full bg-blue-500"></div>
							<span class="text-sm font-medium text-foreground">SimpleDSP</span>
						</div>
						<p class="mt-1.5 text-xs text-muted-foreground leading-relaxed">
							Streamlined format for description and statement templates.
						</p>
					</button>
					<button
						type="button"
						class="rounded-lg border-2 p-3 text-left transition-colors {selectedFlavor === 'dctap'
							? 'border-green-500 bg-green-500/10'
							: 'border-border hover:border-muted-foreground/30'}"
						onclick={() => (selectedFlavor = 'dctap')}
					>
						<div class="flex items-center gap-2">
							<div class="h-2.5 w-2.5 rounded-full bg-green-500"></div>
							<span class="text-sm font-medium text-foreground">DCTAP</span>
						</div>
						<p class="mt-1.5 text-xs text-muted-foreground leading-relaxed">
							DC Tabular Application Profiles with shapes and statements.
						</p>
					</button>
				</div>
				<p class="text-xs text-muted-foreground">Not sure? Start with SimpleDSP.</p>
			</div>

			<Separator />

			<!-- Namespaces (required) -->
			<div class="grid gap-2">
				<Label>
					<Globe class="inline h-3.5 w-3.5 mr-1 [&]:pointer-events-none" />
					Namespaces
				</Label>
				<p class="text-xs text-muted-foreground -mt-1">
					Click to quick-add common vocabularies, or add them later from the editor.
				</p>

				<!-- Quick-add buttons -->
				{#if availableCommon.length > 0}
					<div class="flex flex-wrap gap-1.5">
						{#each availableCommon as c}
							<button
								type="button"
								class="text-xs px-2 py-1 rounded-md border border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors [&_svg]:pointer-events-none"
								onclick={() => handleQuickAdd(c.prefix, c.uri)}
								title={c.uri}
							>
								<Plus class="inline h-3 w-3 mr-0.5" />{c.prefix}
							</button>
						{/each}
					</div>
				{/if}

				<!-- Added namespaces -->
				{#if namespaceCount > 0}
					<div class="space-y-1 rounded-md border border-border p-2 bg-card">
						{#each Object.entries(projectNamespaces) as [prefix, uri]}
							<div class="flex items-center gap-2 text-xs group">
								<Badge variant="secondary" class="font-mono text-[10px] shrink-0">{prefix}:</Badge>
								<span class="text-muted-foreground font-mono truncate flex-1" title={uri}>{uri}</span>
								<button
									type="button"
									class="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity [&_svg]:pointer-events-none"
									onclick={() => handleRemoveNs(prefix)}
								>
									<X class="h-3 w-3" />
								</button>
							</div>
						{/each}
					</div>
				{/if}

				<!-- Custom namespace input -->
				<div class="flex gap-2">
					<div class="relative w-24">
						<input
							bind:this={prefixInputEl}
							type="text"
							bind:value={newPrefix}
							oninput={handlePrefixInput}
							onkeydown={handlePrefixKeydown}
							onfocus={handlePrefixFocus}
							onblur={handlePrefixBlur}
							placeholder="prefix"
							autocomplete="off"
							role="combobox"
							aria-expanded={showPrefixSuggestions}
							aria-autocomplete="list"
							class="w-full h-8 px-2 text-xs font-mono bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-ring"
						/>
						{#if showPrefixSuggestions}
							<!-- Suggestion popover. Positioned beneath the
								 prefix input, closes on blur (with a short
								 delay so clicks on items still register).
								 Items preview the matched URI so users see
								 which vocabulary they're picking. -->
							<ul
								role="listbox"
								class="absolute left-0 top-full z-50 mt-1 max-h-60 w-[28rem] overflow-y-auto rounded-md border border-border bg-popover shadow-md py-1 text-xs"
							>
								{#each prefixSuggestions as s, i (s.prefix)}
									<!-- svelte-ignore a11y_click_events_have_key_events -->
									<li
										role="option"
										aria-selected={i === prefixHighlight}
										onmousedown={(e) => {
											// Prevent the input's blur from firing before
											// our click handler, which would hide the
											// popover and cancel the selection.
											e.preventDefault();
											acceptPrefixSuggestion(s);
										}}
										onmouseenter={() => (prefixHighlight = i)}
										class="flex items-baseline gap-2 px-2 py-1 cursor-pointer {i === prefixHighlight ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'}"
									>
										<span class="font-mono font-semibold shrink-0">{s.prefix}</span>
										{#if s.label}
											<span class="text-[10px] text-muted-foreground shrink-0">{s.label}</span>
										{/if}
										<span class="font-mono text-muted-foreground truncate" title={s.uri}>{s.uri}</span>
									</li>
								{/each}
							</ul>
						{/if}
					</div>
					<input
						type="text"
						bind:value={newUri}
						onkeydown={handleNsKeydown}
						placeholder="http://example.org/ns#"
						class="flex-1 h-8 px-2 text-xs font-mono bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-ring"
					/>
					<Button
						size="sm"
						variant="outline"
						class="h-8 text-xs"
						disabled={!newPrefix.trim() || !newUri.trim()}
						onclick={handleAddCustomNs}
					>
						Add
					</Button>
				</div>

				<!--
					Base IRI is a SimpleDSP / YAMA concept (sets `@base` for
					record URIs and shape IRIs). DCTAP has no equivalent —
					shapes are referenced by `shapeID` only — so we hide
					this input for DCTAP profiles.
				-->
				{#if selectedFlavor !== 'dctap'}
					<div class="mt-1">
						<Label for="base-iri" class="text-muted-foreground text-xs">Base IRI (optional)</Label>
						<input
							id="base-iri"
							type="text"
							bind:value={baseIri}
							onkeydown={handleKeydown}
							placeholder="http://example.org/profiles/"
							class="w-full h-8 px-2 text-xs font-mono bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-ring mt-1"
						/>
					</div>
				{/if}
			</div>

			<!-- File import (optional) -->
			<div class="grid gap-2">
				<Label for="file-import" class="text-muted-foreground">Import existing profile (optional)</Label>

				{#if importedFile}
					<!-- Selected file chip with remove + status. The parse
						 summary is always shown when parsing succeeded —
						 warnings and (rare) errors are reported below as
						 advisory lines, not as a "parse failed" headline. -->
					<div class="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
						<FileIcon class="h-4 w-4 shrink-0 text-muted-foreground" />
						<div class="min-w-0 flex-1">
							<div class="truncate text-foreground" title={importedFile.name}>{importedFile.name}</div>
							{#if importing}
								<div class="flex items-center gap-1 text-xs text-muted-foreground">
									<Loader class="h-3 w-3 animate-spin" />
									Parsing…
								</div>
							{:else if importedProject}
								{@const descCount = importedProject.descriptions.length}
								{@const stmtCount = importedProject.descriptions.reduce((n, d) => n + d.statements.length, 0)}
								<div class="text-xs text-muted-foreground">
									Parsed as {importedProject.flavor === 'dctap' ? 'DCTAP' : 'SimpleDSP'}
									· {descCount} {descCount === 1 ? 'description' : 'descriptions'}
									· {stmtCount} {stmtCount === 1 ? 'statement' : 'statements'}
								</div>
							{/if}
						</div>
						<button
							type="button"
							class="text-muted-foreground hover:text-destructive transition-colors [&_svg]:pointer-events-none"
							onclick={clearImport}
							title="Remove file"
						>
							<X class="h-4 w-4" />
						</button>
					</div>

					{#if importedProject && importedProject.descriptions.length === 0}
						<!-- Empty parse result: the file was readable but
							 produced no descriptions. Almost always a format
							 mismatch (e.g. DCTAP CSV imported as SimpleDSP).
							 Loud-but-not-error styling — the user can still
							 proceed if they really want a blank project. -->
						<!--
							Subtle bordered card on the standard surface, no
							tinted background — keeps the rest of Tapir's
							visual language. The amber colour comes only
							from the icon, which is enough cue without
							washing out the body text.
						-->
						<div class="rounded-md border border-border bg-card px-3 py-2.5 text-xs">
							<div class="flex items-start gap-2">
								<AlertTriangle class="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
								<div class="min-w-0 flex-1">
									<p class="font-semibold text-foreground mb-0.5">
										No content was found — a blank project will be created
									</p>
									<p class="text-muted-foreground leading-snug">
										The file parsed but contained no descriptions. Check that it matches the selected
										<span class="font-semibold text-foreground">{importedProject.flavor === 'dctap' ? 'DCTAP' : 'SimpleDSP'}</span>
										format, or try the other flavor.
									</p>
								</div>
							</div>
						</div>
					{:else if importedProject && importWarnings.length > 0}
						<!-- Warnings: non-blocking. The most common case is
							 undeclared prefixes, which the editor surfaces
							 with one-click declare actions after the project
							 is created. -->
						<div class="rounded-md border border-border bg-card px-3 py-2.5 text-xs">
							<div class="flex items-start gap-2">
								<AlertTriangle class="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
								<div class="min-w-0 flex-1">
									<p class="font-semibold text-foreground mb-1">
										{importWarnings.length} {importWarnings.length === 1 ? 'note' : 'notes'} — the project will still be created
									</p>
									<div class="text-muted-foreground space-y-0.5 max-h-24 overflow-y-auto">
										{#each importWarnings.slice(0, 5) as w}
											<div>{w.message}</div>
										{/each}
										{#if importWarnings.length > 5}
											<div class="italic opacity-80">and {importWarnings.length - 5} more…</div>
										{/if}
									</div>
								</div>
							</div>
						</div>
					{/if}

					{#if importErrors.length > 0}
						<!-- Errors: structural problems that may genuinely
							 break the imported profile. Same neutral card,
							 destructive icon for severity. -->
						<div class="rounded-md border border-border bg-card px-3 py-2.5 text-xs">
							<div class="flex items-start gap-2">
								<AlertTriangle class="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
								<div class="min-w-0 flex-1">
									<p class="font-semibold text-foreground mb-1">
										{importErrors.length} {importErrors.length === 1 ? 'error' : 'errors'} during import
									</p>
									<div class="text-muted-foreground space-y-0.5 max-h-24 overflow-y-auto">
										{#each importErrors.slice(0, 5) as err}
											<div>{err.message}</div>
										{/each}
										{#if importErrors.length > 5}
											<div class="italic opacity-80">and {importErrors.length - 5} more…</div>
										{/if}
									</div>
								</div>
							</div>
						</div>
					{/if}
				{:else}
					<!-- Empty picker -->
					<label
						for="file-import"
						class="flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-border px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:border-muted-foreground/50 hover:text-foreground [&_svg]:pointer-events-none"
					>
						<Upload class="h-4 w-4" />
						<span>Choose file…</span>
						<span class="ml-auto text-xs opacity-70">.yaml, .tsv, .csv, .xlsx</span>
					</label>
				{/if}

				<input
					bind:this={fileInputEl}
					id="file-import"
					type="file"
					class="hidden"
					accept=".yaml,.yml,.csv,.tsv,.xlsx"
					onchange={handleFileSelect}
				/>
			</div>
		</div>

		<DialogFooter>
			<Button variant="outline" onclick={() => (open = false)}>Cancel</Button>
			<Button onclick={handleCreate} disabled={!canCreate}>
				{#if creating}
					Creating...
				{:else}
					Create Project
				{/if}
			</Button>
		</DialogFooter>
	</DialogContent>
</Dialog>
