<script lang="ts">
	import { cn } from '$lib/utils';
	import { DropdownMenu as DropdownMenuPrimitive } from 'bits-ui';
	import type { Snippet } from 'svelte';

	interface Props {
		checked?: boolean;
		children?: Snippet;
		class?: string;
		[key: string]: unknown;
	}

	let { checked = $bindable(false), children, class: className, ...restProps }: Props = $props();
</script>

<DropdownMenuPrimitive.CheckboxItem
	bind:checked
	class={cn(
		'relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
		className
	)}
	{...restProps}
>
	<span class="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
		{#if checked === true}
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
			>
				<path d="M20 6 9 17l-5-5" />
			</svg>
		{/if}
	</span>
	{#if children}
		{@render children()}
	{/if}
</DropdownMenuPrimitive.CheckboxItem>
