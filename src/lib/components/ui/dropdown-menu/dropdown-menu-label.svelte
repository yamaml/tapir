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

<DropdownMenuPrimitive.GroupHeading
	class={cn('px-2 py-1.5 text-sm font-semibold', inset && 'pl-8', className)}
	{...restProps}
>
	{#if children}
		{@render children()}
	{/if}
</DropdownMenuPrimitive.GroupHeading>
