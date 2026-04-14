<script lang="ts">
	import { cn } from '$lib/utils';
	import { Dialog as DialogPrimitive } from 'bits-ui';
	import type { Snippet } from 'svelte';

	interface Props {
		children?: Snippet;
		class?: string;
		[key: string]: unknown;
	}

	let { children, class: className, ...restProps }: Props = $props();
</script>

<DialogPrimitive.Description class={cn('text-sm text-muted-foreground', className)} {...restProps}>
	{#if children}
		{@render children()}
	{/if}
</DialogPrimitive.Description>
