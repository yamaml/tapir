<script lang="ts">
	import { cn } from '$lib/utils';
	import { Tooltip as TooltipPrimitive } from 'bits-ui';
	import type { Snippet } from 'svelte';

	interface Props {
		children?: Snippet;
		class?: string;
		sideOffset?: number;
		side?: 'top' | 'right' | 'bottom' | 'left';
		align?: 'start' | 'center' | 'end';
		[key: string]: unknown;
	}

	let {
		children,
		class: className,
		sideOffset = 4,
		side = 'top',
		align = 'center',
		...restProps
	}: Props = $props();
</script>

<TooltipPrimitive.Portal>
	<TooltipPrimitive.Content
		{sideOffset}
		{side}
		{align}
		class={cn(
			'z-50 overflow-hidden rounded-md border border-border bg-popover px-3 py-1.5 text-sm text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95',
			className
		)}
		{...restProps}
	>
		{#if children}
			{@render children()}
		{/if}
	</TooltipPrimitive.Content>
</TooltipPrimitive.Portal>
