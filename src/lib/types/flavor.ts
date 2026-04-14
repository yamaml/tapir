/**
 * @fileoverview Flavor-specific label maps.
 *
 * Each flavor (SimpleDSP, DCTAP) has its own display terminology.
 * English SimpleDSP labels follow the OWL-DSP ontology.
 * Japanese SimpleDSP labels follow the original documentation.
 *
 * @module types/flavor
 */

import type { Flavor } from './profile';

// ── Interfaces ──────────────────────────────────────────────────

/** Column header labels for the table editors. */
export interface ColumnLabels {
	name: string;
	property: string;
	min: string;
	max: string;
	valueType: string;
	constraint: string;
	note: string;
}

/**
 * Display names for value types.
 *
 * Not every flavor uses every value type:
 * - SimpleDSP uses all six; `id` is the ID-row marker, `empty` is
 *   "(no constraint)", `structured` is the SimpleDSP structured-value type.
 * - DCTAP uses only `literal`, `iri`, and `bnode`; the `structured`, `id`,
 *   and `empty` entries are unused. They default to the empty string in
 *   DCTAP_LABELS — never rendered.
 */
export interface ValueTypeLabels {
	literal: string;
	iri: string;
	bnode: string;
	structured: string;
	id: string;
	empty: string;
}

/** Complete label set for a flavor + language combination. */
export interface FlavorLabels {
	descriptionSingular: string;
	descriptionPlural: string;
	statementSingular: string;
	statementPlural: string;
	addDescription: string;
	addStatement: string;
	columns: ColumnLabels;
	valueTypes: ValueTypeLabels;
	specName: string;
	specUrl: string;
}

// ── SimpleDSP Labels ────────────────────────────────────────────

/** SimpleDSP English labels (per OWL-DSP ontology). */
export const SIMPLEDSP_EN: FlavorLabels = {
	descriptionSingular: 'Description Template',
	descriptionPlural: 'Description Templates',
	statementSingular: 'Statement Template',
	statementPlural: 'Statement Templates',
	addDescription: '+ Add Description Template',
	addStatement: '+ Add Statement Template',
	columns: {
		name: 'Name',
		property: 'Property',
		min: 'Min',
		max: 'Max',
		valueType: 'ValueType',
		constraint: 'Constraint',
		note: 'Comment',
	},
	valueTypes: {
		literal: 'literal',
		iri: 'IRI',
		bnode: 'bnode',
		structured: 'structured',
		id: 'ID',
		empty: '(no constraint)',
	},
	specName: 'SimpleDSP',
	specUrl: 'https://purl.org/yama/simpledsp/latest',
};

/** SimpleDSP Japanese labels (per original documentation). */
export const SIMPLEDSP_JP: FlavorLabels = {
	descriptionSingular: 'レコード記述規則',
	descriptionPlural: 'レコード記述規則',
	statementSingular: '項目記述規則',
	statementPlural: '項目記述規則',
	addDescription: '+ レコード記述規則を追加',
	addStatement: '+ 項目記述規則を追加',
	columns: {
		name: '項目規則名',
		property: 'プロパティ',
		min: '最小',
		max: '最大',
		valueType: '値タイプ',
		constraint: '値制約',
		note: 'コメント',
	},
	valueTypes: {
		literal: '文字列',
		iri: '参照値',
		bnode: 'bnode',
		structured: '構造化',
		id: 'ID',
		empty: '制約なし',
	},
	specName: 'SimpleDSP',
	specUrl: 'https://purl.org/yama/simpledsp/latest',
};

// ── DCTAP Labels ────────────────────────────────────────────────

/** DCTAP labels. */
export const DCTAP_LABELS: FlavorLabels = {
	descriptionSingular: 'Shape',
	descriptionPlural: 'Shapes',
	statementSingular: 'Statement',
	statementPlural: 'Statements',
	addDescription: '+ Add Shape',
	addStatement: '+ Add Statement',
	columns: {
		name: 'propertyLabel',
		property: 'propertyID',
		min: 'mandatory',
		max: 'repeatable',
		valueType: 'valueNodeType',
		constraint: 'valueConstraint',
		note: 'note',
	},
	valueTypes: {
		literal: 'literal',
		iri: 'IRI',
		bnode: 'bnode',
		structured: 'IRI',
		id: '',
		empty: '',
	},
	specName: 'DCTAP',
	specUrl: 'https://dcmi.github.io/dctap/',
};

// ── Resolver ────────────────────────────────────────────────────

/** SimpleDSP language options. */
export type SimpleDspLang = 'en' | 'jp';

/**
 * Returns the label set for a given flavor and language.
 *
 * @param flavor - The profile flavor.
 * @param lang - Language for SimpleDSP (ignored for DCTAP).
 * @returns The appropriate FlavorLabels.
 *
 * @example
 * const labels = getFlavorLabels('simpledsp', 'en');
 * console.log(labels.descriptionSingular); // "Description Template"
 */
export function getFlavorLabels(
	flavor: Flavor,
	lang: SimpleDspLang = 'en'
): FlavorLabels {
	if (flavor === 'dctap') return DCTAP_LABELS;
	return lang === 'jp' ? SIMPLEDSP_JP : SIMPLEDSP_EN;
}
