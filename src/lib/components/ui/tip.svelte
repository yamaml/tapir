<!--
	Single-line tooltip wrapper.

	Wraps any trigger element with a themed, accessible tooltip. Replaces
	native HTML `title=` (which has fixed ~1s OS-controlled delay and no
	keyboard support) with a fast (300ms), themed, screen-reader-friendly
	popover built on the bits-ui Tooltip primitive.

	Usage:
	  <Tip text="Save the current state as a snapshot" shortcut="Ctrl+S">
	    <Button onclick={save}>Save</Button>
	  </Tip>

	Why this rather than calling the primitive directly: every callsite
	would otherwise need TooltipProvider + Root + Trigger + Content with
	matching delay configuration. A single wrapper keeps all tooltips
	visually consistent and makes the delay tunable in one place.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Tooltip as TooltipPrimitive } from 'bits-ui';
	import { cn } from '$lib/utils';

	interface Props {
		/** Short explanation. Keep to one line; for prose, use a popover instead. */
		text: string;
		/** Optional keyboard shortcut to render in monospace (e.g. "Ctrl+S"). */
		shortcut?: string;
		/** Side to render on; defaults to bottom. Use 'top' for buttons in the bottom edge. */
		side?: 'top' | 'right' | 'bottom' | 'left';
		/** Alignment along the side. Default 'center'. */
		align?: 'start' | 'center' | 'end';
		/** Disable the tooltip without removing it from markup. */
		disabled?: boolean;
		/** Override the global delay (ms) before the tooltip appears. */
		delayMs?: number;
		/** The trigger — typically a Button or icon button. */
		children: Snippet;
	}

	let {
		text,
		shortcut,
		side = 'bottom',
		align = 'center',
		disabled = false,
		delayMs = 300,
		children,
	}: Props = $props();
</script>

<!--
	The tooltip tree is ALWAYS rendered; an empty/disabled tip is expressed
	by passing `disabled` to the primitive rather than swapping between bare
	children and the full tree with an {#if}. Swapping would destroy the
	Tooltip.Root/Trigger effects (which own internal $deriveds) whenever
	`text`/`disabled` flips, tripping Svelte's `derived_inert` warning.
-->
<TooltipPrimitive.Provider delayDuration={delayMs} disableHoverableContent>
	<TooltipPrimitive.Root disabled={disabled || !text}>
		<TooltipPrimitive.Trigger>
			{@render children()}
		</TooltipPrimitive.Trigger>
		<TooltipPrimitive.Portal>
			<TooltipPrimitive.Content
				{side}
				{align}
				sideOffset={6}
				class={cn(
					'z-50 flex items-center gap-2 rounded-md border border-border bg-popover px-2.5 py-1 text-xs text-popover-foreground shadow-md',
					'animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95'
				)}
			>
				<span>{text}</span>
				{#if shortcut}
					<kbd
						class="inline-flex h-4 select-none items-center rounded border border-border bg-muted px-1 font-mono text-[10px] text-muted-foreground"
					>
						{shortcut}
					</kbd>
				{/if}
			</TooltipPrimitive.Content>
		</TooltipPrimitive.Portal>
	</TooltipPrimitive.Root>
</TooltipPrimitive.Provider>
