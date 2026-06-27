// @vitest-environment node
//
// Node environment on purpose: jsdom's TextEncoder returns a
// cross-realm Uint8Array that fflate's `zipSync` fails to recognise
// (`instanceof Uint8Array` is false), silently exploding every entry
// into a directory tree. Browsers are single-realm, so this only
// affects the test environment. The trade-off: `svgToPdfBlob` needs a
// DOM, so the diagram.pdf success path cannot run here — the README
// inclusion logic for it is covered by the `generatePackageReadme`
// unit tests instead.

import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { generatePackageZip, generatePackageReadme } from '$lib/converters/package-generator';
import { createProject, createDescription, createStatement } from '$lib/types';
import type { GeneratorWarning } from '$lib/types';

// ── Fixtures ────────────────────────────────────────────────────

function project() {
	return createProject({
		name: 'Pkg Test',
		flavor: 'simpledsp',
		descriptions: [
			createDescription({
				name: 'Book',
				statements: [
					createStatement({ propertyId: 'dcterms:title', label: 'Title', valueType: ['literal'] }),
				],
			}),
		],
	});
}

function readmeOf(zip: Uint8Array): string {
	const files = unzipSync(zip);
	return strFromU8(files['README.md']);
}

// ── generatePackageReadme ───────────────────────────────────────

describe('generatePackageReadme', () => {
	it('lists only the included artifacts', () => {
		const readme = generatePackageReadme('P', ['index.html', 'dctap.csv', 'diagram.pdf']);
		expect(readme).toContain('`index.html`');
		expect(readme).toContain('`dctap.csv`');
		expect(readme).toContain('`diagram.pdf`');
		expect(readme).not.toContain('`shacl.ttl`');
		expect(readme).not.toContain('`owldsp.ttl`');
		expect(readme).not.toContain('`diagram.svg`');
	});

	it('ignores filenames without a known descriptor row', () => {
		const readme = generatePackageReadme('P', ['README.md', 'mystery.bin']);
		expect(readme).not.toContain('mystery.bin');
	});
});

// ── generatePackageZip ──────────────────────────────────────────

describe('generatePackageZip', () => {
	it('lists successful artifacts and omits diagram rows when no SVG is provided', async () => {
		const warnings: GeneratorWarning[] = [];
		const zip = await generatePackageZip(project(), undefined, warnings);
		const files = unzipSync(zip);

		expect(files['diagram.svg']).toBeUndefined();
		expect(files['diagram.pdf']).toBeUndefined();
		const readme = readmeOf(zip);
		expect(readme).not.toContain('`diagram.svg`');
		expect(readme).not.toContain('`diagram.pdf`');
		// Core artifacts are present and listed.
		expect(files['shacl.ttl']).toBeDefined();
		expect(files['owldsp.ttl']).toBeDefined();
		expect(readme).toContain('`shacl.ttl`');
		expect(readme).toContain('`owldsp.ttl`');
		expect(readme).toContain('`dctap.csv`');
		// Nothing failed, so no skipped-artifact warnings.
		expect(warnings.filter((w) => w.message.includes('left out of the package'))).toEqual([]);
	});

	it('warns and drops diagram.pdf from the README when PDF conversion fails', async () => {
		const warnings: GeneratorWarning[] = [];
		// svgToPdfBlob rejects input without an <svg> element, which
		// stands in for any conversion failure (missing DOM, renderer
		// quirks) — the plumbing under test is identical.
		const zip = await generatePackageZip(project(), '<not-svg/>', warnings);
		const files = unzipSync(zip);

		expect(files['diagram.svg']).toBeDefined(); // raw string still bundled
		expect(files['diagram.pdf']).toBeUndefined();
		const readme = readmeOf(zip);
		expect(readme).toContain('`diagram.svg`');
		expect(readme).not.toContain('`diagram.pdf`');
		expect(warnings.some((w) => w.message.includes('diagram.pdf'))).toBe(true);
	});

	it('keeps the README file list in sync with the actual ZIP entries', async () => {
		const zip = await generatePackageZip(project(), '<not-svg/>');
		const files = unzipSync(zip);
		const readme = readmeOf(zip);

		// Every listed file exists; every artifact in the ZIP that has
		// a descriptor row is listed.
		const listed = [...readme.matchAll(/^\| `([^`]+)` \|/gm)].map((m) => m[1]);
		for (const file of listed) {
			expect(files[file], `${file} listed but missing from ZIP`).toBeDefined();
		}
		for (const file of Object.keys(files)) {
			if (file === 'README.md') continue;
			expect(listed, `${file} in ZIP but not listed`).toContain(file);
		}
	});
});
