/**
 * @fileoverview Centralised editor UI strings per flavor + language.
 *
 * Complements the label maps in `flavor.ts` with the longer UI copy
 * that previously lived inline in components: column help, empty
 * states, the Assistance toggle, constraint-popover headings, badges,
 * and the delete-description dialog. Centralising them here keeps the
 * SimpleDSP no-mixing rule auditable: when the flavor is SimpleDSP and
 * the language is Japanese, every string below is Japanese; English
 * mode and DCTAP are exactly the strings the components used before.
 *
 * @module types/editor-strings
 */

import type { Flavor } from './profile';
import type { SimpleDspLang } from './flavor';

// ── Interfaces ──────────────────────────────────────────────────

/** Help text for the smart-table column headers (SimpleDSP set). */
export interface ColumnHelp {
	name: string;
	property: string;
	min: string;
	max: string;
	valueType: string;
	constraint: string;
	note: string;
}

/** Editor UI copy for a flavor + language combination. */
export interface EditorStrings {
	/** Cardinality badge on statement cards. */
	required: string;
	optional: string;
	/** Smart-table assistance toggle row. */
	assistance: string;
	assistanceHint: string;
	/** Empty states. */
	noStatementsYet: string;
	noDescriptionsYet: string;
	addFirstDescriptionHint: string;
	selectDescriptionHint: string;
	sidebarNoMatches: string;
	/** Sidebar "Add" action label. */
	addButton: string;
	/** Shape/description-reference labels (never "shape" for SimpleDSP). */
	shapeReferenceLabel: string;
	shapeReferencesHeading: string;
	/** Constraint-popover headings and actions. */
	datatypeHeading: string;
	picklistHeading: string;
	vocabStemHeading: string;
	uriListHeading: string;
	setValueTypeFirst: string;
	clearConstraint: string;
	setButton: string;
	/** Delete-description confirmation dialog. */
	deleteTooltip: string;
	deleteDialogTitle: string;
	deleteDialogBody: (name: string, statementCount: number) => string;
	deleteConfirm: string;
	cancel: string;
	/** Smart-table column header help. */
	columnHelp: ColumnHelp;
}

// ── SimpleDSP English ───────────────────────────────────────────

const SIMPLEDSP_EN_STRINGS: EditorStrings = {
	required: 'required',
	optional: 'optional',
	assistance: 'Assistance',
	assistanceHint: 'Auto-suggestions · vocabulary lookup · constraint validation',
	noStatementsYet: 'No statement templates yet. Click the + row above to add one.',
	noDescriptionsYet: 'No description templates yet',
	addFirstDescriptionHint:
		'Click "Add" in the sidebar to create your first description template',
	selectDescriptionHint: 'Select a description template from the sidebar',
	sidebarNoMatches: 'No matches',
	addButton: 'Add',
	shapeReferenceLabel: 'Description template reference',
	shapeReferencesHeading: 'Description template references (click to toggle)',
	datatypeHeading: 'Datatype',
	picklistHeading: 'Picklist / custom datatype',
	vocabStemHeading: 'Vocabulary stem',
	uriListHeading: 'URI list',
	setValueTypeFirst: 'Set a ValueType first to configure constraints.',
	clearConstraint: 'Clear constraint',
	setButton: 'Set',
	deleteTooltip: 'Delete description template',
	deleteDialogTitle: 'Delete description template?',
	deleteDialogBody: (name, n) =>
		`This will remove "${name}" and its ${n} statement template${n === 1 ? '' : 's'} from the profile. You can undo this with Ctrl+Z while the editor is open.`,
	deleteConfirm: 'Delete',
	cancel: 'Cancel',
	columnHelp: {
		name: 'Name for this statement template. Required — used to build the statement URI.',
		property:
			'The RDF property this statement constrains, written as a prefixed term (e.g. dcterms:title).',
		min: 'Minimum cardinality. 0 = optional, 1 = required, n = at least n values.',
		max: 'Maximum cardinality. 1 = at most one, n = up to n, dash (-) = unbounded.',
		valueType:
			'Is the value a literal (text/number/date), a reference (IRI), or a structured record? Determines how the Constraint cell is interpreted.',
		constraint:
			'Additional restriction. Interpretation depends on ValueType: datatype for literal, #blockId or class for structured, vocabulary prefix or URI list for reference.',
		note: 'Free-text comment about this statement template.',
	},
};

// ── SimpleDSP Japanese ──────────────────────────────────────────

const SIMPLEDSP_JP_STRINGS: EditorStrings = {
	required: '必須',
	optional: '任意',
	assistance: '入力支援',
	assistanceHint: '自動補完 · 語彙検索 · 制約検証',
	noStatementsYet: 'まだ項目記述規則がありません。上の + 行をクリックして追加してください。',
	noDescriptionsYet: 'まだレコード記述規則がありません',
	addFirstDescriptionHint:
		'サイドバーの「追加」をクリックして最初のレコード記述規則を作成してください',
	selectDescriptionHint: 'サイドバーからレコード記述規則を選択してください',
	sidebarNoMatches: '一致なし',
	addButton: '追加',
	shapeReferenceLabel: '参照先レコード記述規則',
	shapeReferencesHeading: '参照先レコード記述規則(クリックで切替)',
	datatypeHeading: 'データ型',
	picklistHeading: '値リスト / カスタムデータ型',
	vocabStemHeading: '語彙ステム',
	uriListHeading: 'URIリスト',
	setValueTypeFirst: '先に値タイプを設定してください。',
	clearConstraint: '制約をクリア',
	setButton: '設定',
	deleteTooltip: 'レコード記述規則を削除',
	deleteDialogTitle: 'レコード記述規則を削除しますか?',
	deleteDialogBody: (name, n) =>
		`「${name}」とその項目記述規則 ${n} 件をプロファイルから削除します。エディタを開いている間は Ctrl+Z で取り消せます。`,
	deleteConfirm: '削除',
	cancel: 'キャンセル',
	columnHelp: {
		name: 'この項目記述規則の名前。必須 — 記述規則URIの生成に使われます。',
		property:
			'この項目が制約するRDFプロパティ。接頭辞付きの形式で記述します(例: dcterms:title)。',
		min: '最小出現数。0 = 任意、1 = 必須、n = n個以上。',
		max: '最大出現数。1 = 最大1個、n = 最大n個、ハイフン(-) = 無制限。',
		valueType:
			'値のタイプ: 文字列(テキスト・数値・日付)、参照値(IRI)、構造化のいずれか。値制約欄の解釈を決定します。',
		constraint:
			'値への追加制約。値タイプにより解釈が変わります: 文字列はデータ型、構造化は#ブロックIDまたはクラス、参照値は語彙接頭辞またはURIリスト。',
		note: 'この項目記述規則に関する自由記述のコメント。',
	},
};

// ── DCTAP ───────────────────────────────────────────────────────

const DCTAP_STRINGS: EditorStrings = {
	...SIMPLEDSP_EN_STRINGS,
	noStatementsYet: 'No statements yet. Click the + row above to add one.',
	noDescriptionsYet: 'No shapes yet',
	addFirstDescriptionHint: 'Click "Add" in the sidebar to create your first shape',
	selectDescriptionHint: 'Select a shape from the sidebar',
	shapeReferenceLabel: 'Shape reference',
	shapeReferencesHeading: 'Shape references (click to toggle)',
	deleteTooltip: 'Delete shape',
	deleteDialogTitle: 'Delete shape?',
	deleteDialogBody: (name, n) =>
		`This will remove "${name}" and its ${n} statement${n === 1 ? '' : 's'} from the profile. You can undo this with Ctrl+Z while the editor is open.`,
};

// ── Resolver ────────────────────────────────────────────────────

/**
 * Returns the editor UI strings for a flavor + language combination.
 *
 * @param flavor - The profile flavor.
 * @param lang - Language for SimpleDSP (ignored for DCTAP).
 * @returns The matching EditorStrings set.
 *
 * @example
 * const ui = getEditorStrings('simpledsp', 'jp');
 * console.log(ui.required); // "必須"
 */
export function getEditorStrings(
	flavor: Flavor,
	lang: SimpleDspLang = 'en'
): EditorStrings {
	if (flavor === 'dctap') return DCTAP_STRINGS;
	return lang === 'jp' ? SIMPLEDSP_JP_STRINGS : SIMPLEDSP_EN_STRINGS;
}
