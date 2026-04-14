<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { loadProject, saveProject, saveSnapshot, getSnapshots, pruneAutoSnapshots, loadPrefs, savePrefs } from '$lib/db';
	import { currentProject, selectedDescriptionId, editorMode, diagramVisible, refreshProjectsList, simpleDspLang } from '$lib/stores';
	import { computeContentHash } from '$lib/utils/snapshot-utils';
	import { undo, redo } from '$lib/stores/history-store';
	// Vocab loading is now lazy — triggered by autocomplete when user types a prefix
	import { getFlavorLabels } from '$lib/types';
	import type { TapirProject } from '$lib/types';
	import type { EditorMode } from '$lib/stores';
	import { Button } from '$lib/components/ui/button';
	import { Separator } from '$lib/components/ui/separator';
	import { ToggleGroup, ToggleGroupItem } from '$lib/components/ui/toggle-group';
	import ShapeSidebar from '$lib/components/shapes/shape-sidebar.svelte';
	import CustomizedEditor from '$lib/components/editor/customized-editor.svelte';
	import SmartTableEditor from '$lib/components/editor/smart-table-editor.svelte';
	import RawTableEditor from '$lib/components/editor/raw-table-editor.svelte';
	import DiagramPanel from '$lib/components/diagram/diagram-panel.svelte';
	import ExportDialog from '$lib/components/editor/export-dialog.svelte';
	import ValidationPanel from '$lib/components/editor/validation-panel.svelte';
	import UndeclaredPrefixesBanner from '$lib/components/editor/undeclared-prefixes-banner.svelte';
	import SaveStatus from '$lib/components/editor/save-status.svelte';
	import SaveIndicator from '$lib/components/editor/save-indicator.svelte';
	import VersionHistoryDialog from '$lib/components/editor/version-history-dialog.svelte';
	import Download from 'lucide-svelte/icons/download';
	import ShieldCheck from 'lucide-svelte/icons/shield-check';
	import Save from 'lucide-svelte/icons/save';
	import History from 'lucide-svelte/icons/history';
	import SearchIcon from 'lucide-svelte/icons/search';
	import X from 'lucide-svelte/icons/x';

	let project = $state<TapirProject | null>(null);
	let loading = $state(true);
	let error = $state('');
	let showExportDialog = $state(false);
	let showValidationPanel = $state(false);

	// ── Versioning state ──────────────────────────────────────────
	let hasUnsavedChanges = $state(false);
	let lastSnapshotTime = $state<string | null>(null);
	let lastSnapshotHash = $state('');
	let savingInProgress = $state(false);
	let showHistoryDialog = $state(false);
	let searchQuery = $state('');
	let searchVisible = $state(false);
	let searchInput: HTMLInputElement | undefined = $state();
	let handleVisibilityChange: (() => void) | undefined;
	let idleTimer: ReturnType<typeof setTimeout> | undefined;
	const IDLE_SNAPSHOT_DELAY = 5 * 60 * 1000; // 5 minutes

	let labels = $derived(project ? getFlavorLabels(project.flavor, $simpleDspLang) : null);
	let selectedDesc = $derived(
		project?.descriptions.find((d) => d.id === $selectedDescriptionId) ?? null
	);
	let isFirstDesc = $derived(
		project && selectedDesc ? project.descriptions[0]?.id === selectedDesc.id : false
	);
	let modeValue = $state<string>('customized');

	// ── Debounced auto-save ────────────────────────────────────────
	let saveTimer: ReturnType<typeof setTimeout> | undefined;
	/** Last plain (non-proxy) snapshot for the onDestroy flush. */
	let lastPlainProject: TapirProject | null = null;

	function scheduleSave(p: TapirProject): void {
		// Strip Svelte 5 proxies so IndexedDB's structured clone succeeds
		const plain = $state.snapshot(p) as TapirProject;
		lastPlainProject = plain;
		savingInProgress = true;

		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = setTimeout(async () => {
			try {
				await saveProject(plain);
			} catch {
				// silent — IndexedDB writes rarely fail
			}
			savingInProgress = false;

			// Change detection: compare semantic content hash
			const currentHash = computeContentHash(plain);
			if (lastSnapshotHash && currentHash !== lastSnapshotHash) {
				hasUnsavedChanges = true;
			}

			// Reset idle timer for auto-snapshot
			if (idleTimer) clearTimeout(idleTimer);
			if (hasUnsavedChanges) {
				idleTimer = setTimeout(() => createAutoSnapshot(plain), IDLE_SNAPSHOT_DELAY);
			}
		}, 800);
	}

	async function createAutoSnapshot(plain: TapirProject): Promise<void> {
		if (!plain || !hasUnsavedChanges) return;
		try {
			await saveSnapshot({
				projectId: plain.id,
				label: `Auto-save at ${new Date().toLocaleTimeString()}`,
				timestamp: new Date().toISOString(),
				data: plain,
				auto: true,
			});
			await pruneAutoSnapshots(plain.id);
			lastSnapshotHash = computeContentHash(plain);
			lastSnapshotTime = new Date().toISOString();
			hasUnsavedChanges = false;
		} catch {
			// silent
		}
	}

	// Keep project in sync with store mutations and auto-save
	const unsubscribe = currentProject.subscribe((p) => {
		if (p) {
			project = p;
			scheduleSave(p);
		}
	});

	onMount(async () => {
		// Hydrate the SimpleDSP language from persisted prefs.
		try {
			const prefs = await loadPrefs();
			simpleDspLang.set(prefs.simpleDspLang);
		} catch {
			// silent — falls back to the store default ('en')
		}

		const id = page.params.id;
		if (!id) {
			error = 'No project ID provided.';
			loading = false;
			return;
		}
		try {
			const loaded = await loadProject(id);
			if (!loaded) {
				error = 'Project not found.';
				loading = false;
				return;
			}
			project = loaded;
			lastPlainProject = loaded;
			currentProject.set(loaded);

			// Initialize versioning state
			lastSnapshotHash = computeContentHash(loaded);
			const existingSnapshots = await getSnapshots(loaded.id);
			if (existingSnapshots.length > 0) {
				lastSnapshotTime = existingSnapshots[0].timestamp;
			}

			// Select first description if available
			if (loaded.descriptions.length > 0) {
				selectedDescriptionId.set(loaded.descriptions[0].id);
			}
		} catch {
			error = 'Failed to load project.';
		}
		loading = false;

		// Vocab loading is now lazy per-prefix via the autocomplete component

		// Best-effort snapshot on tab close/hide
		handleVisibilityChange = () => {
			if (document.hidden && hasUnsavedChanges && lastPlainProject) {
				createAutoSnapshot(lastPlainProject);
			}
		};
		document.addEventListener('visibilitychange', handleVisibilityChange);
	});

	onDestroy(() => {
		// Auto-snapshot on exit if unsaved
		if (hasUnsavedChanges && lastPlainProject) {
			saveSnapshot({
				projectId: lastPlainProject.id,
				label: `Auto-save on exit`,
				timestamp: new Date().toISOString(),
				data: lastPlainProject,
				auto: true,
			});
		}
		if (idleTimer) clearTimeout(idleTimer);
		if (handleVisibilityChange) {
			document.removeEventListener('visibilitychange', handleVisibilityChange);
		}

		// Flush any pending save using the plain snapshot
		if (saveTimer) {
			clearTimeout(saveTimer);
			if (lastPlainProject) {
				saveProject(lastPlainProject);
			}
		}
		unsubscribe();
		// Refresh dashboard list so navigating back shows latest data
		refreshProjectsList();
		currentProject.set(null);
		selectedDescriptionId.set(null);
	});

	function handleSnapshotCreated() {
		if (lastPlainProject) {
			lastSnapshotHash = computeContentHash(lastPlainProject);
		}
		lastSnapshotTime = new Date().toISOString();
		hasUnsavedChanges = false;
	}

	function handleQuickSave() {
		if (hasUnsavedChanges && lastPlainProject) {
			saveSnapshot({
				projectId: lastPlainProject.id,
				label: 'Quick save',
				timestamp: new Date().toISOString(),
				data: lastPlainProject,
				auto: false,
			}).then(() => {
				pruneAutoSnapshots(lastPlainProject!.id);
				handleSnapshotCreated();
			});
		}
	}

	function handleModeChange(value: string) {
		if (value) {
			modeValue = value;
			editorMode.set(value as EditorMode);
		}
	}

	async function handleLangChange(value: string) {
		if (value !== 'en' && value !== 'jp') return;
		simpleDspLang.set(value);
		try {
			const prefs = await loadPrefs();
			await savePrefs({ ...prefs, simpleDspLang: value });
		} catch {
			// silent — in-memory state already switched
		}
	}

	// ── Search ───────────────────────────────────────────────────
	/** Check if a description matches the search query (case-insensitive). */
	function descriptionMatchesQuery(desc: TapirProject['descriptions'][number], q: string): boolean {
		const lower = q.toLowerCase();
		if (desc.name.toLowerCase().includes(lower)) return true;
		if (desc.label.toLowerCase().includes(lower)) return true;
		if (desc.note.toLowerCase().includes(lower)) return true;
		return desc.statements.some(
			(st) =>
				st.label.toLowerCase().includes(lower) ||
				st.propertyId.toLowerCase().includes(lower) ||
				st.note.toLowerCase().includes(lower)
		);
	}

	// Auto-select first matching description when search query changes
	$effect(() => {
		if (!searchQuery || !project) return;
		const match = project.descriptions.find((d) => descriptionMatchesQuery(d, searchQuery));
		if (match) selectedDescriptionId.set(match.id);
	});

	function toggleSearch() {
		searchVisible = !searchVisible;
		if (!searchVisible) {
			searchQuery = '';
		} else {
			// Focus input on next tick
			requestAnimationFrame(() => searchInput?.focus());
		}
	}

	function handleSearchKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			searchVisible = false;
			searchQuery = '';
		}
	}

</script>

<svelte:window onkeydown={(e) => {
	const mod = e.metaKey || e.ctrlKey;
	const tag = (e.target as HTMLElement)?.tagName;
	const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable;

	// ── Escape — always close dialogs/panels ─────────────────
	if (e.key === 'Escape') {
		if (searchVisible) { searchVisible = false; searchQuery = ''; return; }
		if (showHistoryDialog) { showHistoryDialog = false; return; }
		if (showExportDialog) { showExportDialog = false; return; }
		if (showValidationPanel) { showValidationPanel = false; return; }
		return;
	}

	// ── Ctrl+S — quick save ──────────────────────────────────
	if (mod && e.key === 's') {
		e.preventDefault();
		handleQuickSave();
		return;
	}

	// ── Ctrl+K — search (existing) ───────────────────────────
	if (mod && e.key === 'k') {
		e.preventDefault();
		toggleSearch();
		return;
	}

	// Skip remaining shortcuts when typing in an input field
	if (isInput) return;

	// ── Ctrl+Z — undo ────────────────────────────────────────
	if (mod && e.key === 'z' && !e.shiftKey) {
		e.preventDefault();
		undo();
		return;
	}

	// ── Ctrl+Y or Ctrl+Shift+Z — redo ───────────────────────
	if (mod && (e.key === 'y' || (e.key === 'z' && e.shiftKey) || (e.key === 'Z' && e.shiftKey))) {
		e.preventDefault();
		redo();
		return;
	}
}} />

<svelte:head>
	<title>{project ? `${project.name} — Tapir` : 'Tapir'}</title>
</svelte:head>

{#if loading}
	<div class="flex items-center justify-center py-24">
		<p class="text-sm text-muted-foreground">Loading project...</p>
	</div>
{:else if error}
	<div class="flex flex-col items-center justify-center gap-4 py-24">
		<p class="text-sm text-muted-foreground">{error}</p>
		<Button variant="outline" onclick={() => goto(`${base}/`)}>Back to Dashboard</Button>
	</div>
{:else if project && labels}
	<div class="flex h-[calc(100vh-3.5rem-2.75rem)] flex-col">
		<!-- Toolbar -->
		<div class="flex items-center gap-2 border-b border-border bg-background px-3 py-1.5">
			<SaveStatus
				projectName={project.name}
				projectDescription={project.description ?? ''}
				flavor={project.flavor}
			/>
			<Separator orientation="vertical" class="!h-5 mx-1" />

			<!-- Mode toggle -->
			<ToggleGroup type="single" value={modeValue} onValueChange={handleModeChange}>
				<ToggleGroupItem value="customized" class="text-xs px-2.5 h-7">Customized</ToggleGroupItem>
				<ToggleGroupItem value="smart-table" class="text-xs px-2.5 h-7">Smart Table</ToggleGroupItem>
				<ToggleGroupItem value="raw-table" class="text-xs px-2.5 h-7">Raw Table</ToggleGroupItem>
			</ToggleGroup>

			{#if project.flavor === 'simpledsp'}
				<Separator orientation="vertical" class="!h-5 mx-1" />
				<ToggleGroup
					type="single"
					value={$simpleDspLang}
					onValueChange={handleLangChange}
					aria-label="SimpleDSP language"
				>
					<ToggleGroupItem value="en" class="text-xs px-2.5 h-7" title="English (OWL-DSP labels)">EN</ToggleGroupItem>
					<ToggleGroupItem value="jp" class="text-xs px-2.5 h-7" title="日本語 (MetaBridge labels)">JP</ToggleGroupItem>
				</ToggleGroup>
			{/if}

			<Separator orientation="vertical" class="!h-5 mx-1" />

			<!-- Search -->
			<Button variant="ghost" size="sm" class="h-7 px-2 text-xs" onclick={toggleSearch} title="Search (Ctrl+K)">
				<SearchIcon class="h-3.5 w-3.5" />
			</Button>
			{#if searchVisible}
				<div class="relative flex items-center">
					<input
						bind:this={searchInput}
						type="text"
						placeholder="Search properties..."
						class="flex h-7 w-48 rounded-md border border-input bg-background px-2 py-1 text-xs ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 pr-7"
						bind:value={searchQuery}
						onkeydown={handleSearchKeydown}
					/>
					{#if searchQuery}
						<button
							class="absolute right-1.5 text-muted-foreground hover:text-foreground"
							onclick={() => { searchQuery = ''; searchInput?.focus(); }}
						>
							<X class="h-3.5 w-3.5" />
						</button>
					{/if}
				</div>
			{/if}

			<div class="flex-1"></div>

			<!-- Save state pill, then Save action — kept together so the
				 user sees "what state am I in" right next to "save now". -->
			<SaveIndicator {hasUnsavedChanges} {lastSnapshotTime} {savingInProgress} />

			<!-- Save → History → Validate → Export -->
			<Button
				variant="ghost"
				size="sm"
				class="h-7 px-2 text-xs"
				disabled={!hasUnsavedChanges}
				onclick={handleQuickSave}
				title="Save version (Ctrl+S)"
			>
				<Save class="mr-1 h-3.5 w-3.5" />
				Save
			</Button>
			<Button variant="ghost" size="sm" class="h-7 px-2 text-xs" onclick={() => (showHistoryDialog = true)}>
				<History class="mr-1 h-3.5 w-3.5" />
				History
			</Button>
			<Button variant="ghost" size="sm" class="h-7 px-2 text-xs" onclick={() => (showValidationPanel = !showValidationPanel)}>
				<ShieldCheck class="mr-1 h-3.5 w-3.5" />
				Validate
			</Button>
			<Button variant="ghost" size="sm" class="h-7 px-2 text-xs" onclick={() => (showExportDialog = true)}>
				<Download class="mr-1 h-3.5 w-3.5" />
				Export
			</Button>
		</div>

		<!-- Banner: prefixes used in the profile but not declared -->
		<UndeclaredPrefixesBanner {project} />

		<!-- Three-panel layout -->
		<div class="flex flex-1 overflow-hidden">
			<!-- Sidebar -->
			<aside class="w-[220px] shrink-0 border-r border-border">
				<ShapeSidebar {project} {searchQuery} />
			</aside>

			<!-- Editor area + bottom validation dock -->
			<div class="flex flex-1 flex-col overflow-hidden">
				<div class="flex-1 overflow-auto">
					{#if modeValue === 'raw-table'}
						<!-- Raw table works on the whole project, not a single description -->
						<div class="p-4">
							<RawTableEditor {project} flavor={project.flavor} />
						</div>
					{:else if selectedDesc}
						<div class="p-4">
							{#if modeValue === 'customized'}
								<CustomizedEditor description={selectedDesc} flavor={project.flavor} isFirst={isFirstDesc} />
							{:else if modeValue === 'smart-table'}
								<SmartTableEditor description={selectedDesc} flavor={project.flavor} />
							{/if}
						</div>
					{:else}
						<div class="flex h-full flex-col items-center justify-center gap-2">
							{#if project.descriptions.length === 0}
								<p class="text-sm text-muted-foreground">
									No {labels.descriptionPlural.toLowerCase()} yet
								</p>
								<p class="text-xs text-muted-foreground/70">
									Click <strong>Add</strong> in the sidebar to create your first {labels.descriptionSingular.toLowerCase()}
								</p>
							{:else}
								<p class="text-sm text-muted-foreground">
									Select a {labels.descriptionSingular.toLowerCase()} from the sidebar
								</p>
							{/if}
						</div>
					{/if}
				</div>

				<!-- Bottom validation dock -->
				<ValidationPanel
					{project}
					bind:open={showValidationPanel}
					onclose={() => (showValidationPanel = false)}
				/>
			</div>

			<!-- Diagram panel -->
			{#if $diagramVisible}
				<aside class="hidden w-[300px] shrink-0 md:block">
					<DiagramPanel {project} />
				</aside>
			{/if}
		</div>
	</div>

	<!-- Export dialog -->
	{#if project}
		<ExportDialog {project} bind:open={showExportDialog} onclose={() => (showExportDialog = false)} />
	{/if}

	<!-- Version history dialog -->
	{#if project}
		<VersionHistoryDialog
			{project}
			bind:open={showHistoryDialog}
			onclose={() => (showHistoryDialog = false)}
			onsnapshot={handleSnapshotCreated}
		/>
	{/if}
{/if}
