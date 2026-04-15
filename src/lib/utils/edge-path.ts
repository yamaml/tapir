/**
 * @fileoverview Edge-path rendering for orthogonal diagram routing.
 *
 * Elk's orthogonal router returns each edge as a sequence of points
 * (start + bend points + end) that form a horizontal-and-vertical
 * polyline. Rendering that polyline with sharp `L` joins works, but a
 * small arc at each corner reads as "precise but friendly" — the
 * aesthetic shared by draw.io, Excalidraw, tldraw, and most modern
 * diagramming tools.
 *
 * This module adds two passes on top of the raw Elk output:
 *
 * 1. **Collinear collapse** — Elk's layered router often emits three
 *    consecutive points that are actually on one line. Collapsing
 *    them to a single segment reduces visual noise (fewer corners)
 *    and prevents the rounded-corner pass from drawing meaningless
 *    micro-arcs at non-bends.
 * 2. **Corner rounding** — each real bend is replaced with a short
 *    quadratic Bézier whose control point is the bend itself. The
 *    arc radius is clamped to half of each adjacent segment's length
 *    so tight corners (where both incoming segments are very short)
 *    collapse gracefully to a sharp join rather than overshooting.
 *
 * The helpers here are pure functions over `{x, y}` arrays; they make
 * no assumptions about the routing direction or about Elk's internal
 * types, so the preview (which uses Svelte's own section type) and
 * the export builder (which uses a local structural type) can both
 * call them.
 *
 * @module utils/edge-path
 */

// ── Types ───────────────────────────────────────────────────────

/** Minimal 2-D point. */
export interface Point {
	x: number;
	y: number;
}

// ── Helpers ─────────────────────────────────────────────────────

/**
 * True if `b` lies on the straight segment a→c (within a small
 * floating-point tolerance). Used to collapse runs of collinear
 * bend points that Elk sometimes emits as routing artefacts.
 */
function isCollinear(a: Point, b: Point, c: Point, tol = 0.5): boolean {
	// Cross product of vectors (b-a) × (c-a). Zero means collinear.
	const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
	return Math.abs(cross) < tol;
}

/**
 * Removes middle points from any run a–b–c where b sits on segment
 * a→c. Applied iteratively until no more collapses are possible, so
 * longer collinear runs (a–b–c–d all on one line) reduce to [a, d].
 *
 * Endpoints are never removed — the start and end points of the
 * routed edge are load-bearing (they anchor to the node ports).
 */
export function collapseCollinear(points: Point[]): Point[] {
	if (points.length < 3) return points.slice();
	let current = points.slice();
	let changed = true;
	while (changed) {
		changed = false;
		const next: Point[] = [current[0]];
		for (let i = 1; i < current.length - 1; i++) {
			const prev = next[next.length - 1];
			const mid = current[i];
			const nxt = current[i + 1];
			if (isCollinear(prev, mid, nxt)) {
				changed = true;
				continue;
			}
			next.push(mid);
		}
		next.push(current[current.length - 1]);
		current = next;
	}
	return current;
}

/** Euclidean distance. */
function distance(a: Point, b: Point): number {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Returns the point `r` units along the segment from `from` toward
 * `to`. Used to pick the entry/exit points of a rounded corner at a
 * bend.
 */
function along(from: Point, to: Point, r: number): Point {
	const len = distance(from, to);
	if (len === 0) return { ...from };
	const t = r / len;
	return {
		x: from.x + (to.x - from.x) * t,
		y: from.y + (to.y - from.y) * t,
	};
}

// ── Public API ──────────────────────────────────────────────────

/**
 * Renders an SVG path string from a sequence of points, with
 * rounded corners at each bend. Collinear runs are collapsed first
 * so non-bends don't receive a (meaningless) corner arc.
 *
 * The corner radius is the maximum desired rounding; at each bend
 * it's clamped to no more than 40 % of the shorter adjacent segment
 * so very short runs don't overshoot.
 *
 * @param points - `[start, ...bends, end]` from Elk's router.
 * @param radius - Max corner radius in SVG units (default 8).
 * @returns An `M ... L ... Q ... L ...` path string.
 *
 * @example
 * // Straight segment → plain line
 * roundedPath([{x:0,y:0},{x:0,y:10},{x:100,y:10},{x:100,y:20}])
 * //   "M 0 0 L 0 2 Q 0 10 8 10 L 92 10 Q 100 10 100 12 L 100 20"
 */
export function roundedPath(points: Point[], radius = 8): string {
	const pts = collapseCollinear(points);
	if (pts.length === 0) return '';
	if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`;
	if (pts.length === 2) {
		return `M ${pts[0].x} ${pts[0].y} L ${pts[1].x} ${pts[1].y}`;
	}

	let d = `M ${pts[0].x} ${pts[0].y}`;
	for (let i = 1; i < pts.length - 1; i++) {
		const prev = pts[i - 1];
		const corner = pts[i];
		const next = pts[i + 1];

		// Clamp the corner radius to 40 % of each adjacent segment so
		// tight runs degrade gracefully to a sharp join rather than
		// overshooting past the neighbouring corner.
		const r = Math.min(
			radius,
			distance(prev, corner) * 0.4,
			distance(corner, next) * 0.4,
		);

		if (r < 0.5) {
			// Degenerate: neighbouring segments are essentially
			// zero-length. Emit a sharp join — cleaner than a
			// zero-radius arc.
			d += ` L ${corner.x} ${corner.y}`;
			continue;
		}

		const entry = along(corner, prev, r);
		const exit = along(corner, next, r);
		d += ` L ${entry.x} ${entry.y} Q ${corner.x} ${corner.y} ${exit.x} ${exit.y}`;
	}

	// Final straight to the endpoint.
	const last = pts[pts.length - 1];
	d += ` L ${last.x} ${last.y}`;
	return d;
}

/**
 * Walks cumulative segment lengths along a (possibly collapsed)
 * polyline and returns the point at `t` of the total length.
 * Matches the semantics of the previous `edgeLabelMidpoint` helper
 * but works directly on a point array, so both the spline-based and
 * the polyline-based renderers can share it.
 *
 * @param points - `[start, ...bends, end]`.
 * @param t - Fraction of the path length (0…1). Defaults to 0.5.
 * @param offsetY - Pixels to subtract from the returned y so the
 *                  caller's label sits above the line rather than
 *                  on top of it. Defaults to 8.
 * @returns Interpolated point on the polyline.
 */
export function pointAlongPath(
	points: Point[],
	t = 0.5,
	offsetY = 8,
): Point {
	const pts = collapseCollinear(points);
	if (pts.length < 2) {
		const p = pts[0] ?? { x: 0, y: 0 };
		return { x: p.x, y: p.y - offsetY };
	}
	const segLengths: number[] = [];
	let total = 0;
	for (let i = 1; i < pts.length; i++) {
		const len = distance(pts[i - 1], pts[i]);
		segLengths.push(len);
		total += len;
	}
	if (total === 0) {
		return { x: pts[0].x, y: pts[0].y - offsetY };
	}
	const target = total * t;
	let walked = 0;
	for (let i = 0; i < segLengths.length; i++) {
		const segLen = segLengths[i];
		if (walked + segLen >= target) {
			const u = segLen === 0 ? 0 : (target - walked) / segLen;
			const a = pts[i];
			const b = pts[i + 1];
			return {
				x: a.x + (b.x - a.x) * u,
				y: a.y + (b.y - a.y) * u - offsetY,
			};
		}
		walked += segLen;
	}
	const last = pts[pts.length - 1];
	return { x: last.x, y: last.y - offsetY };
}
