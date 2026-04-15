/**
 * @fileoverview Convert an SVG string to a vector PDF Blob.
 *
 * Used by the Export dialog to produce a PDF copy of the diagram that
 * stays vector (text selectable, lines sharp at any zoom) so it can
 * be embedded in LaTeX or archived alongside the profile.
 *
 * The page is sized to the SVG's natural dimensions plus a small
 * padding on all sides — no paper-size fitting. That keeps the PDF
 * tight when used as a figure, while also looking reasonable when
 * opened standalone.
 *
 * This module lazy-loads `jspdf` and `svg2pdf.js` on demand so the
 * editor bundle isn't weighed down by PDF code users rarely hit.
 *
 * @module utils/svg-to-pdf
 */

/**
 * Padding added on every side of the diagram inside the PDF page
 * (points — 1 pt = 1/72 inch ≈ 1 px at default screen DPI). Gives
 * the image a comfortable margin when viewed standalone, but stays
 * small enough to not waste space when embedded in a paper.
 */
export const PDF_PADDING = 24;

/**
 * Renders an SVG string to a PDF and returns it as a Blob.
 *
 * Text inside the SVG stays as real PDF text (mapped to the default
 * Helvetica family) so it remains selectable and searchable in the
 * resulting file.
 *
 * The page size is derived from the SVG's viewBox — width + 2 ×
 * padding, height + 2 × padding — and the SVG is drawn offset by
 * the padding on both axes. Works with any SVG dimensions; there's
 * no paper-size normalisation.
 *
 * @param svgString - The SVG markup to render.
 * @returns A `Blob` with MIME type `application/pdf`.
 *
 * @example
 * const svg = exportSvgString(project);
 * const pdfBlob = await svgToPdfBlob(svg);
 * downloadBlob(pdfBlob, 'diagram.pdf');
 */
export async function svgToPdfBlob(svgString: string): Promise<Blob> {
	// Lazy-load so the ~150 KB of PDF code only lands in the client
	// bundle when a user actually exports a PDF.
	const [{ jsPDF }, { svg2pdf }, fontData] = await Promise.all([
		import('jspdf'),
		import('svg2pdf.js'),
		loadInterFonts(),
	]);

	// Parse the SVG with DOMParser (safe: input is always produced by
	// Tapir's own generateExportSvg, never user-authored markup).
	// svg2pdf walks a live element tree and needs layout metrics, so
	// we mount the parsed node in a hidden host before rendering.
	const { svgElement, width, height, cleanup } = mountSvgOffscreen(svgString);

	try {
		const pageWidth = width + PDF_PADDING * 2;
		const pageHeight = height + PDF_PADDING * 2;
		const orientation = pageWidth >= pageHeight ? 'l' : 'p';
		const doc = new jsPDF({
			orientation,
			unit: 'pt',
			// Custom page size — jsPDF accepts [w, h] in the configured unit.
			format: [pageWidth, pageHeight],
			compress: true,
		});

		// Register Inter + JetBrains Mono with jsPDF. Without this
		// step svg2pdf falls back to one of jsPDF's built-in
		// Helvetica/Times/Courier faces, which (a) lack the arrow
		// glyphs the diagram uses (→, ↺) and (b) have metrics that
		// don't match Inter's — causing the `!' / !º` fallback glyphs
		// and the "P e r s o n" letter-spacing artefacts seen in
		// earlier PDFs. Registering both faces also means property
		// IRIs inside rows render in the same monospace face the UI
		// uses, so the PDF visually matches the editor.
		if (fontData) {
			doc.addFileToVFS('Inter-Regular.ttf', fontData.interRegular);
			doc.addFileToVFS('Inter-Bold.ttf', fontData.interBold);
			doc.addFont('Inter-Regular.ttf', 'Inter', 'normal');
			doc.addFont('Inter-Bold.ttf', 'Inter', 'bold');
			doc.addFileToVFS('JetBrainsMono-Regular.ttf', fontData.monoRegular);
			doc.addFileToVFS('JetBrainsMono-Bold.ttf', fontData.monoBold);
			doc.addFont('JetBrainsMono-Regular.ttf', 'JetBrains Mono', 'normal');
			doc.addFont('JetBrainsMono-Bold.ttf', 'JetBrains Mono', 'bold');
			doc.setFont('Inter', 'normal');
		}

		await svg2pdf(svgElement, doc, {
			x: PDF_PADDING,
			y: PDF_PADDING,
			width,
			height,
		});
		const ab = doc.output('arraybuffer');
		return new Blob([ab], { type: 'application/pdf' });
	} finally {
		cleanup();
	}
}

// ── Font loading ────────────────────────────────────────────────

/**
 * Loads Inter + JetBrains Mono TTF bytes from the bundled static
 * assets and returns them as base64 strings ready for
 * `jsPDF.addFileToVFS`. Cached after the first call so subsequent
 * exports don't re-fetch ~1.4 MB of font data.
 *
 * Returns `null` if any fetch fails (e.g. running in a test
 * environment without a static-asset server) so PDF export still
 * produces output — it just falls back to svg2pdf's default Helvetica
 * mapping with the known glyph/metric issues.
 */
interface FontData {
	interRegular: string;
	interBold: string;
	monoRegular: string;
	monoBold: string;
}
let fontDataCache: FontData | null = null;
async function loadInterFonts(): Promise<FontData | null> {
	if (fontDataCache) return fontDataCache;
	try {
		const { base } = await import('$app/paths');
		const [interRegular, interBold, monoRegular, monoBold] = await Promise.all([
			fetchAsBase64(`${base}/fonts/Inter-Regular.ttf`),
			fetchAsBase64(`${base}/fonts/Inter-Bold.ttf`),
			fetchAsBase64(`${base}/fonts/JetBrainsMono-Regular.ttf`),
			fetchAsBase64(`${base}/fonts/JetBrainsMono-Bold.ttf`),
		]);
		fontDataCache = { interRegular, interBold, monoRegular, monoBold };
		return fontDataCache;
	} catch {
		return null;
	}
}

async function fetchAsBase64(url: string): Promise<string> {
	const res = await fetch(url);
	if (!res.ok) throw new Error(`Font fetch failed: ${url}`);
	const bytes = new Uint8Array(await res.arrayBuffer());
	// btoa requires a binary string — chunk to avoid call-stack
	// overflow on the ~400 KB font file.
	let binary = '';
	const chunkSize = 0x8000;
	for (let i = 0; i < bytes.length; i += chunkSize) {
		binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunkSize)));
	}
	return btoa(binary);
}

// ── Helpers ─────────────────────────────────────────────────────

/**
 * Parses an SVG string, mounts it off-screen, and returns the element
 * along with its measured width/height and a cleanup function.
 *
 * svg2pdf needs live layout, so we can't operate on a detached parse
 * result alone — it has to be attached to the document. The host div
 * is positioned off-screen (visibility hidden + absolute) so it
 * never flashes into view.
 */
function mountSvgOffscreen(svgString: string): {
	svgElement: SVGSVGElement;
	width: number;
	height: number;
	cleanup: () => void;
} {
	// DOMParser keeps the SVG namespace intact and avoids the innerHTML
	// parser's quirks (it treats some SVG elements as HTML entities).
	const doc = new DOMParser().parseFromString(svgString, 'image/svg+xml');
	const parseError = doc.querySelector('parsererror');
	if (parseError) {
		throw new Error(`svgToPdfBlob: failed to parse SVG: ${parseError.textContent}`);
	}
	const parsed = doc.documentElement;
	if (!(parsed instanceof SVGSVGElement)) {
		throw new Error('svgToPdfBlob: input did not contain an <svg> element');
	}

	// Import into the live document so the element participates in
	// layout, and mount it off-screen so it's not visible during
	// rendering.
	const svgElement = document.importNode(parsed, true) as SVGSVGElement;
	const host = document.createElement('div');
	host.style.position = 'absolute';
	host.style.left = '-10000px';
	host.style.top = '-10000px';
	host.style.visibility = 'hidden';
	host.appendChild(svgElement);
	document.body.appendChild(host);

	const { width, height } = readSvgDimensions(svgElement);

	return {
		svgElement,
		width,
		height,
		cleanup: () => host.remove(),
	};
}

function readSvgDimensions(svg: SVGSVGElement): { width: number; height: number } {
	const viewBox = svg.getAttribute('viewBox');
	if (viewBox) {
		const parts = viewBox.trim().split(/\s+/).map(Number);
		if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
			return { width: parts[2], height: parts[3] };
		}
	}
	const w = parseFloat(svg.getAttribute('width') ?? '');
	const h = parseFloat(svg.getAttribute('height') ?? '');
	if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
		return { width: w, height: h };
	}
	try {
		const bbox = svg.getBBox();
		if (bbox.width > 0 && bbox.height > 0) {
			return { width: bbox.width, height: bbox.height };
		}
	} catch {
		// getBBox can throw on detached or empty SVGs — fall through.
	}
	// Last resort. 400 × 300 matches the fallback viewBox the exporter
	// emits for empty profiles ("No descriptions").
	return { width: 400, height: 300 };
}
