<script lang="ts">
	import { cn } from '$lib/utils';
	import { ScrollArea as ScrollAreaPrimitive } from 'bits-ui';

	interface Props {
		orientation?: 'horizontal' | 'vertical';
		class?: string;
		[key: string]: unknown;
	}

	let { orientation = 'vertical', class: className, ...restProps }: Props = $props();
</script>

<ScrollAreaPrimitive.Scrollbar
	{orientation}
	class={cn(
		'flex touch-none select-none transition-colors',
		orientation === 'vertical' && 'h-full w-2.5 border-l border-l-transparent p-[1px]',
		orientation === 'horizontal' && 'h-2.5 flex-col border-t border-t-transparent p-[1px]',
		className
	)}
	{...restProps}
>
	<ScrollAreaPrimitive.Thumb class="relative flex-1 rounded-full bg-border" />
</ScrollAreaPrimitive.Scrollbar>
