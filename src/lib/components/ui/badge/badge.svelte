<script lang="ts">
	import { cn } from '$lib/utils';
	import type { BadgeVariant } from './index';
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	interface Props extends HTMLAttributes<HTMLDivElement> {
		variant?: BadgeVariant;
		children?: Snippet;
		class?: string;
	}

	let { variant = 'default', children, class: className, ...restProps }: Props = $props();

	const variants: Record<BadgeVariant, string> = {
		default: 'border-transparent bg-primary text-primary-foreground hover:bg-primary/80',
		secondary:
			'border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80',
		destructive:
			'border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80',
		outline: 'text-foreground'
	};
</script>

<div
	class={cn(
		'inline-flex items-center rounded-full border border-border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
		variants[variant],
		className
	)}
	{...restProps}
>
	{#if children}
		{@render children()}
	{/if}
</div>
