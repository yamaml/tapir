<script lang="ts">
	import type { Description, Flavor } from '$lib/types';
	import { getEditorStrings } from '$lib/types';
	import { removeDescription, updateDescription, simpleDspLang } from '$lib/stores';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import {
		Dialog,
		DialogContent,
		DialogHeader,
		DialogTitle,
		DialogDescription,
		DialogFooter
	} from '$lib/components/ui/dialog';
	import { focusOnMount } from '$lib/utils/focus-on-mount';
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

	let ui = $derived(getEditorStrings(flavor, $simpleDspLang));

	let editing = $state(false);
	let editName = $state('');
	/** Opens the delete-confirmation dialog (dashboard pattern). */
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
		confirmingDelete = false;
		removeDescription(description.id);
	}
</script>

<!--
	The row is a plain <div>; the select target is the name/label
	<button> inside it. The action buttons (rename check, delete) are
	siblings of the select button, never descendants — nested <button>
	elements are invalid HTML and the browser re-parents them, causing
	SSR hydration mismatches.
-->
<div
	class="group w-full rounded-md border border-transparent px-2 py-1.5 transition-colors {selected
		? 'bg-accent text-accent-foreground border-border'
		: 'hover:bg-accent/50'}"
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
					<input
						type="text"
						bind:value={editName}
						onblur={commitRename}
						onkeydown={handleKeydown}
						onclick={(e) => e.stopPropagation()}
						class="w-full h-5 px-1 text-xs font-medium bg-background border border-ring rounded text-foreground outline-none"
						use:focusOnMount
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
					<button
						type="button"
						class="flex-1 min-w-0 text-left {editing ? 'hidden' : ''}"
						onclick={onselect}
						ondblclick={(e) => { e.stopPropagation(); startRename(); }}
					>
						<span class="block text-xs font-medium text-foreground truncate">
							{description.label || description.name}
							{#if isMainLocked}
								<Lock class="inline h-2.5 w-2.5 text-muted-foreground ml-0.5 [&]:pointer-events-none" />
							{/if}
						</span>
						{#if description.targetClass}
							<span class="block text-[10px] text-muted-foreground font-mono truncate mt-0.5">
								{description.targetClass}
							</span>
						{/if}
					</button>
				</Tip>
				<div class="flex items-center gap-1 shrink-0 {editing ? 'hidden' : ''}">
					<Badge variant="secondary" class="shrink-0 text-[9px] px-1 py-0 h-3.5 font-normal tabular-nums">
						{description.statements.length}
					</Badge>
					{#if !isMainLocked}
						<Tip text={ui.deleteTooltip}>
							<button
								type="button"
								class="rounded p-0.5 text-muted-foreground/0 group-hover:text-muted-foreground hover:text-destructive transition-colors [&_svg]:pointer-events-none"
								onclick={(e: MouseEvent) => { e.stopPropagation(); confirmingDelete = true; }}
								aria-label="{ui.deleteTooltip}: {description.name}"
							>
								<Trash2 class="h-3 w-3" />
							</button>
						</Tip>
					{/if}
				</div>
			</div>
		</div>
	</div>
</div>

<!--
	Delete confirmation dialog — same pattern as the dashboard's
	project-delete dialog, so destructive actions look identical
	everywhere. Statement deletion stays one-click (recoverable via
	Ctrl+Z); deleting a whole description is heavier, hence the dialog.
-->
<Dialog
	open={confirmingDelete}
	onOpenChange={(v) => { if (!v) confirmingDelete = false; }}
>
	<DialogContent class="sm:max-w-md">
		<DialogHeader>
			<DialogTitle>{ui.deleteDialogTitle}</DialogTitle>
			<DialogDescription>
				{ui.deleteDialogBody(description.label || description.name, description.statements.length)}
			</DialogDescription>
		</DialogHeader>
		<DialogFooter>
			<Button variant="ghost" onclick={() => (confirmingDelete = false)}>{ui.cancel}</Button>
			<Button variant="destructive" onclick={confirmDelete}>
				<Trash2 class="mr-1.5 h-4 w-4" />
				{ui.deleteConfirm}
			</Button>
		</DialogFooter>
	</DialogContent>
</Dialog>
