<script lang="ts">
	import { cn } from '$lib/utils';
	import { Tabs as TabsPrimitive } from 'bits-ui';
	import type { Snippet } from 'svelte';

	interface Props {
		value: string;
		children?: Snippet;
		class?: string;
		[key: string]: unknown;
	}

	let { value, children, class: className, ...restProps }: Props = $props();
</script>

<TabsPrimitive.Content
	{value}
	class={cn(
		'mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
		className
	)}
	{...restProps}
>
	{#if children}
		{@render children()}
	{/if}
</TabsPrimitive.Content>
