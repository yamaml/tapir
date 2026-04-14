<script lang="ts">
	import { cn } from '$lib/utils';
	import { DropdownMenu as DropdownMenuPrimitive } from 'bits-ui';
	import type { Snippet } from 'svelte';

	interface Props {
		children?: Snippet;
		class?: string;
		inset?: boolean;
		disabled?: boolean;
		[key: string]: unknown;
	}

	let { children, class: className, inset = false, disabled, ...restProps }: Props = $props();
</script>

<DropdownMenuPrimitive.Item
	{disabled}
	class={cn(
		'relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
		inset && 'pl-8',
		className
	)}
	{...restProps}
>
	{#if children}
		{@render children()}
	{/if}
</DropdownMenuPrimitive.Item>
