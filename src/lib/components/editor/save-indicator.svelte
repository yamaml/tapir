<!--
	Compact save-state pill. Shows whether the project has unsaved
	changes, is currently saving, or was last snapshotted at a given
	time. Mounts in the toolbar next to the Save button so the state
	and the action sit together.
-->
<script lang="ts">
	import { onDestroy } from 'svelte';

	interface Props {
		hasUnsavedChanges: boolean;
		lastSnapshotTime: string | null;
		savingInProgress: boolean;
	}

	let { hasUnsavedChanges, lastSnapshotTime, savingInProgress }: Props = $props();

	let relativeTime = $state('');

	function updateRelativeTime() {
		if (!lastSnapshotTime) {
			relativeTime = '';
			return;
		}
		const diff = Date.now() - new Date(lastSnapshotTime).getTime();
		const seconds = Math.floor(diff / 1000);
		if (seconds < 60) relativeTime = 'just now';
		else if (seconds < 3600) relativeTime = `${Math.floor(seconds / 60)}m ago`;
		else if (seconds < 86400) relativeTime = `${Math.floor(seconds / 3600)}h ago`;
		else relativeTime = `${Math.floor(seconds / 86400)}d ago`;
	}

	updateRelativeTime();
	const interval = setInterval(updateRelativeTime, 60_000);
	onDestroy(() => clearInterval(interval));

	$effect(() => {
		lastSnapshotTime; // track dependency
		updateRelativeTime();
	});
</script>

<div class="flex items-center gap-1.5">
	{#if savingInProgress}
		<span class="inline-block h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse"></span>
		<span class="text-[10px] text-muted-foreground">saving...</span>
	{:else if hasUnsavedChanges}
		<span class="inline-block h-1.5 w-1.5 rounded-full bg-amber-500"></span>
		<span class="text-[10px] text-amber-600 dark:text-amber-400">unsaved changes</span>
	{:else if lastSnapshotTime}
		<span class="inline-block h-1.5 w-1.5 rounded-full bg-green-500"></span>
		<span class="text-[10px] text-muted-foreground">saved {relativeTime}</span>
	{:else}
		<span class="inline-block h-1.5 w-1.5 rounded-full bg-green-500"></span>
		<span class="text-[10px] text-muted-foreground">no changes</span>
	{/if}
</div>
