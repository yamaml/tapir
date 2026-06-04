<!--
	Multi-select shape reference picker.

	Renders the currently selected shape refs as removable chips.
	When at least one chip is present, the "Add shape" affordance
	collapses to a compact `+` icon. The `wrap` prop chooses the
	layout: single-line horizontal scroll (default, for dense table
	cells) or multi-line wrapping (for the roomy Customized card,
	where scrolling would hide chips and the `+` button).

	Used by the Customized editor (both flavours: SimpleDSP `structured`
	and DCTAP `valueShape`) and by the Smart Table cell popover.
-->
<script lang="ts">
	import * as Popover from '$lib/components/ui/popover';
	import X from 'lucide-svelte/icons/x';
	import Plus from 'lucide-svelte/icons/plus';

	interface ShapeOption {
		name: string;
		label: string;
	}

	interface Props {
		/** Currently selected shape names. */
		selected: string[];
		/** All shape options that could be selected (already filtered to exclude self if desired). */
		options: ShapeOption[];
		/** Called with the new selection whenever the user adds or removes a shape. */
		onchange: (next: string[]) => void;
		/** Display prefix on the chips — `#` for SimpleDSP, empty for DCTAP. */
		chipPrefix?: string;
		/** Placeholder when no shape is selected. */
		placeholder?: string;
		/**
		 * Chip layout. `false` (default) keeps the chips on a single
		 * fixed-height row that scrolls horizontally — right for table
		 * cells. `true` lets chips wrap onto multiple lines and the field
		 * grow taller — right for the Customized card.
		 */
		wrap?: boolean;
	}

	let {
		selected,
		options,
		onchange,
		chipPrefix = '',
		placeholder = '(none)',
		wrap = false,
	}: Props = $props();

	let open = $state(false);

	let available = $derived(options.filter((o) => !selected.includes(o.name)));

	function add(name: string) {
		if (selected.includes(name)) return;
		onchange([...selected, name]);
		open = false;
	}

	function remove(name: string) {
		onchange(selected.filter((r) => r !== name));
	}
</script>

<style>
	/* Thin, unobtrusive horizontal scrollbar for the chip row.
	   Firefox uses the scrollbar-* properties; WebKit needs the
	   pseudo-element selectors. */
	.chip-scroll {
		scrollbar-width: thin;
		scrollbar-color: var(--muted-foreground) transparent;
	}
	.chip-scroll::-webkit-scrollbar {
		height: 4px;
	}
	.chip-scroll::-webkit-scrollbar-thumb {
		background-color: color-mix(in oklch, currentColor 25%, transparent);
		border-radius: 2px;
	}
</style>

<div
	class="group flex gap-1 rounded-md border border-input bg-background px-1.5 {wrap
		? 'flex-wrap items-start min-h-7 py-1'
		: 'items-center h-7 overflow-hidden'}"
>
	<!--
		Chip row. When `wrap` is false the row stays single-line and
		scrolls (`overflow-x-auto`); `min-w-0` lets it shrink below its
		content width inside the flex parent. When `wrap` is true the
		chips and `+` button flow onto multiple lines via the parent's
		`flex-wrap`, and the field grows taller.
	-->
	<div
		class="flex items-center gap-1 {wrap
			? 'flex-wrap'
			: 'chip-scroll flex-1 min-w-0 overflow-x-auto'}"
	>
		{#if selected.length === 0}
			<span class="text-[10px] text-muted-foreground italic px-1 shrink-0">
				{placeholder}
			</span>
		{/if}

		{#each selected as name}
			<span
				class="inline-flex items-center gap-0.5 rounded bg-primary/90 px-1.5 py-0.5 font-mono text-[11px] text-primary-foreground shrink-0"
			>
				{chipPrefix}{name}
				<button
					type="button"
					onclick={() => remove(name)}
					class="ml-0.5 rounded text-primary-foreground/80 hover:bg-primary-foreground/20 hover:text-primary-foreground [&_svg]:pointer-events-none"
					aria-label={`Remove ${name}`}
				>
					<X class="h-3 w-3" />
				</button>
			</span>
		{/each}
	</div>

	{#if available.length > 0}
		<Popover.Root bind:open>
			<!--
				Empty field: show full "Add shape" label so the action is
				discoverable. Once there's at least one chip, collapse to
				a compact `+` icon — the chip row communicates what the
				field is for, so the full label would be noise. The icon
				stays visible (no hover-to-reveal) so keyboard users can
				tab to it.
			-->
			<!--
				Single stable Popover.Trigger across both states — see the
				note in datatype-picker.svelte. Swapping the trigger on the
				0 → 1 transition while the popover is open tears down its
				effect and trips Svelte's derived_inert warning.
			-->
			<Popover.Trigger
				class={selected.length === 0
					? 'inline-flex shrink-0 items-center gap-0.5 rounded border border-dashed border-border px-1.5 py-0.5 text-[11px] font-mono text-muted-foreground transition-colors hover:bg-muted hover:text-foreground [&_svg]:pointer-events-none'
					: 'inline-flex shrink-0 items-center justify-center rounded h-5 w-5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors [&_svg]:pointer-events-none'}
				title={selected.length === 0 ? undefined : 'Add another shape'}
				aria-label={selected.length === 0 ? 'Add shape' : 'Add another shape'}
			>
				<Plus class={selected.length === 0 ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
				{#if selected.length === 0}Add shape{/if}
			</Popover.Trigger>
			<Popover.Content side="bottom" align="start" class="w-56 p-1">
				<div class="flex flex-col">
					{#each available as opt}
						<button
							type="button"
							onclick={() => add(opt.name)}
							class="flex items-baseline gap-2 rounded px-2 py-1 text-left text-xs hover:bg-accent hover:text-accent-foreground"
							title={opt.label}
						>
							<span class="font-mono">{chipPrefix}{opt.name}</span>
							{#if opt.label && opt.label !== opt.name}
								<span class="text-[10px] text-muted-foreground truncate">{opt.label}</span>
							{/if}
						</button>
					{/each}
				</div>
			</Popover.Content>
		</Popover.Root>
	{/if}
</div>
