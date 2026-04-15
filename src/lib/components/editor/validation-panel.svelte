<script lang="ts">
	import type { TapirProject } from '$lib/types';
	import { validateProject } from '$lib/utils/validation';
	import { getCachedVocab } from '$lib/vocab/vocab-loader';
	import { selectedDescriptionId } from '$lib/stores';
	import { Badge } from '$lib/components/ui/badge';
	import { ScrollArea } from '$lib/components/ui/scroll-area';
	import CircleAlert from 'lucide-svelte/icons/circle-alert';
	import TriangleAlert from 'lucide-svelte/icons/triangle-alert';
	import CircleCheck from 'lucide-svelte/icons/circle-check';
	import X from 'lucide-svelte/icons/x';

	interface Props {
		project: TapirProject;
		open: boolean;
		onclose: () => void;
	}

	let { project, open = $bindable(), onclose }: Props = $props();

	// Pass the cached-vocab lookup so the panel surfaces Tier-2
	// property-range / property-domain coherence warnings alongside
	// the existing syntactic checks. The lookup is read-only and
	// silently returns undefined for prefixes whose chunk hasn't
	// loaded yet, so unknown vocabs produce zero false positives.
	let result = $derived(validateProject(project, { getCachedVocab }));
	let errorCount = $derived(result.errors.length);
	let warningCount = $derived(result.warnings.length);
	let isClean = $derived(errorCount === 0 && warningCount === 0);

	function navigateTo(field?: string) {
		if (!field) return;
		const descName = field.split('.')[0];
		const desc = project.descriptions.find((d) => d.name === descName);
		if (desc) {
			selectedDescriptionId.set(desc.id);
		}
	}
</script>

{#if open}
	<!--
		Bottom-anchored validation panel. Docks below the editor content, spans
		the full width, and can be dismissed with the close button or Escape.
	-->
	<div
		class="relative flex shrink-0 flex-col border-t border-border bg-background"
		style="height: 280px;"
		role="region"
		aria-label="Validation report"
	>
		<div class="flex items-center justify-between border-b border-border px-4 py-2">
			<div class="flex items-center gap-2">
				<span class="text-sm font-medium text-foreground">Validation</span>
				{#if errorCount > 0}
					<Badge variant="destructive" class="text-[10px] px-1.5 py-0 h-5">
						{errorCount} {errorCount === 1 ? 'error' : 'errors'}
					</Badge>
				{/if}
				{#if warningCount > 0}
					<Badge variant="secondary" class="text-[10px] px-1.5 py-0 h-5">
						{warningCount} {warningCount === 1 ? 'warning' : 'warnings'}
					</Badge>
				{/if}
				{#if isClean}
					<Badge variant="outline" class="text-[10px] px-1.5 py-0 h-5 text-green-600">
						No issues
					</Badge>
				{/if}
			</div>
			<button
				type="button"
				class="rounded-sm p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
				onclick={() => {
					open = false;
					onclose();
				}}
				aria-label="Close validation panel"
			>
				<X class="h-3.5 w-3.5" />
			</button>
		</div>

		<ScrollArea class="flex-1 min-h-0">
			<div class="space-y-0.5 px-4 py-3">
				{#if isClean}
					<div class="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
						<CircleCheck class="h-4 w-4 shrink-0 text-green-600" />
						<span>Profile is valid. No errors or warnings found.</span>
					</div>
				{/if}

				{#each result.errors as err}
					<button
						type="button"
						class="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent"
						onclick={() => navigateTo(err.field)}
					>
						<CircleAlert class="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
						<div class="min-w-0">
							{#if err.field}
								<span class="font-mono text-[10px] text-muted-foreground">{err.field}</span>
								<span class="mx-1 text-muted-foreground/50">&mdash;</span>
							{/if}
							<span class="text-foreground">{err.message}</span>
						</div>
					</button>
				{/each}

				{#each result.warnings as warn}
					<button
						type="button"
						class="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent"
						onclick={() => navigateTo(warn.field)}
					>
						<TriangleAlert class="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
						<div class="min-w-0">
							{#if warn.field}
								<span class="font-mono text-[10px] text-muted-foreground">{warn.field}</span>
								<span class="mx-1 text-muted-foreground/50">&mdash;</span>
							{/if}
							<span class="text-foreground">{warn.message}</span>
						</div>
					</button>
				{/each}
			</div>
		</ScrollArea>
	</div>
{/if}
