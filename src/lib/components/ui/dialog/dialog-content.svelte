<script lang="ts">
	import { cn } from '$lib/utils';
	import { Dialog as DialogPrimitive } from 'bits-ui';
	import DialogOverlay from './dialog-overlay.svelte';
	import type { Snippet } from 'svelte';

	interface Props {
		children?: Snippet;
		class?: string;
		[key: string]: unknown;
	}

	let { children, class: className, ...restProps }: Props = $props();
</script>

<DialogPrimitive.Portal>
	<DialogOverlay />
	<DialogPrimitive.Content
		class={cn(
			'fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border border-border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg',
			className
		)}
		{...restProps}
	>
		{#if children}
			{@render children()}
		{/if}
	</DialogPrimitive.Content>
</DialogPrimitive.Portal>
