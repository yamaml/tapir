<script lang="ts">
	import { cn } from '$lib/utils';
	import type { AlertVariant } from './index';
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	interface Props extends HTMLAttributes<HTMLDivElement> {
		variant?: AlertVariant;
		children?: Snippet;
		class?: string;
	}

	let { variant = 'default', children, class: className, ...restProps }: Props = $props();

	const variants: Record<AlertVariant, string> = {
		default: 'bg-background text-foreground',
		destructive:
			'border-destructive/50 text-destructive dark:border-destructive [&>svg]:text-destructive'
	};
</script>

<div
	role="alert"
	class={cn(
		'relative w-full rounded-lg border border-border p-4 [&>svg+div]:translate-y-[-3px] [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg]:text-foreground [&>svg~*]:pl-7',
		variants[variant],
		className
	)}
	{...restProps}
>
	{#if children}
		{@render children()}
	{/if}
</div>
