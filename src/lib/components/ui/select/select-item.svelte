<script lang="ts">
	import { cn } from '$lib/utils';
	import { Select as SelectPrimitive } from 'bits-ui';
	import type { Snippet } from 'svelte';

	interface Props {
		value: string;
		label?: string;
		children?: Snippet;
		class?: string;
		disabled?: boolean;
		[key: string]: unknown;
	}

	let { value, label, children, class: className, disabled, ...restProps }: Props = $props();
</script>

<SelectPrimitive.Item
	{value}
	{label}
	{disabled}
	class={cn(
		'relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
		className
	)}
	{...restProps}
>
	{#if children}
		{@render children()}
	{:else}
		{label ?? value}
	{/if}
</SelectPrimitive.Item>
