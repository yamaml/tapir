<script lang="ts">
	import { cn } from '$lib/utils';
	import { Tabs as TabsPrimitive } from 'bits-ui';
	import type { Snippet } from 'svelte';

	interface Props {
		children?: Snippet;
		class?: string;
		[key: string]: unknown;
	}

	let { children, class: className, ...restProps }: Props = $props();
</script>

<TabsPrimitive.List
	class={cn(
		'inline-flex h-10 items-center justify-center rounded-md bg-muted p-1 text-muted-foreground',
		className
	)}
	{...restProps}
>
	{#if children}
		{@render children()}
	{/if}
</TabsPrimitive.List>
