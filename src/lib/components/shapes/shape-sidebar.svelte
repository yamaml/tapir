<script lang="ts">
	import { selectedDescriptionId, addDescription, reorderDescriptions, simpleDspLang } from '$lib/stores';
	import { getFlavorLabels } from '$lib/types';
	import type { TapirProject } from '$lib/types';
	import { Button } from '$lib/components/ui/button';
	import { ScrollArea } from '$lib/components/ui/scroll-area';
	import { Separator } from '$lib/components/ui/separator';
	import ShapeItem from './shape-item.svelte';
	import NamespacePanel from './namespace-panel.svelte';
	import { createDragHandlers } from '$lib/utils/drag-reorder';
	import { descriptionMatchesQuery } from '$lib/utils/search-match';
	import Plus from 'lucide-svelte/icons/plus';

	interface Props {
		project: TapirProject;
		searchQuery?: string;
	}

	let { project, searchQuery = '' }: Props = $props();

	let filteredDescriptions = $derived(
		searchQuery
			? project.descriptions.filter((d) => descriptionMatchesQuery(d, searchQuery))
			: project.descriptions
	);

	let labels = $derived(getFlavorLabels(project.flavor, $simpleDspLang));

	// ── Drag and drop ───────────────────────────────────────────
	const drag = createDragHandlers((from, to) => {
		reorderDescriptions(from, to);
	});

	let dragOverIndex = $state(-1);

	function handleSelect(id: string) {
		selectedDescriptionId.set(id);
	}

	function handleAdd() {
		const name = `${labels.descriptionSingular} ${project.descriptions.length + 1}`;
		addDescription({ name });
	}
</script>

<div class="flex h-full flex-col">
	<!-- Header with Add button -->
	<div class="flex items-center justify-between px-3 py-2 border-b border-border">
		<span class="text-xs font-medium text-muted-foreground uppercase tracking-wider">
			{labels.descriptionPlural}
		</span>
		<Button variant="ghost" size="sm" class="h-6 px-1.5 text-xs text-primary hover:text-primary" onclick={handleAdd}>
			<Plus class="h-3.5 w-3.5 mr-0.5" />
			Add
		</Button>
	</div>

	<!-- Description list -->
	<ScrollArea class="flex-1">
		<div class="p-1.5 space-y-0.5">
			{#if filteredDescriptions.length === 0}
				<p class="px-2 py-4 text-center text-xs text-muted-foreground">
					{searchQuery ? 'No matches' : `No ${labels.descriptionPlural.toLowerCase()} yet`}
				</p>
			{:else}
				{#each filteredDescriptions as desc, index (desc.id)}
					<div
						draggable="true"
						ondragstart={(e) => drag.handleDragStart(e, index)}
						ondragover={(e) => { drag.handleDragOver(e, index); dragOverIndex = index; }}
						ondragleave={() => { dragOverIndex = -1; }}
						ondrop={(e) => { drag.handleDrop(e); dragOverIndex = -1; }}
						ondragend={(e) => { drag.handleDragEnd(e); dragOverIndex = -1; }}
						class="transition-all {dragOverIndex === index && drag.getDragIndex() !== index
							? 'border-t-2 border-t-primary pt-0.5'
							: 'border-t-2 border-t-transparent'}"
						role="listitem"
					>
						<ShapeItem
							description={desc}
							selected={$selectedDescriptionId === desc.id}
							isFirst={index === 0}
							flavor={project.flavor}
							onselect={() => handleSelect(desc.id)}
						/>
					</div>
				{/each}
			{/if}
		</div>
	</ScrollArea>

	<Separator />

	<!-- Namespace panel -->
	<NamespacePanel namespaces={project.namespaces} />
</div>
