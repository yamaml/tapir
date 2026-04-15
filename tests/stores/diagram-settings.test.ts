import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import {
	diagramSettings,
	edgeLabelsDisabled,
	effectiveShowEdgeLabels,
	getDiagramSettings,
	setDiagramSetting,
	toggleShowLabel,
	toggleShowProperty,
	DEFAULT_DIAGRAM_SETTINGS,
} from '$lib/stores/diagram-settings-store';

describe('diagramSettings store', () => {
	beforeEach(() => {
		diagramSettings.set({ ...DEFAULT_DIAGRAM_SETTINGS });
	});

	it('starts with sensible archive-grade defaults', () => {
		const s = get(diagramSettings);
		expect(s.style).toBe('detail');
		expect(s.palette).toBe('color');
		expect(s.showEdges).toBe(true);
		expect(s.showEdgeLabels).toBe(true);
		expect(s.showCardinality).toBe(true);
	});

	it('setDiagramSetting updates one field without touching others', () => {
		setDiagramSetting('palette', 'bw');
		const s = get(diagramSettings);
		expect(s.palette).toBe('bw');
		expect(s.style).toBe('detail');
		expect(s.showEdges).toBe(true);
	});

	describe('edge-label dependency rule', () => {
		it('edgeLabelsDisabled is false when edges are on', () => {
			expect(get(edgeLabelsDisabled)).toBe(false);
		});

		it('edgeLabelsDisabled is true when edges are off', () => {
			setDiagramSetting('showEdges', false);
			expect(get(edgeLabelsDisabled)).toBe(true);
		});

		it('effectiveShowEdgeLabels collapses the dependency', () => {
			setDiagramSetting('showEdges', false);
			// Even though showEdgeLabels is still stored as true…
			expect(get(diagramSettings).showEdgeLabels).toBe(true);
			// …the effective value is false when edges are off.
			expect(get(effectiveShowEdgeLabels)).toBe(false);
		});

		it('preserves the stored showEdgeLabels when edges toggle off then on', () => {
			setDiagramSetting('showEdgeLabels', false);
			setDiagramSetting('showEdges', false);
			setDiagramSetting('showEdges', true);
			expect(get(diagramSettings).showEdgeLabels).toBe(false);
		});
	});

	describe('getDiagramSettings snapshot', () => {
		it('returns an object with the dependency applied', () => {
			setDiagramSetting('showEdges', false);
			const snap = getDiagramSettings();
			expect(snap.showEdges).toBe(false);
			expect(snap.showEdgeLabels).toBe(false);
		});

		it('leaves showEdgeLabels true when both flags are on', () => {
			const snap = getDiagramSettings();
			expect(snap.showEdgeLabels).toBe(true);
		});
	});

	describe('label/property at-least-one invariant', () => {
		it('defaults to property-only', () => {
			const s = get(diagramSettings);
			expect(s.showLabel).toBe(false);
			expect(s.showProperty).toBe(true);
		});

		it('turning the currently-on label off flips property on', () => {
			// Start with label-only
			diagramSettings.set({ ...DEFAULT_DIAGRAM_SETTINGS, showLabel: true, showProperty: false });
			toggleShowLabel(false);
			const s = get(diagramSettings);
			expect(s.showLabel).toBe(false);
			expect(s.showProperty).toBe(true);
		});

		it('turning the currently-on property off flips label on', () => {
			// Default is property-only
			toggleShowProperty(false);
			const s = get(diagramSettings);
			expect(s.showProperty).toBe(false);
			expect(s.showLabel).toBe(true);
		});

		it('allows both to be on simultaneously', () => {
			toggleShowLabel(true);
			const s = get(diagramSettings);
			expect(s.showLabel).toBe(true);
			expect(s.showProperty).toBe(true);
		});

		it('enabling one does not disturb the other', () => {
			// Start with both on
			diagramSettings.set({ ...DEFAULT_DIAGRAM_SETTINGS, showLabel: true, showProperty: true });
			toggleShowLabel(true); // no-op
			const s = get(diagramSettings);
			expect(s.showLabel).toBe(true);
			expect(s.showProperty).toBe(true);
		});
	});
});
