import { describe, it, expect } from 'vitest';
import { collapseCollinear, roundedPath, pointAlongPath } from '$lib/utils/edge-path';

describe('collapseCollinear', () => {
	it('keeps endpoints untouched when there are only two points', () => {
		const out = collapseCollinear([{ x: 0, y: 0 }, { x: 10, y: 0 }]);
		expect(out).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }]);
	});

	it('collapses a single collinear middle point', () => {
		const out = collapseCollinear([
			{ x: 0, y: 0 },
			{ x: 5, y: 0 },
			{ x: 10, y: 0 },
		]);
		expect(out).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }]);
	});

	it('collapses a longer collinear run iteratively', () => {
		const out = collapseCollinear([
			{ x: 0, y: 0 },
			{ x: 2, y: 0 },
			{ x: 5, y: 0 },
			{ x: 8, y: 0 },
			{ x: 10, y: 0 },
		]);
		expect(out).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }]);
	});

	it('preserves real bends', () => {
		const out = collapseCollinear([
			{ x: 0, y: 0 },
			{ x: 10, y: 0 },
			{ x: 10, y: 10 },
		]);
		expect(out).toHaveLength(3);
	});

	it('collapses only the straight portion of a mixed path', () => {
		const out = collapseCollinear([
			{ x: 0, y: 0 },
			{ x: 5, y: 0 },
			{ x: 10, y: 0 },
			{ x: 10, y: 5 },
			{ x: 10, y: 10 },
		]);
		expect(out).toEqual([
			{ x: 0, y: 0 },
			{ x: 10, y: 0 },
			{ x: 10, y: 10 },
		]);
	});
});

describe('roundedPath', () => {
	it('returns a plain line for a straight two-point path', () => {
		const d = roundedPath([{ x: 0, y: 0 }, { x: 10, y: 0 }]);
		expect(d).toBe('M 0 0 L 10 0');
	});

	it('collapses a trivial three-point collinear path to one line', () => {
		const d = roundedPath([
			{ x: 0, y: 0 },
			{ x: 5, y: 0 },
			{ x: 10, y: 0 },
		]);
		expect(d).toBe('M 0 0 L 10 0');
	});

	it('emits a quadratic curve at a real 90-degree bend', () => {
		// Long enough segments that the default radius (8) fits.
		const d = roundedPath([
			{ x: 0, y: 0 },
			{ x: 100, y: 0 },
			{ x: 100, y: 100 },
		]);
		expect(d).toContain('Q 100 0'); // control point = corner
		expect(d).toMatch(/^M 0 0 L 92 0 Q 100 0 100 8 L 100 100$/);
	});

	it('clamps the radius on a very short adjacent segment', () => {
		// Second segment is only 4 px; radius must shrink to <=1.6.
		const d = roundedPath([
			{ x: 0, y: 0 },
			{ x: 100, y: 0 },
			{ x: 100, y: 4 },
		]);
		// Should not produce coordinates past the endpoint.
		const yValues = [...d.matchAll(/\b(\d+(?:\.\d+)?)\b/g)].map((m) => Number(m[1]));
		expect(Math.max(...yValues)).toBeLessThanOrEqual(100);
		// Entry x on the first segment should be at most 1.6 before the corner.
		expect(d).toMatch(/L 98\.4 0/);
	});

	it('falls back to sharp join when segments are essentially zero-length', () => {
		const d = roundedPath([
			{ x: 0, y: 0 },
			{ x: 0.1, y: 0 },
			{ x: 0.1, y: 10 },
		]);
		expect(d).toContain('L 0.1 0');
		// No Q command should appear because r clamps below 0.5.
		expect(d).not.toContain('Q');
	});

	it('chains multiple corners correctly', () => {
		// A U-shaped path: 3 bends.
		const d = roundedPath([
			{ x: 0, y: 0 },
			{ x: 100, y: 0 },
			{ x: 100, y: 100 },
			{ x: 0, y: 100 },
		]);
		// Exactly two Q commands (two corners).
		expect([...d.matchAll(/\bQ\b/g)]).toHaveLength(2);
	});
});

describe('pointAlongPath', () => {
	it('returns the midpoint of a straight line', () => {
		const p = pointAlongPath([{ x: 0, y: 0 }, { x: 100, y: 0 }], 0.5, 0);
		expect(p).toEqual({ x: 50, y: 0 });
	});

	it('applies the y offset so the label floats above the line', () => {
		const p = pointAlongPath([{ x: 0, y: 0 }, { x: 100, y: 0 }]);
		expect(p).toEqual({ x: 50, y: -8 });
	});

	it('walks cumulative lengths on a multi-segment polyline', () => {
		// L-shape: 100 right, 100 down. Midpoint (length 100) = corner.
		const p = pointAlongPath(
			[{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }],
			0.5,
			0,
		);
		expect(p).toEqual({ x: 100, y: 0 });
	});

	it('handles a zero-length path without dividing by zero', () => {
		const p = pointAlongPath([{ x: 5, y: 5 }, { x: 5, y: 5 }], 0.5, 0);
		expect(p).toEqual({ x: 5, y: 5 });
	});
});
