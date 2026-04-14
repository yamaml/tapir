<!--
	Multi-select shape reference picker.

	Renders the currently selected shape refs as removable chips
	on a single horizontal row. When at least one chip is present,
	the "Add shape" affordance collapses to a compact `+` icon to
	keep row height fixed; an empty field shows the full label.
	Long selections scroll horizontally rather than wrapping.

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
	}

	let { selected, options, onchange, chipPrefix = '', placeholder = '(none)' }: Props = $props();

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
	class="group flex items-center gap-1 rounded-md border border-input bg-background px-1.5 h-7 overflow-hidden"
>
	<!--
		Scrollable chip row. `flex-nowrap` keeps the row single-line;
		`overflow-x-auto` lets wide selections scroll. `min-w-0` is
		needed so the row can actually shrink below its content width
		inside a flex parent.
	-->
	<div class="chip-scroll flex items-center gap-1 flex-1 min-w-0 overflow-x-auto">
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
			{#if selected.length === 0}
				<Popover.Trigger
					class="inline-flex shrink-0 items-center gap-0.5 rounded border border-dashed border-border px-1.5 py-0.5 text-[11px] font-mono text-muted-foreground transition-colors hover:bg-muted hover:text-foreground [&_svg]:pointer-events-none"
				>
					<Plus class="h-3 w-3" />
					Add shape
				</Popover.Trigger>
			{:else}
				<Popover.Trigger
					class="inline-flex shrink-0 items-center justify-center rounded h-5 w-5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors [&_svg]:pointer-events-none"
					title="Add another shape"
					aria-label="Add another shape"
				>
					<Plus class="h-3.5 w-3.5" />
				</Popover.Trigger>
			{/if}
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
