/**
 * @fileoverview Canvas-based text measurement for accurate SVG node sizing.
 *
 * Uses a hidden canvas element with `ctx.measureText()` to determine the
 * actual pixel width of text strings, replacing the inaccurate character-width
 * heuristic (`CHAR_WIDTH = 6.5`).
 *
 * The canvas context is created once and cached for performance.
 *
 * @module utils/text-measure
 */

let _ctx: CanvasRenderingContext2D | null = null;

/**
 * Returns a cached 2D canvas context for text measurement.
 * Creates the canvas on first call.
 */
function getContext(): CanvasRenderingContext2D {
	if (_ctx) return _ctx;
	const canvas = document.createElement('canvas');
	canvas.width = 1;
	canvas.height = 1;
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('Canvas 2D context not available');
	_ctx = ctx;
	return _ctx;
}

/**
 * Measures the pixel width of a text string using a canvas context.
 *
 * @param text - The text to measure.
 * @param fontSize - Font size in pixels (default: 10).
 * @param fontWeight - CSS font weight (default: 'normal').
 * @returns The measured pixel width.
 */
export function measureTextWidth(
	text: string,
	fontSize: number = 10,
	fontWeight: string = 'normal'
): number {
	const ctx = getContext();
	ctx.font = `${fontWeight} ${fontSize}px system-ui, -apple-system, sans-serif`;
	return ctx.measureText(text).width;
}

/**
 * Estimates text width using character-count heuristic.
 * Used for SSR/export contexts where canvas is not available.
 *
 * @param text - The text to measure.
 * @param fontSize - Font size in pixels (default: 10).
 * @param fontWeight - CSS font weight (default: 'normal').
 * @returns Estimated pixel width.
 */
export function estimateTextWidth(
	text: string,
	fontSize: number = 10,
	fontWeight: string = 'normal'
): number {
	// Average character width ratios for system-ui
	const baseRatio = fontWeight === 'bold' || fontWeight === '600' || fontWeight === '700'
		? 0.62
		: 0.56;
	return text.length * fontSize * baseRatio;
}

/**
 * Measures text width, falling back to estimation when canvas is unavailable.
 *
 * @param text - The text to measure.
 * @param fontSize - Font size in pixels (default: 10).
 * @param fontWeight - CSS font weight (default: 'normal').
 * @returns The measured or estimated pixel width.
 */
export function safeTextWidth(
	text: string,
	fontSize: number = 10,
	fontWeight: string = 'normal'
): number {
	try {
		if (typeof document !== 'undefined') {
			return measureTextWidth(text, fontSize, fontWeight);
		}
	} catch {
		// Fall through to estimation
	}
	return estimateTextWidth(text, fontSize, fontWeight);
}
