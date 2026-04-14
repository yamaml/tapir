<!--
	save-status.svelte — project header (name + description + flavour
	badge) with inline editing for both name and description. The save-
	state pill has moved out of this component into save-indicator.svelte
	and is now rendered next to the Save button on the right of the
	toolbar.
-->
<script lang="ts">
	import type { Flavor } from '$lib/types';
	import { currentProject, setProjectName, setProjectDescription } from '$lib/stores';
	import { projectNameExists } from '$lib/db';
	import { Badge } from '$lib/components/ui/badge';
	import Pencil from 'lucide-svelte/icons/pencil';

	interface Props {
		projectName: string;
		projectDescription: string;
		flavor: Flavor;
	}

	let { projectName, projectDescription, flavor }: Props = $props();

	let flavorLabel = $derived(flavor === 'dctap' ? 'DCTAP' : 'SimpleDSP');

	// ── Inline edit state ───────────────────────────────────────────
	let editingName = $state(false);
	let editingDescription = $state(false);
	let nameDraft = $state('');
	let nameError = $state('');
	let descriptionDraft = $state('');

	function startEditName() {
		nameDraft = projectName;
		nameError = '';
		editingName = true;
	}

	async function commitName() {
		const trimmed = nameDraft.trim();
		if (!trimmed) {
			// Empty/whitespace: silently discard the edit, keep the old name.
			editingName = false;
			nameError = '';
			return;
		}
		if (trimmed === projectName) {
			editingName = false;
			nameError = '';
			return;
		}
		// Reject names already used by a different project.
		const currentId = $currentProject?.id;
		if (await projectNameExists(trimmed, currentId)) {
			nameError = `Another project is already named “${trimmed}”.`;
			// Keep the editor open so the user can adjust.
			return;
		}
		setProjectName(trimmed);
		editingName = false;
		nameError = '';
	}

	function cancelName() {
		editingName = false;
		nameError = '';
	}

	function startEditDescription() {
		descriptionDraft = projectDescription;
		editingDescription = true;
	}

	function commitDescription() {
		setProjectDescription(descriptionDraft);
		editingDescription = false;
	}

	function cancelDescription() {
		editingDescription = false;
	}

	function nameKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') commitName();
		if (e.key === 'Escape') cancelName();
	}

	function descriptionKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') commitDescription();
		if (e.key === 'Escape') cancelDescription();
	}
</script>

<div class="flex flex-col min-w-0 gap-px">
	<!-- Row 1: project name (editable) + flavour badge + save status -->
	<div class="flex items-center gap-1.5 min-w-0">
		{#if editingName}
			<div class="flex flex-col gap-0.5 max-w-[260px]">
				<input
					type="text"
					bind:value={nameDraft}
					onkeydown={nameKeydown}
					onblur={commitName}
					oninput={() => (nameError = '')}
					aria-invalid={nameError ? 'true' : undefined}
					class="text-sm font-medium text-foreground bg-background border rounded px-1 h-6 focus:outline-none focus:ring-1 {nameError ? 'border-destructive focus:ring-destructive' : 'border-ring focus:ring-ring'}"
					autofocus
				/>
				{#if nameError}
					<p class="text-[10px] text-destructive leading-tight">{nameError}</p>
				{/if}
			</div>
		{:else}
			<button
				type="button"
				onclick={startEditName}
				title="Click to rename"
				class="group inline-flex items-center gap-1 text-sm font-medium text-foreground truncate max-w-[260px] rounded px-0.5 hover:bg-muted transition-colors [&_svg]:pointer-events-none"
			>
				<span class="truncate">{projectName}</span>
				<Pencil class="h-3 w-3 text-muted-foreground/0 group-hover:text-muted-foreground transition-colors shrink-0" />
			</button>
		{/if}

		<Badge variant="outline" class="text-[10px] px-1.5 py-0 h-4 font-normal shrink-0">{flavorLabel}</Badge>
	</div>

	<!-- Row 2: description (always present, blank shows as a quiet "Add description" link) -->
	<div class="flex items-center gap-1 min-w-0">
		{#if editingDescription}
			<input
				type="text"
				bind:value={descriptionDraft}
				onkeydown={descriptionKeydown}
				onblur={commitDescription}
				placeholder="A short description for the dashboard…"
				class="flex-1 text-[11px] text-muted-foreground bg-background border border-ring rounded px-1 h-5 max-w-[480px] focus:outline-none focus:ring-1 focus:ring-ring"
				autofocus
			/>
		{:else if projectDescription}
			<button
				type="button"
				onclick={startEditDescription}
				title="Click to edit description"
				class="group inline-flex items-center gap-1 text-[11px] text-muted-foreground truncate max-w-[480px] rounded px-0.5 hover:bg-muted hover:text-foreground transition-colors [&_svg]:pointer-events-none"
			>
				<span class="truncate">{projectDescription}</span>
				<Pencil class="h-2.5 w-2.5 text-muted-foreground/0 group-hover:text-muted-foreground transition-colors shrink-0" />
			</button>
		{:else}
			<button
				type="button"
				onclick={startEditDescription}
				class="text-[11px] text-muted-foreground/70 italic hover:text-foreground transition-colors rounded px-0.5"
			>
				+ Add a short description
			</button>
		{/if}
	</div>
</div>
