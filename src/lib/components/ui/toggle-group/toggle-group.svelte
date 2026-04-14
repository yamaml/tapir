<script lang="ts">
	import { cn } from '$lib/utils';
	import { ToggleGroup as ToggleGroupPrimitive } from 'bits-ui';
	import type { Snippet } from 'svelte';

	interface SingleProps {
		type?: 'single';
		value?: string;
		onValueChange?: (value: string) => void;
		children?: Snippet;
		class?: string;
		orientation?: 'horizontal' | 'vertical';
		disabled?: boolean;
		[key: string]: unknown;
	}

	interface MultipleProps {
		type: 'multiple';
		value?: string[];
		onValueChange?: (value: string[]) => void;
		children?: Snippet;
		class?: string;
		orientation?: 'horizontal' | 'vertical';
		disabled?: boolean;
		[key: string]: unknown;
	}

	type Props = SingleProps | MultipleProps;

	let {
		type = 'single',
		value = $bindable(),
		onValueChange,
		children,
		class: className,
		orientation = 'horizontal',
		disabled,
		...restProps
	}: Props = $props();
</script>

{#if type === 'multiple'}
	<ToggleGroupPrimitive.Root
		type="multiple"
		bind:value={value as string[]}
		onValueChange={onValueChange as ((value: string[]) => void) | undefined}
		{orientation}
		{disabled}
		class={cn(
			'inline-flex items-center justify-center rounded-md bg-muted p-1',
			orientation === 'vertical' && 'flex-col',
			className
		)}
		{...restProps}
	>
		{#if children}
			{@render children()}
		{/if}
	</ToggleGroupPrimitive.Root>
{:else}
	<ToggleGroupPrimitive.Root
		type="single"
		bind:value={value as string}
		onValueChange={onValueChange as ((value: string) => void) | undefined}
		{orientation}
		{disabled}
		class={cn(
			'inline-flex items-center justify-center rounded-md bg-muted p-1',
			orientation === 'vertical' && 'flex-col',
			className
		)}
		{...restProps}
	>
		{#if children}
			{@render children()}
		{/if}
	</ToggleGroupPrimitive.Root>
{/if}
