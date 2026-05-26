<!--
	Multi-select datatype picker.

	Mirrors the chip-row chrome of `ShapeRefPicker` but for a finite-but-
	extensible option set: the canonical XSD list (and a few common
	`rdf:langString`-style additions) plus a free-text add affordance so
	profile-specific datatypes (`edtf:EDTF`, project-local types) are
	first-class.

	The internal Statement model carries `datatype: string[]` to express
	the union semantics endorsed by SimpleDSP (§4.6 Table 16) and used by
	the DCMI SRAP profile (e.g. `xsd:gYear xsd:gYearMonth xsd:date`).
-->
<script lang="ts">
	import * as Popover from '$lib/components/ui/popover';
	import X from 'lucide-svelte/icons/x';
	import Plus from 'lucide-svelte/icons/plus';

	interface Props {
		/** Currently selected datatype CURIEs (e.g. `['xsd:string']`). */
		selected: string[];
		/** Canonical option list. Custom datatypes can still be added via
		 *  the free-text field — the canonical list is only a shortcut. */
		options: string[];
		/** Called with the new selection whenever the user adds or removes. */
		onchange: (next: string[]) => void;
		/** Placeholder when no datatype is selected. */
		placeholder?: string;
	}

	let { selected, options, onchange, placeholder = '(none)' }: Props = $props();

	let open = $state(false);
	let customInput = $state('');

	let available = $derived(options.filter((o) => !selected.includes(o)));

	function add(name: string) {
		const trimmed = name.trim();
		if (!trimmed || selected.includes(trimmed)) return;
		onchange([...selected, trimmed]);
	}

	function remove(name: string) {
		onchange(selected.filter((r) => r !== name));
	}

	function commitCustom() {
		const val = customInput.trim();
		if (!val) return;
		add(val);
		customInput = '';
		open = false;
	}

	function onCustomKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			commitCustom();
		}
	}
</script>

<style>
	.chip-scroll {
		scrollbar-width: thin;
		scrollbar-color: var(--muted-foreground) transparent;
	}
	.chip-scroll::-webkit-scrollbar {
		height: 4px;
	}
	.chip-scroll::-webkit-scrollbar-thumb {
		background-color: color-mix(in oklch, currentColor 25%, transparent);
		border-radius: 2px;
	}
</style>

<div
	class="group flex items-center gap-1 rounded-md border border-input bg-background px-1.5 h-7 overflow-hidden"
>
	<div class="chip-scroll flex items-center gap-1 flex-1 min-w-0 overflow-x-auto">
		{#if selected.length === 0}
			<span class="text-[10px] text-muted-foreground italic px-1 shrink-0">
				{placeholder}
			</span>
		{/if}

		{#each selected as name}
			<span
				class="inline-flex items-center gap-0.5 rounded bg-primary/90 px-1.5 py-0.5 font-mono text-[11px] text-primary-foreground shrink-0"
			>
				{name}
				<button
					type="button"
					onclick={() => remove(name)}
					class="ml-0.5 rounded text-primary-foreground/80 hover:bg-primary-foreground/20 hover:text-primary-foreground [&_svg]:pointer-events-none"
					aria-label={`Remove ${name}`}
				>
					<X class="h-3 w-3" />
				</button>
			</span>
		{/each}
	</div>

	<Popover.Root bind:open>
		{#if selected.length === 0}
			<Popover.Trigger
				class="inline-flex shrink-0 items-center gap-0.5 rounded border border-dashed border-border px-1.5 py-0.5 text-[11px] font-mono text-muted-foreground transition-colors hover:bg-muted hover:text-foreground [&_svg]:pointer-events-none"
			>
				<Plus class="h-3 w-3" />
				Add datatype
			</Popover.Trigger>
		{:else}
			<Popover.Trigger
				class="inline-flex shrink-0 items-center justify-center rounded h-5 w-5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors [&_svg]:pointer-events-none"
				title="Add another datatype"
				aria-label="Add another datatype"
			>
				<Plus class="h-3.5 w-3.5" />
			</Popover.Trigger>
		{/if}
		<Popover.Content side="bottom" align="start" class="w-64 p-1">
			<div class="flex flex-col">
				{#each available as opt}
					<button
						type="button"
						onclick={() => add(opt)}
						class="flex items-baseline gap-2 rounded px-2 py-1 text-left text-xs hover:bg-accent hover:text-accent-foreground"
					>
						<span class="font-mono">{opt}</span>
					</button>
				{/each}
				<div class="mt-1 border-t border-border pt-1.5 px-1 pb-0.5">
					<label class="text-[10px] text-muted-foreground" for="datatype-picker-custom">
						Custom datatype
					</label>
					<div class="flex items-center gap-1 mt-0.5">
						<input
							id="datatype-picker-custom"
							type="text"
							bind:value={customInput}
							onkeydown={onCustomKeydown}
							placeholder="e.g. edtf:EDTF"
							class="flex-1 min-w-0 h-6 px-1.5 text-xs font-mono bg-background border border-input rounded focus:outline-none focus:ring-1 focus:ring-ring"
						/>
						<button
							type="button"
							onclick={commitCustom}
							disabled={!customInput.trim()}
							class="shrink-0 inline-flex items-center justify-center rounded h-6 w-6 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground [&_svg]:pointer-events-none"
							aria-label="Add custom datatype"
							title="Add custom datatype"
						>
							<Plus class="h-3.5 w-3.5" />
						</button>
					</div>
				</div>
			</div>
		</Popover.Content>
	</Popover.Root>
</div>
