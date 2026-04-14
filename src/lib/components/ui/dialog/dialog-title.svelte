<script lang="ts">
	import { cn } from '$lib/utils';
	import { Dialog as DialogPrimitive } from 'bits-ui';
	import type { Snippet } from 'svelte';

	interface Props {
		children?: Snippet;
		class?: string;
		level?: 1 | 2 | 3 | 4 | 5 | 6;
		[key: string]: unknown;
	}

	let { children, class: className, level = 3, ...restProps }: Props = $props();
</script>

<DialogPrimitive.Title
	{level}
	class={cn('text-lg font-semibold leading-none tracking-tight', className)}
	{...restProps}
>
	{#if children}
		{@render children()}
	{/if}
</DialogPrimitive.Title>
