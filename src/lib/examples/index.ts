/**
 * @fileoverview Built-in example profiles.
 *
 * Example source files live in `./data/` and are imported as build-time
 * strings via Vite's `?raw` suffix. This keeps examples fully offline
 * (no `fetch`, no base-path handling) and routes them through the same
 * import path a user-picked file would take.
 *
 * @module examples
 */
import type { Flavor } from '$lib/types';
import tbbtSimpledsp from './data/tbbt-simpledsp.tsv?raw';
import tbbtDctap from './data/tbbt-dctap.csv?raw';
import srapSimpledsp from './data/srap-simpledsp.tsv?raw';
import srapAprilModel from './data/srap-april-model.csv?raw';

// ── Types ───────────────────────────────────────────────────────

/** Identifiers of the bundled examples. */
export type ExampleId = 'tbbt-simpledsp' | 'tbbt-dctap' | 'srap-simpledsp' | 'srap-dctap';

/** A bundled example application profile. */
export interface ProfileExample {
	/** Stable identifier, used by the dashboard quick buttons. */
	id: ExampleId;
	/** Which flavor this example is authored in. */
	flavor: Flavor;
	/**
	 * Card title shown in the dialog. The loaded project's name is
	 * derived from `fileName` (matching normal file import), not this.
	 */
	title: string;
	/** Compact label for the dashboard quick buttons. */
	shortLabel: string;
	/** One-line description shown on the example card. */
	description: string;
	/**
	 * File name presented to the importer. The extension determines
	 * which parser runs — by convention SimpleDSP examples use `.tsv`
	 * and DCTAP examples use `.csv`.
	 */
	fileName: string;
	/** Raw file content, imported at build time via `?raw`. */
	raw: string;
}

// ── Registry ────────────────────────────────────────────────────

/**
 * The example profiles offered in the UI. Every flavor has both the
 * Big Bang Theory (approachable) and SRAP (realistic) profiles. Add an
 * entry (plus its `?raw` import above) to ship another example — the
 * dialog cards and dashboard quick buttons are generated from this list,
 * so no UI changes are needed.
 */
export const EXAMPLES: ProfileExample[] = [
	{
		id: 'tbbt-simpledsp',
		flavor: 'simpledsp',
		title: 'Big Bang Theory characters',
		shortLabel: 'Big Bang Theory',
		description: 'Character profile with cross-references between people.',
		fileName: 'tbbt-simpledsp.tsv',
		raw: tbbtSimpledsp,
	},
	{
		id: 'srap-simpledsp',
		flavor: 'simpledsp',
		title: 'SRAP — Scholarly Resource AP',
		shortLabel: 'SRAP profile',
		description: 'Seven blocks, COAR vocabularies, multi-block references.',
		fileName: 'srap-simpledsp.tsv',
		raw: srapSimpledsp,
	},
	{
		id: 'tbbt-dctap',
		flavor: 'dctap',
		title: 'Big Bang Theory characters',
		shortLabel: 'Big Bang Theory',
		description: 'Character shapes with cross-references between people.',
		fileName: 'tbbt-dctap.csv',
		raw: tbbtDctap,
	},
	{
		id: 'srap-dctap',
		flavor: 'dctap',
		title: 'SRAP — Scholarly Resource AP',
		shortLabel: 'SRAP profile',
		description: 'Seven shapes, COAR vocabularies, multi-shape references.',
		fileName: 'srap-april-model.csv',
		raw: srapAprilModel,
	},
];

// ── Helpers ─────────────────────────────────────────────────────

/**
 * Looks up an example by id.
 *
 * @param id - The example id (e.g. `'tbbt-simpledsp'`).
 * @returns The matching example, or `undefined` if none.
 *
 * @example
 * const ex = getExample('srap-dctap');
 */
export function getExample(id: ExampleId): ProfileExample | undefined {
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
 * const ex = getExample('tbbt-simpledsp');
 * if (ex) await processImportedFile(exampleToFile(ex));
 */
export function exampleToFile(ex: ProfileExample): File {
	return new File([ex.raw], ex.fileName, { type: 'text/plain' });
}
