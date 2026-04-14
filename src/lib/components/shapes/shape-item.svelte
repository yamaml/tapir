<script lang="ts">
	import type { Description, Flavor } from '$lib/types';
	import { updateDescription } from '$lib/stores';
	import { Badge } from '$lib/components/ui/badge';
	import Check from 'lucide-svelte/icons/check';
	import Lock from 'lucide-svelte/icons/lock';
	import GripVertical from 'lucide-svelte/icons/grip-vertical';

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

	/** MAIN cannot be renamed in SimpleDSP — it's a fixed spec requirement. */
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
				{:else}
					<span
						class="text-xs font-medium text-foreground truncate"
						title={isMainLocked ? 'MAIN is required as the first block ID (SimpleDSP spec)' : 'Double-click to rename'}
					>
						{description.label || description.name}
						{#if isMainLocked}
							<Lock class="inline h-2.5 w-2.5 text-muted-foreground ml-0.5 [&]:pointer-events-none" />
						{/if}
					</span>
					<Badge variant="secondary" class="shrink-0 text-[9px] px-1 py-0 h-3.5 font-normal tabular-nums">
						{description.statements.length}
					</Badge>
				{/if}
			</div>
			{#if !editing && description.targetClass}
				<span class="text-[10px] text-muted-foreground font-mono truncate block mt-0.5">
					{description.targetClass}
				</span>
			{/if}
		</div>
	</div>
</button>
