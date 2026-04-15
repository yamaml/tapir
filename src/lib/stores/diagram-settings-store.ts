/**
 * @fileoverview Shared diagram-settings model.
 *
 * Single source of truth for the diagram toggles that both the live
 * preview panel (`diagram-panel.svelte`) and the Export dialog consult.
 * "What you see is what you get" — the SVG, PDF, PNG and DOT exports
 * all render with whatever the user has configured here, and the
 * in-editor preview reflects the same state.
 *
 * **One deliberate exception:** the Profile Package ZIP ignores this
 * store and always uses hardcoded defaults (detail + colour + all
 * three display toggles on). The package is an archive-grade bundle
 * — its contents should be predictable regardless of UI state at the
 * time of export.
 *
 * @module stores/diagram-settings-store
 */

import { writable, derived, get } from 'svelte/store';

// ── Types ───────────────────────────────────────────────────────

/** Detail shows per-statement rows; overview shows just shape names. */
export type DiagramStyle = 'detail' | 'overview';

/** Colour diagrams for screen; B&W for print or high-contrast use. */
export type DiagramPalette = 'color' | 'bw';

/** The full settings record consumed by the SVG builder. */
export interface DiagramSettings {
	style: DiagramStyle;
	palette: DiagramPalette;
	/** Whether cross-reference connection lines between shapes are drawn. */
	showEdges: boolean;
	/**
	 * Whether the text annotation on each edge is drawn.
	 *
	 * Semantically depends on `showEdges`: if edges are hidden, labels
	 * have nothing to attach to. The UI greys out this toggle when
	 * `showEdges` is false but preserves the stored value so toggling
	 * edges back on restores the user's preference.
	 */
	showEdgeLabels: boolean;
	/** Whether the cardinality column (`0..*`, `1..1`) inside each row renders. */
	showCardinality: boolean;
	/**
	 * Row-content toggle: whether each statement's human-readable
	 * label (e.g. "Creator") is shown. Has an "at-least-one-on"
	 * invariant with `showProperty` — if the user tries to turn off
	 * the only active one, the other auto-flips on. See
	 * {@link toggleShowLabel} / {@link toggleShowProperty}.
	 */
	showLabel: boolean;
	/** Row-content toggle: whether the property IRI (`dct:creator`) is shown. */
	showProperty: boolean;
}

/**
 * Hardcoded defaults used by the Profile Package ZIP and as the
 * initial values for the shared store. Everything on, detail mode,
 * colour palette — the archive-sane configuration.
 *
 * Row contents default to property-only: the property IRI is what
 * uniquely identifies a statement, the label is editorial polish.
 * Users can opt into labels (or both together) via the toggle pair.
 */
export const DEFAULT_DIAGRAM_SETTINGS: DiagramSettings = {
	style: 'detail',
	palette: 'color',
	showEdges: true,
	showEdgeLabels: true,
	showCardinality: true,
	showLabel: false,
	showProperty: true,
};

// ── Store ───────────────────────────────────────────────────────

/**
 * Reactive diagram-settings store. Mutations here update the live
 * preview and the Export dialog's controls simultaneously.
 */
export const diagramSettings = writable<DiagramSettings>({
	...DEFAULT_DIAGRAM_SETTINGS,
});

// ── Derived ─────────────────────────────────────────────────────

/**
 * Whether the Show-edge-labels toggle should be shown as disabled
 * in the UI. Edge labels are structurally dependent on edges — there
 * is nothing to label when there are no edges — so the dependent
 * toggle greys out when its parent is off. The stored preference
 * survives; toggling edges back on reveals the label state as-is.
 */
export const edgeLabelsDisabled = derived(
	diagramSettings,
	($s) => !$s.showEdges,
);

/**
 * Effective `showEdgeLabels` after applying the dependency rule.
 * Consumers that render the diagram should use this rather than the
 * raw store field so an orphaned `showEdgeLabels === true` with
 * `showEdges === false` doesn't produce floating labels.
 */
export const effectiveShowEdgeLabels = derived(
	diagramSettings,
	($s) => $s.showEdges && $s.showEdgeLabels,
);

// ── Helpers ─────────────────────────────────────────────────────

/**
 * Reads the current settings once (non-reactively). Useful from
 * imperative handlers like the Export dialog's button callbacks that
 * generate the SVG on demand.
 */
export function getDiagramSettings(): DiagramSettings {
	const s = get(diagramSettings);
	// Collapse the edge-label dependency so callers don't have to
	// remember the rule. The raw store value is preserved for the UI.
	return { ...s, showEdgeLabels: s.showEdges && s.showEdgeLabels };
}

/** Updates a single field and writes back. */
export function setDiagramSetting<K extends keyof DiagramSettings>(
	key: K,
	value: DiagramSettings[K],
): void {
	diagramSettings.update((s) => ({ ...s, [key]: value }));
}

/**
 * Toggles `showLabel` while preserving the "at least one of
 * showLabel / showProperty is on" invariant.
 *
 * If the user tries to turn off the only currently-on option, the
 * other one flips on automatically — rows always have something to
 * display. This matches the UX agreed in brainstorming: no greyed-
 * out disabled state, just a straightforward swap.
 *
 * @param next - Desired new value for `showLabel`.
 */
export function toggleShowLabel(next: boolean): void {
	diagramSettings.update((s) => {
		if (next) return { ...s, showLabel: true };
		// Turning labels off — make sure property is on so the row
		// isn't blank. If property is already on, straightforward.
		return { ...s, showLabel: false, showProperty: true };
	});
}

/**
 * Symmetric counterpart of {@link toggleShowLabel} for `showProperty`.
 * Same at-least-one invariant.
 */
export function toggleShowProperty(next: boolean): void {
	diagramSettings.update((s) => {
		if (next) return { ...s, showProperty: true };
		return { ...s, showProperty: false, showLabel: true };
	});
}
