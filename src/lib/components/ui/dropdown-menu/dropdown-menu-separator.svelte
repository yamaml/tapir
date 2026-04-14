<script lang="ts">
	import { cn } from '$lib/utils';
	import { DropdownMenu as DropdownMenuPrimitive } from 'bits-ui';

	interface Props {
		class?: string;
		[key: string]: unknown;
	}

	let { class: className, ...restProps }: Props = $props();
</script>

<DropdownMenuPrimitive.Separator
	class={cn('-mx-1 my-1 h-px bg-muted', className)}
	{...restProps}
/>
