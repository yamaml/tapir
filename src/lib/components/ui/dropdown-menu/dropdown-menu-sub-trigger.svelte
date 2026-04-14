<script lang="ts">
	import { cn } from '$lib/utils';
	import { DropdownMenu as DropdownMenuPrimitive } from 'bits-ui';
	import type { Snippet } from 'svelte';

	interface Props {
		children?: Snippet;
		class?: string;
		inset?: boolean;
		[key: string]: unknown;
	}

	let { children, class: className, inset = false, ...restProps }: Props = $props();
</script>

<DropdownMenuPrimitive.SubTrigger
	class={cn(
		'flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none focus:bg-accent data-[state=open]:bg-accent',
		inset && 'pl-8',
		className
	)}
	{...restProps}
>
	{#if children}
		{@render children()}
	{/if}
	<svg
		xmlns="http://www.w3.org/2000/svg"
		width="16"
		height="16"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="2"
		stroke-linecap="round"
		stroke-linejoin="round"
		class="ml-auto h-4 w-4"
	>
		<path d="m9 18 6-6-6-6" />
	</svg>
</DropdownMenuPrimitive.SubTrigger>
