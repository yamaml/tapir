/**
 * build-logo-png.ts
 *
 * Rasterises `static/tapir-logo.svg` into a 256×256 transparent PNG
 * at `static/tapir-logo.png`. The PNG is what the README masthead
 * (and any external markdown viewer) references via the published
 * GitHub Pages URL — PNG has broader support than SVG in the wild,
 * and keeping it at 256 px gives 2× headroom over the ~48 px display
 * size that GitHub renders for a README `<img>` inside an `#` heading.
 *
 * The SVG already has no background, so the resvg output is
 * transparent by default. No background flag needed.
 *
 * Re-run whenever the source SVG changes:
 *
 *     npm run build:logo
 *
 * Not part of the default build — the PNG is committed, so CI
 * doesn't need to regenerate it.
 */

import { readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { Resvg } from '@resvg/resvg-js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SVG_PATH = resolve(HERE, '../static/tapir-logo.svg');
const PNG_PATH = resolve(HERE, '../static/tapir-logo.png');
const OUTPUT_SIZE = 256;

const svg = readFileSync(SVG_PATH, 'utf8');
const resvg = new Resvg(svg, {
	fitTo: { mode: 'width', value: OUTPUT_SIZE },
	background: 'transparent',
});
const png = resvg.render().asPng();
writeFileSync(PNG_PATH, png);
console.log(`Wrote ${PNG_PATH} (${png.length} bytes, ${OUTPUT_SIZE}×${OUTPUT_SIZE})`);
