<!-- version-history-dialog.svelte -->
<script lang="ts">
	import type { TapirProject, ProjectSnapshot } from '$lib/types';
	import { getSnapshots, saveSnapshot, deleteSnapshot, updateSnapshotLabel, pruneAutoSnapshots } from '$lib/db';
	import { currentProject } from '$lib/stores';
	import { clearHistory } from '$lib/stores/history-store';
	import { computeSummaryDiff, formatDiffSummary, computeContentHash } from '$lib/utils/snapshot-utils';
	import { Dialog, DialogContent, DialogHeader, DialogTitle } from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Badge } from '$lib/components/ui/badge';
	import { ScrollArea } from '$lib/components/ui/scroll-area';
	import { Separator } from '$lib/components/ui/separator';
	import Bookmark from 'lucide-svelte/icons/bookmark';
	import Clock from 'lucide-svelte/icons/clock';
	import RotateCcw from 'lucide-svelte/icons/rotate-ccw';
	import Trash2 from 'lucide-svelte/icons/trash-2';
	import Save from 'lucide-svelte/icons/save';
	import Pencil from 'lucide-svelte/icons/pencil';

	interface Props {
		project: TapirProject;
		open: boolean;
		onclose: () => void;
		onsnapshot: () => void;
	}

	let { project, open = $bindable(), onclose, onsnapshot }: Props = $props();

	let snapshots = $state<ProjectSnapshot[]>([]);
	let newLabel = $state('');
	let editingId = $state<number | null>(null);
	let editLabel = $state('');
	let confirmRestoreId = $state<number | null>(null);
	let loading = $state(false);

	// Load snapshots when dialog opens
	$effect(() => {
		if (open && project) {
			loadSnapshots();
		}
	});

	async function loadSnapshots() {
		loading = true;
		snapshots = await getSnapshots(project.id);
		loading = false;
	}

	async function handleSaveVersion() {
		if (!newLabel.trim() || !project) return;
		const plain = $state.snapshot(project) as TapirProject;
		await saveSnapshot({
			projectId: project.id,
			label: newLabel.trim(),
			timestamp: new Date().toISOString(),
			data: plain,
			auto: false,
		});
		newLabel = '';
		await loadSnapshots();
		onsnapshot();
	}

	async function handleRestore(snapshot: ProjectSnapshot) {
		if (!project) return;
		// Save current state first
		const plain = $state.snapshot(project) as TapirProject;
		await saveSnapshot({
			projectId: project.id,
			label: `Auto-save before restore`,
			timestamp: new Date().toISOString(),
			data: plain,
			auto: true,
		});
		await pruneAutoSnapshots(project.id);

		// Restore
		const restored = { ...snapshot.data, updatedAt: new Date().toISOString() };
		currentProject.set(restored);
		clearHistory();
		confirmRestoreId = null;
		await loadSnapshots();
		onsnapshot();
	}

	async function handleDelete(id: number) {
		await deleteSnapshot(id);
		await loadSnapshots();
	}

	async function handleStartEdit(snapshot: ProjectSnapshot) {
		if (snapshot.id == null) return;
		editingId = snapshot.id;
		editLabel = snapshot.label;
	}

	async function handleSaveEdit() {
		if (editingId == null || !editLabel.trim()) return;
		await updateSnapshotLabel(editingId, editLabel.trim());
		editingId = null;
		editLabel = '';
		await loadSnapshots();
	}

	function handleCancelEdit() {
		editingId = null;
		editLabel = '';
	}

	function getDiffText(index: number): string {
		const current = snapshots[index];
		const previous = index < snapshots.length - 1 ? snapshots[index + 1] : null;
		const diff = computeSummaryDiff(previous?.data ?? null, current.data);
		return formatDiffSummary(diff);
	}

	function formatTime(iso: string): string {
		const d = new Date(iso);
		return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
			+ ' at '
			+ d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
	}
</script>

<Dialog bind:open onOpenChange={(v) => { if (!v) onclose(); }}>
	<DialogContent class="max-w-lg max-h-[80vh] flex flex-col">
		<DialogHeader>
			<DialogTitle>Version History</DialogTitle>
		</DialogHeader>

		<!-- Save Version -->
		<div class="flex gap-2 items-center">
			<Input
				bind:value={newLabel}
				placeholder="Version label..."
				class="h-8 text-sm flex-1"
				maxlength={100}
				onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter') handleSaveVersion(); }}
			/>
			<Button
				size="sm"
				class="h-8 shrink-0"
				disabled={!newLabel.trim()}
				onclick={handleSaveVersion}
			>
				<Save class="h-3.5 w-3.5 mr-1" />
				Save Version
			</Button>
		</div>

		<Separator />

		<!-- Snapshot list -->
		<ScrollArea class="flex-1 min-h-0 -mx-2">
			<div class="px-2 space-y-1">
				{#if loading}
					<p class="text-sm text-muted-foreground text-center py-6">Loading...</p>
				{:else if snapshots.length === 0}
					<p class="text-sm text-muted-foreground text-center py-6">No versions saved yet</p>
				{:else}
					{#each snapshots as snapshot, i (snapshot.id)}
						<div class="rounded-md border border-border p-2.5 hover:bg-muted/50 transition-colors">
							<div class="flex items-start justify-between gap-2">
								<div class="min-w-0 flex-1">
									<!-- Label / edit -->
									{#if editingId === snapshot.id}
										<div class="flex gap-1.5 items-center">
											<Input
												bind:value={editLabel}
												class="h-6 text-xs flex-1"
												maxlength={100}
												onkeydown={(e: KeyboardEvent) => {
													if (e.key === 'Enter') handleSaveEdit();
													if (e.key === 'Escape') handleCancelEdit();
												}}
											/>
											<Button size="sm" class="h-6 px-2 text-[10px]" onclick={handleSaveEdit}>Save</Button>
											<Button size="sm" variant="ghost" class="h-6 px-2 text-[10px]" onclick={handleCancelEdit}>Cancel</Button>
										</div>
									{:else}
										<div class="flex items-center gap-1.5">
											{#if snapshot.auto}
												<Clock class="h-3 w-3 text-muted-foreground shrink-0" />
											{:else}
												<Bookmark class="h-3 w-3 text-primary shrink-0" />
											{/if}
											<span class="text-xs font-medium truncate">{snapshot.label}</span>
											{#if !snapshot.auto}
												<button
													class="text-muted-foreground hover:text-foreground p-0.5"
													onclick={() => handleStartEdit(snapshot)}
												>
													<Pencil class="h-2.5 w-2.5" />
												</button>
											{/if}
										</div>
									{/if}

									<div class="flex items-center gap-2 mt-0.5">
										<span class="text-[10px] text-muted-foreground">{formatTime(snapshot.timestamp)}</span>
										<Badge variant="outline" class="text-[9px] px-1 py-0 h-3.5">
											{snapshot.auto ? 'auto' : 'manual'}
										</Badge>
									</div>
									<p class="text-[10px] text-muted-foreground mt-0.5">{getDiffText(i)}</p>
								</div>

								<!-- Actions -->
								<div class="flex items-center gap-0.5 shrink-0">
									{#if confirmRestoreId === snapshot.id}
										<div class="flex items-center gap-1 text-[10px]">
											<span class="text-muted-foreground">Restore?</span>
											<Button size="sm" class="h-5 px-1.5 text-[10px]" onclick={() => handleRestore(snapshot)}>Yes</Button>
											<Button size="sm" variant="ghost" class="h-5 px-1.5 text-[10px]" onclick={() => (confirmRestoreId = null)}>No</Button>
										</div>
									{:else}
										<Button
											variant="ghost"
											size="icon"
											class="h-6 w-6 text-muted-foreground hover:text-foreground"
											onclick={() => (confirmRestoreId = snapshot.id ?? null)}
											title="Restore this version"
										>
											<RotateCcw class="h-3 w-3" />
										</Button>
										<Button
											variant="ghost"
											size="icon"
											class="h-6 w-6 text-muted-foreground hover:text-destructive"
											onclick={() => { if (snapshot.id != null) handleDelete(snapshot.id); }}
											title="Delete this version"
										>
											<Trash2 class="h-3 w-3" />
										</Button>
									{/if}
								</div>
							</div>
						</div>
					{/each}
				{/if}
			</div>
		</ScrollArea>
	</DialogContent>
</Dialog>
