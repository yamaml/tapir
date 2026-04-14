<script lang="ts">
	import { cn } from '$lib/utils';
	import { Dialog as DialogPrimitive } from 'bits-ui';

	interface Props {
		class?: string;
		[key: string]: unknown;
	}

	let { class: className, ...restProps }: Props = $props();
</script>

<DialogPrimitive.Overlay
	class={cn(
		'fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
		className
	)}
	{...restProps}
/>
