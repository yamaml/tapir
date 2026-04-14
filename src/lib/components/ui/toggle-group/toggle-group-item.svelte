<script lang="ts">
	import { cn } from '$lib/utils';
	import { ToggleGroup as ToggleGroupPrimitive } from 'bits-ui';
	import type { Snippet } from 'svelte';

	interface Props {
		value: string;
		children?: Snippet;
		class?: string;
		disabled?: boolean;
		[key: string]: unknown;
	}

	let { value, children, class: className, disabled, ...restProps }: Props = $props();
</script>

<ToggleGroupPrimitive.Item
	{value}
	{disabled}
	class={cn(
		'inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm',
		className
	)}
	{...restProps}
>
	{#if children}
		{@render children()}
	{/if}
</ToggleGroupPrimitive.Item>
