<!--
	Multi-select value-type picker.

	A row of toggle chips, one per available node kind (literal / IRI /
	bnode), plus the derived `structured` pseudo-type for SimpleDSP.
	Node kinds toggle independently (a value may be any of them — logical
	OR); `structured` is mutually exclusive with the node kinds (selecting
	it clears them, and vice versa). An empty selection means "no value
	type". Each selected chip is tinted with its semantic colour.

	Used by the Customized editor and the Smart Table value-type cell so
	both express multiple node kinds the same way.
-->
<script lang="ts">
	import type { Flavor } from '$lib/types';
	import { getFlavorLabels, type SimpleDspLang } from '$lib/types';
	import type { DisplayValueType } from '$lib/utils/editor-cells';

	interface Props {
		/** Currently selected display value types (may include 'structured'). */
		selected: DisplayValueType[];
		/** Active profile flavor (decides which options are offered). */
		flavor: Flavor;
		/** SimpleDSP language (for option labels). */
		lang?: SimpleDspLang;
		/** Called with the new selection whenever a chip is toggled. */
		onchange: (next: DisplayValueType[]) => void;
		/** Compact sizing for dense table cells. */
		dense?: boolean;
	}

	let { selected, flavor, lang = 'en', onchange, dense = false }: Props = $props();

	let labels = $derived(getFlavorLabels(flavor, lang));

	/** Options offered for the active flavor, with their semantic colour. */
	let options = $derived.by(() => {
		const vt = labels.valueTypes;
		const opts: Array<{ value: DisplayValueType; label: string; color: string }> = [
			{ value: 'literal', label: vt.literal, color: 'var(--tapir-literal)' },
			{ value: 'iri', label: vt.iri, color: 'var(--tapir-iri)' },
		];
		if (flavor === 'simpledsp') {
			opts.push({ value: 'structured', label: vt.structured, color: 'var(--tapir-structured)' });
		}
		if (flavor === 'dctap') {
			opts.push({ value: 'bnode', label: vt.bnode, color: 'var(--tapir-bnode)' });
		}
		return opts;
	});

	/**
	 * Toggles one option and emits the resulting selection. `structured`
	 * is mutually exclusive with the node kinds.
	 */
	function toggle(value: DisplayValueType) {
		const on = selected.includes(value);
		if (value === 'structured') {
			onchange(on ? [] : ['structured']);
			return;
		}
		const nodeKinds = selected.filter((t) => t !== 'structured');
		onchange(on ? nodeKinds.filter((t) => t !== value) : [...nodeKinds, value]);
	}
</script>

<div
	class="flex flex-wrap gap-1.5"
	role="group"
	aria-label={labels.columns.valueType}
>
	{#each options as opt}
		{@const on = selected.includes(opt.value)}
		<button
			type="button"
			aria-pressed={on}
			onclick={() => toggle(opt.value)}
			class="rounded-md border font-medium transition-colors {dense
				? 'h-6 px-2 text-[11px]'
				: 'h-7 px-2.5 text-xs'} {on
				? 'text-white'
				: 'bg-transparent text-muted-foreground hover:bg-muted'}"
			style={on ? `background-color: ${opt.color}; border-color: ${opt.color};` : ''}
		>
			{opt.label}
		</button>
	{/each}
</div>
