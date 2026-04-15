import { describe, it, expect } from 'vitest';
import { svgToPdfBlob, PDF_PADDING } from '$lib/utils/svg-to-pdf';

// Text-free SVG: jsdom implements SVG layout but stubs out text
// metrics (getBBox on <text> elements throws), so the unit tests
// avoid <text> to keep them portable. Real browsers handle text
// fine — we verify that end-to-end via Playwright in the export
// dialog smoke test.
const SAMPLE_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">
  <rect x="10" y="10" width="60" height="30" fill="#ccc" />
  <circle cx="120" cy="50" r="20" fill="none" stroke="#333" />
</svg>`;

describe('svgToPdfBlob', () => {
	it('exports the padding constant', () => {
		expect(PDF_PADDING).toBeGreaterThan(0);
	});

	it('returns a Blob with PDF MIME type', async () => {
		const blob = await svgToPdfBlob(SAMPLE_SVG);
		expect(blob).toBeInstanceOf(Blob);
		expect(blob.type).toBe('application/pdf');
	});

	it('produces bytes that start with the PDF magic header', async () => {
		const blob = await svgToPdfBlob(SAMPLE_SVG);
		const ab = await blob.arrayBuffer();
		const head = new TextDecoder().decode(ab.slice(0, 5));
		// "%PDF-" is the first five bytes of every PDF file.
		expect(head).toBe('%PDF-');
	});

	it('throws a helpful error when input is not an SVG', async () => {
		await expect(svgToPdfBlob('<html></html>')).rejects.toThrow(
			/did not contain an <svg>/,
		);
	});
});
