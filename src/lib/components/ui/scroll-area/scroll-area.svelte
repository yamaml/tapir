<script lang="ts">
	import { cn } from '$lib/utils';
	import { ScrollArea as ScrollAreaPrimitive } from 'bits-ui';
	import ScrollBar from './scroll-area-scrollbar.svelte';
	import type { Snippet } from 'svelte';

	interface Props {
		children?: Snippet;
		class?: string;
		orientation?: 'horizontal' | 'vertical';
		[key: string]: unknown;
	}

	let { children, class: className, orientation = 'vertical', ...restProps }: Props = $props();
</script>

<ScrollAreaPrimitive.Root class={cn('relative overflow-hidden', className)} {...restProps}>
	<ScrollAreaPrimitive.Viewport class="h-full w-full rounded-[inherit]">
		{#if children}
			{@render children()}
		{/if}
	</ScrollAreaPrimitive.Viewport>
	<ScrollBar {orientation} />
	<ScrollAreaPrimitive.Corner />
</ScrollAreaPrimitive.Root>
