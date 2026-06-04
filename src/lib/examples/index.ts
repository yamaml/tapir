/**
 * Built-in example profiles.
 *
 * Example source files live in `./data/` and are imported as build-time
 * strings via Vite's `?raw` suffix. This keeps examples fully offline
 * (no `fetch`, no base-path handling) and routes them through the same
 * import path a user-picked file would take.
 */
import type { Flavor } from '$lib/types';
import tbbtSimpledsp from './data/tbbt-simpledsp.tsv?raw';
import srapAprilModel from './data/srap-april-model.csv?raw';

// ── Types ───────────────────────────────────────────────────────

/** A bundled example application profile. */
export interface ProfileExample {
	/** Stable identifier, used by the dashboard quick buttons. */
	id: string;
	/** Which flavor this example is authored in. */
	flavor: Flavor;
	/** Card title; also the default project name when loaded. */
	title: string;
	/** One-line description shown on the example card. */
	description: string;
	/**
	 * File name presented to the importer. The extension determines
	 * which parser runs (`.tsv` → SimpleDSP, `.csv` → DCTAP).
	 */
	fileName: string;
	/** Raw file content, imported at build time via `?raw`. */
	raw: string;
}

// ── Registry ────────────────────────────────────────────────────

/**
 * The example profiles offered in the UI. Add an entry (plus its
 * `?raw` import above) to ship another example — no UI changes needed.
 */
export const EXAMPLES: ProfileExample[] = [
	{
		id: 'tbbt',
		flavor: 'simpledsp',
		title: 'Big Bang Theory characters',
		description: 'Character profile with cross-references between people.',
		fileName: 'tbbt-simpledsp.tsv',
		raw: tbbtSimpledsp,
	},
	{
		id: 'srap-april',
		flavor: 'dctap',
		title: 'SRAP — Scholarly Resource AP',
		description: 'Eight shapes, COAR vocabularies, multi-shape references.',
		fileName: 'srap-april-model.csv',
		raw: srapAprilModel,
	},
];

// ── Helpers ─────────────────────────────────────────────────────

/**
 * Looks up an example by id.
 *
 * @param id - The example id (e.g. `'tbbt'`).
 * @returns The matching example, or `undefined` if none.
 *
 * @example
 * const ex = getExample('srap-april');
 */
export function getExample(id: string): ProfileExample | undefined {
	return EXAMPLES.find((e) => e.id === id);
}

/**
 * Builds a `File` from an example so it can be fed to the existing
 * importer exactly like a user-picked file.
 *
 * @param ex - The example to wrap.
 * @returns A `File` carrying the example's raw text and file name.
 *
 * @example
 * const file = exampleToFile(getExample('tbbt')!);
 * await processImportedFile(file);
 */
export function exampleToFile(ex: ProfileExample): File {
	return new File([ex.raw], ex.fileName, { type: 'text/plain' });
}
