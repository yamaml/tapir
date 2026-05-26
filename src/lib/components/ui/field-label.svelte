<!--
	Field label with optional help tooltip.

	Renders the label text in the caller's chosen style, followed by a
	small ? icon that opens a tooltip explanation on hover/focus. The
	icon is muted by default and brightens on hover, so labels without
	help text look identical to plain <label>s — opt-in per field.

	Why wrap rather than always show the icon: many fields are
	self-explanatory (the label "Min" doesn't need a tooltip), and
	stamping a ? on every label is visual noise that trains the user
	to stop looking. Reserve the affordance for fields whose names
	carry spec semantics that aren't obvious at first read.

	Usage:
	  <FieldLabel class={labelClass} for="prop-id"
	    help="The property the statement constrains, as a prefixed term">
	    propertyID
	  </FieldLabel>

	The wrapper renders an inline-flex container so the icon sits on
	the same baseline as the label text — no vertical jump compared
	to a bare <label>.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import HelpCircle from 'lucide-svelte/icons/circle-help';
	import Tip from '$lib/components/ui/tip.svelte';

	interface Props {
		/** Tailwind class applied to the underlying <label>. */
		class?: string;
		/** `for=` attribute on the underlying <label>. */
		for?: string;
		/**
		 * Optional help text shown in a tooltip when the user hovers
		 * the ? icon. Omit to render a plain label (no icon).
		 */
		help?: string;
		/** Label content (typically the field name). */
		children: Snippet;
	}

	let { class: className = '', for: forAttr, help, children }: Props = $props();
</script>

<!--
	`inline-flex` + `items-baseline` keeps the icon visually aligned
	with the label's text baseline. `gap-1` matches the existing
	field grid's compact spacing.
-->
<label class="inline-flex items-baseline gap-1 {className}" for={forAttr}>
	{@render children()}
	{#if help}
		<Tip text={help}>
			<!--
				Inline-flex button with no padding so the trigger area
				matches the icon glyph. Tabbable for keyboard users so
				the tooltip surfaces on focus too.
			-->
			<button
				type="button"
				class="inline-flex items-center text-muted-foreground/50 hover:text-muted-foreground focus-visible:text-muted-foreground transition-colors [&_svg]:pointer-events-none"
				aria-label="Help"
				tabindex="0"
			>
				<HelpCircle class="h-3 w-3" />
			</button>
		</Tip>
	{/if}
</label>
