<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { projectsList, projectsLoading, refreshProjectsList } from '$lib/stores';
	import { getFlavorLabels } from '$lib/types';
	import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Separator } from '$lib/components/ui/separator';
	import {
		Dialog,
		DialogContent,
		DialogHeader,
		DialogTitle,
		DialogDescription,
		DialogFooter
	} from '$lib/components/ui/dialog';
	import { duplicateProject, deleteProject } from '$lib/db';
	import Plus from 'lucide-svelte/icons/plus';
	import Sparkles from 'lucide-svelte/icons/sparkles';
	import FileText from 'lucide-svelte/icons/file-text';
	import ChevronRight from 'lucide-svelte/icons/chevron-right';
	import Copy from 'lucide-svelte/icons/copy';
	import Trash2 from 'lucide-svelte/icons/trash-2';
	import Tip from '$lib/components/ui/tip.svelte';
	import NewProjectDialog from '$lib/components/dashboard/new-project-dialog.svelte';
	import { EXAMPLES } from '$lib/examples';
	import type { Flavor } from '$lib/types';

	// Empty-state quick-start buttons, grouped by flavor. Generated from
	// the example registry so adding an example needs no change here.
	const EXAMPLE_GROUPS: { flavor: Flavor; label: string; examples: typeof EXAMPLES }[] = (
		['simpledsp', 'dctap'] as const
	)
		.map((flavor) => ({
			flavor,
			label: flavor === 'simpledsp' ? 'SimpleDSP' : 'DCTAP',
			examples: EXAMPLES.filter((e) => e.flavor === flavor),
		}))
		.filter((g) => g.examples.length > 0);

	let showNewProject = $state(false);
	let pendingExampleId = $state<string | undefined>(undefined);

	// Clear the preselected example once the dialog has closed so the
	// next plain "New Project" open starts blank.
	$effect(() => {
		if (!showNewProject) pendingExampleId = undefined;
	});

	// Delete confirmation state. When `deleteTarget` is non-null, the
	// confirm dialog opens. We keep the name around for display after
	// the project card's hover state ends.
	let deleteTarget = $state<{ id: string; name: string } | null>(null);

	onMount(() => {
		refreshProjectsList();
	});

	async function handleDuplicate(e: MouseEvent, projectId: string) {
		e.preventDefault();
		e.stopPropagation();
		await duplicateProject(projectId);
		await refreshProjectsList();
	}

	/** Preselects an example, then opens the New Project dialog on its Example tab. */
	function openWithExample(id: string) {
		pendingExampleId = id;
		showNewProject = true;
	}

	function handleDeleteClick(e: MouseEvent, projectId: string, projectName: string) {
		e.preventDefault();
		e.stopPropagation();
		deleteTarget = { id: projectId, name: projectName };
	}

	async function confirmDelete() {
		if (!deleteTarget) return;
		const id = deleteTarget.id;
		deleteTarget = null;
		await deleteProject(id);
		await refreshProjectsList();
	}

	function relativeTime(dateStr: string): string {
		const now = Date.now();
		const then = new Date(dateStr).getTime();
		const diff = now - then;
		const seconds = Math.floor(diff / 1000);
		const minutes = Math.floor(seconds / 60);
		const hours = Math.floor(minutes / 60);
		const days = Math.floor(hours / 24);
		const weeks = Math.floor(days / 7);
		const months = Math.floor(days / 30);

		if (seconds < 60) return 'just now';
		if (minutes < 60) return `${minutes}m ago`;
		if (hours < 24) return `${hours}h ago`;
		if (days < 7) return `${days}d ago`;
		if (weeks < 5) return `${weeks}w ago`;
		return `${months}mo ago`;
	}
</script>

<div class="mx-auto max-w-screen-xl px-4 py-8 sm:px-6">
	{#if $projectsLoading}
		<div class="flex items-center justify-center py-24">
			<p class="text-sm text-muted-foreground">Loading projects...</p>
		</div>
	{:else if $projectsList.length === 0}
		<!-- Empty state -->
		<div class="mx-auto max-w-lg py-20 text-center">
			<div class="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
				<FileText class="h-8 w-8 text-primary" />
			</div>
			<h2 class="text-2xl font-semibold text-foreground">Welcome to Tapir</h2>
			<p class="mt-3 text-muted-foreground leading-relaxed">
				Tapir is a privacy-first editor for tabular application profiles. Define metadata
				descriptions using SimpleDSP or DCTAP, right in your browser. Nothing is sent to a server.
			</p>
			<div class="mt-8">
				<Button size="lg" onclick={() => (showNewProject = true)}>
					<Plus class="mr-2 h-5 w-5" />
					New Project
				</Button>
			</div>
			<div class="mt-6 grid gap-3">
				<p class="text-xs text-muted-foreground">Or start from an example:</p>
				{#each EXAMPLE_GROUPS as group (group.flavor)}
					<div class="flex flex-wrap items-center justify-center gap-2">
						<span class="text-xs font-medium text-muted-foreground">{group.label}</span>
						{#each group.examples as ex (ex.id)}
							<Button variant="outline" size="sm" onclick={() => openWithExample(ex.id)}>
								<Sparkles class="mr-1.5 h-4 w-4" />
								{ex.shortLabel}
							</Button>
						{/each}
					</div>
				{/each}
			</div>
		</div>
	{:else}
		<!-- Project list header -->
		<div class="mb-6 flex items-center justify-between">
			<h2 class="text-xl font-semibold text-foreground">Projects</h2>
			<Button size="sm" onclick={() => (showNewProject = true)}>
				<Plus class="mr-1.5 h-4 w-4" />
				New Project
			</Button>
		</div>

		<!-- Project cards grid -->
		<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
			{#each $projectsList as project (project.id)}
				{@const labels = getFlavorLabels(project.flavor)}
				<a href="{base}/editor/{project.id}" class="group block">
					<Card class="h-full transition-colors hover:border-primary/50">
						<CardHeader class="pb-3">
							<div class="flex items-start justify-between gap-2">
								<CardTitle class="text-base group-hover:text-primary transition-colors">
									{project.name}
								</CardTitle>
								<Badge
									variant="secondary"
									class={project.flavor === 'simpledsp'
										? 'bg-blue-500/15 text-blue-400 border-blue-500/25'
										: 'bg-green-500/15 text-green-400 border-green-500/25'}
								>
									{project.flavor === 'simpledsp' ? 'SimpleDSP' : 'DCTAP'}
								</Badge>
							</div>
							{#if project.description}
								<p class="mt-1 text-xs text-muted-foreground line-clamp-2 leading-snug">
									{project.description}
								</p>
							{/if}
						</CardHeader>
						<CardContent class="pb-3">
							<div class="flex items-center gap-4 text-sm text-muted-foreground">
								<span>{project.descriptionCount} {project.descriptionCount === 1 ? labels.descriptionSingular.toLowerCase() : labels.descriptionPlural.toLowerCase()}</span>
								<span class="text-border">|</span>
								<span>{project.statementCount} {project.statementCount === 1 ? labels.statementSingular.toLowerCase() : labels.statementPlural.toLowerCase()}</span>
							</div>
						</CardContent>
						<CardFooter>
							<div class="flex w-full items-center justify-between">
								<span class="text-xs text-muted-foreground">Edited {relativeTime(project.updatedAt)}</span>
								<div class="flex items-center gap-1">
									<Tip text="Duplicate project">
										<Button
											variant="ghost"
											size="icon"
											class="h-7 w-7 opacity-0 transition-opacity group-hover:opacity-100"
											onclick={(e: MouseEvent) => handleDuplicate(e, project.id)}
										>
											<Copy class="h-3.5 w-3.5" />
										</Button>
									</Tip>
									<Tip text="Delete project">
										<Button
											variant="ghost"
											size="icon"
											class="h-7 w-7 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive"
											onclick={(e: MouseEvent) => handleDeleteClick(e, project.id, project.name)}
										>
											<Trash2 class="h-3.5 w-3.5" />
										</Button>
									</Tip>
									<ChevronRight class="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
								</div>
							</div>
						</CardFooter>
					</Card>
				</a>
			{/each}
		</div>
	{/if}
</div>

<NewProjectDialog bind:open={showNewProject} initialExampleId={pendingExampleId} />

<Dialog
	open={deleteTarget !== null}
	onOpenChange={(v) => { if (!v) deleteTarget = null; }}
>
	<DialogContent class="sm:max-w-md">
		<DialogHeader>
			<DialogTitle>Delete project?</DialogTitle>
			<DialogDescription>
				{#if deleteTarget}
					This will permanently delete <strong class="text-foreground">{deleteTarget.name}</strong>
					and all its version-history snapshots. This action cannot be undone.
				{/if}
			</DialogDescription>
		</DialogHeader>
		<DialogFooter>
			<Button variant="ghost" onclick={() => (deleteTarget = null)}>Cancel</Button>
			<Button variant="destructive" onclick={confirmDelete}>
				<Trash2 class="mr-1.5 h-4 w-4" />
				Delete
			</Button>
		</DialogFooter>
	</DialogContent>
</Dialog>
