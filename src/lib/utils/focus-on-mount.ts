/**
 * @fileoverview Svelte action that focuses an element when it mounts.
 *
 * Replaces the HTML `autofocus` attribute in the inline cell/field
 * editors. The attribute is flagged by svelte-check (`a11y_autofocus`)
 * because *page-load* autofocus disorients assistive-technology users;
 * these editors only mount in response to an explicit user action
 * (clicking a cell, starting a rename), where moving focus is the
 * expected behaviour. The action keeps that UX without the attribute.
 *
 * @module utils/focus-on-mount
 *
 * @example
 * <input use:focusOnMount bind:value={draft} />
 */

/**
 * Focuses the node as soon as it is inserted into the DOM.
 *
 * @param node - The element to focus (input, select, textarea, …).
 */
export function focusOnMount(node: HTMLElement): void {
	node.focus();
}
