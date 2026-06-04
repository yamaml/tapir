<script lang="ts">
	import type { Description, Flavor } from '$lib/types';
	import { removeDescription, updateDescription } from '$lib/stores';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import Check from 'lucide-svelte/icons/check';
	import Lock from 'lucide-svelte/icons/lock';
	import GripVertical from 'lucide-svelte/icons/grip-vertical';
	import Trash2 from 'lucide-svelte/icons/trash-2';
	import Tip from '$lib/components/ui/tip.svelte';

	interface Props {
		description: Description;
		selected: boolean;
		isFirst: boolean;
		flavor: Flavor;
		onselect: () => void;
	}

	let { description, selected, isFirst, flavor, onselect }: Props = $props();

	let editing = $state(false);
	let editName = $state('');
	let confirmingDelete = $state(false);

	/** MAIN cannot be renamed or removed in SimpleDSP — it's a fixed
	 *  spec requirement and other shapes reference it implicitly. */
	let isMainLocked = $derived(isFirst && flavor === 'simpledsp');

	function startRename() {
		if (isMainLocked) return;
		editName = description.name;
		editing = true;
	}

	function commitRename() {
		const trimmed = editName.trim();
		if (trimmed && trimmed !== description.name) {
			updateDescription(description.id, { name: trimmed });
		}
		editing = false;
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			commitRename();
		} else if (e.key === 'Escape') {
			editing = false;
		}
	}

	function confirmDelete() {
		removeDescription(description.id);
	}
</script>

<button
	type="button"
	class="group w-full rounded-md border border-transparent px-2 py-1.5 text-left transition-colors {selected
		? 'bg-accent text-accent-foreground border-border'
		: 'hover:bg-accent/50'}"
	onclick={onselect}
	ondblclick={(e) => { e.stopPropagation(); startRename(); }}
>
	<div class="flex items-center gap-1.5">
		<GripVertical class="h-3.5 w-3.5 shrink-0 text-muted-foreground/30 cursor-grab group-hover:text-muted-foreground/60" />
		<div class="flex-1 min-w-0">
			<div class="flex items-center justify-between gap-1">
				<!--
					The rename input is rendered as a sibling, not a branch
					swap, so the rename <Tip> below is never destroyed mid
					reactive-flush when `editing` flips (which would trigger
					Svelte's derived_inert warning via the Tooltip trigger's
					internal $derived). The Tip stays mounted and is hidden
					with a class while editing.
				-->
				{#if editing}
					<!-- svelte-ignore a11y_autofocus -->
					<input
						type="text"
						bind:value={editName}
						onblur={commitRename}
						onkeydown={handleKeydown}
						onclick={(e) => e.stopPropagation()}
						class="w-full h-5 px-1 text-xs font-medium bg-background border border-ring rounded text-foreground outline-none"
						autofocus
					/>
					<button
						type="button"
						class="shrink-0 text-primary [&_svg]:pointer-events-none"
						onclick={(e) => { e.stopPropagation(); commitRename(); }}
					>
						<Check class="h-3 w-3" />
					</button>
				{/if}
				<Tip text={isMainLocked ? 'MAIN is required as the first block ID (SimpleDSP spec)' : 'Double-click to rename'}>
					<span
						class="text-xs font-medium text-foreground truncate {editing ? 'hidden' : ''}"
					>
						{description.label || description.name}
						{#if isMainLocked}
							<Lock class="inline h-2.5 w-2.5 text-muted-foreground ml-0.5 [&]:pointer-events-none" />
						{/if}
					</span>
				</Tip>
				<div class="flex items-center gap-1 shrink-0 {editing ? 'hidden' : ''}">
					<!--
						Same sibling-not-swap treatment for the delete <Tip>:
						the Delete?/Yes/No confirm UI is its own {#if} block
						(it has no Tip/overlay, so destroying it is safe),
						while the delete button's Tip stays mounted and is
						hidden via class when confirming.
					-->
					{#if confirmingDelete}
						<!--
							Inline confirm. Same pattern as the
							version-history dialog so the visual
							language of destructive actions stays
							consistent across the editor.
						-->
						<span class="text-[10px] text-muted-foreground">Delete?</span>
						<Button
							size="sm"
							class="h-5 px-1.5 text-[10px]"
							onclick={(e: MouseEvent) => { e.stopPropagation(); confirmDelete(); }}
						>
							Yes
						</Button>
						<Button
							size="sm"
							variant="ghost"
							class="h-5 px-1.5 text-[10px]"
							onclick={(e: MouseEvent) => { e.stopPropagation(); confirmingDelete = false; }}
						>
							No
						</Button>
					{/if}
					<Badge variant="secondary" class="shrink-0 text-[9px] px-1 py-0 h-3.5 font-normal tabular-nums {confirmingDelete ? 'hidden' : ''}">
						{description.statements.length}
					</Badge>
					{#if !isMainLocked}
						<Tip text="Delete shape">
							<button
								type="button"
								class="rounded p-0.5 text-muted-foreground/0 group-hover:text-muted-foreground hover:text-destructive transition-colors [&_svg]:pointer-events-none {confirmingDelete ? 'hidden' : ''}"
								onclick={(e: MouseEvent) => { e.stopPropagation(); confirmingDelete = true; }}
								aria-label="Delete shape"
							>
								<Trash2 class="h-3 w-3" />
							</button>
						</Tip>
					{/if}
				</div>
			</div>
			{#if !editing && description.targetClass}
				<span class="text-[10px] text-muted-foreground font-mono truncate block mt-0.5">
					{description.targetClass}
				</span>
			{/if}
		</div>
	</div>
</button>
