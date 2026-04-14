<script lang="ts">
	import { cn } from '$lib/utils';
	import { Popover as PopoverPrimitive } from 'bits-ui';
	import type { Snippet } from 'svelte';

	interface Props {
		children?: Snippet;
		class?: string;
		side?: 'top' | 'right' | 'bottom' | 'left';
		sideOffset?: number;
		align?: 'start' | 'center' | 'end';
		[key: string]: unknown;
	}

	let {
		children,
		class: className,
		side = 'bottom',
		sideOffset = 4,
		align = 'center',
		...restProps
	}: Props = $props();
</script>

<PopoverPrimitive.Portal>
	<PopoverPrimitive.Content
		{side}
		{sideOffset}
		{align}
		class={cn(
			'z-50 w-72 rounded-md border border-border bg-popover p-4 text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
			className
		)}
		{...restProps}
	>
		{#if children}
			{@render children()}
		{/if}
	</PopoverPrimitive.Content>
</PopoverPrimitive.Portal>
