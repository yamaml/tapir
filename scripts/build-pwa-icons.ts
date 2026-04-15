/**
 * build-pwa-icons.ts
 *
 * Generates the two PNG icons the web app manifest needs for
 * Chromium-class desktop install:
 *
 *   static/icons/tapir-192.png  — used by the launcher, dock, and
 *                                  small surfaces
 *   static/icons/tapir-512.png  — used by Chrome for splash screens
 *                                  and high-DPI contexts
 *
 * Both are rendered from `static/tapir-logo.svg` with a solid
 * background. The silhouette is tinted peach (#FFCE9F, matching the
 * SimpleDSP block header colour already in the diagram palette) on
 * a slate-dark background (#1f2937, tracking the editor's dark-mode
 * chrome). Choosing a solid background over transparent is deliberate:
 * Chrome's app launcher renders transparent icons against whichever
 * wallpaper is showing, which looks unreliable. A solid background
 * produces a stable, on-brand app tile in every install context.
 *
 * Re-run whenever the logo or the background colour changes:
 *
 *     npx tsx scripts/build-pwa-icons.ts
 *
 * Output PNGs are committed; CI does not regenerate them.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { Resvg } from '@resvg/resvg-js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SVG_PATH = resolve(HERE, '../static/tapir-logo.svg');
const OUT_DIR = resolve(HERE, '../static/icons');

const BG = '#1f2937'; // slate-800
const FG = '#FFCE9F'; // peach — SimpleDSP header palette

mkdirSync(OUT_DIR, { recursive: true });

const rawSvg = readFileSync(SVG_PATH, 'utf8');

// Wrap the silhouette in a composited SVG: solid background rect,
// peach-tinted silhouette padded 15 % so it doesn't bleed to the
// icon edges. Chrome's safe-zone for maskable icons is 80 % of the
// short axis; we stay well inside that.
function composedSvg(size: number): string {
	const inner = Math.round(size * 0.7); // silhouette occupies 70 % of tile
	const offset = Math.round((size - inner) / 2);
	return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${BG}" rx="${Math.round(size * 0.18)}"/>
  <g transform="translate(${offset}, ${offset})">
    <svg width="${inner}" height="${inner}" viewBox="0 0 1200 1200" xmlns="http://www.w3.org/2000/svg">
      ${rawSvg.replace(/<\?xml[^?]*\?>/, '').replace(/<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace('fill-rule="evenodd"', 'fill-rule="evenodd" fill="' + FG + '"')}
    </svg>
  </g>
</svg>`;
}

for (const size of [192, 512]) {
	const svg = composedSvg(size);
	const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: size } });
	const png = resvg.render().asPng();
	const outPath = resolve(OUT_DIR, `tapir-${size}.png`);
	writeFileSync(outPath, png);
	console.log(`Wrote ${outPath} (${png.length} bytes, ${size}×${size})`);
}
