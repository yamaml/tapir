<script lang="ts">
	interface Props {
		message: string | null;
	}
	let { message }: Props = $props();
</script>

{#if message}
	<p class="text-[10px] text-destructive mt-0.5 leading-tight">{message}</p>
{/if}
