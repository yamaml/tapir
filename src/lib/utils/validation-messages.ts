/**
 * @fileoverview Validation message catalogue (English + Japanese).
 *
 * The validator (`utils/validation.ts`) builds its messages through
 * this catalogue so the SimpleDSP JP mode can show fully Japanese
 * validation output (no-mixing rule). The English variants reproduce
 * the historical strings byte-for-byte — downstream consumers
 * pattern-match on them (import-handler demotes `Unknown prefix …`
 * errors; the validation panel's tooltips match message prefixes).
 *
 * @module utils/validation-messages
 */

import type { SimpleDspLang } from '$lib/types';

// ── Types ───────────────────────────────────────────────────────

/** Term context: which field carried the unknown prefix. */
export type PrefixedFieldKind =
	| 'property'
	| 'datatype'
	| 'class constraint'
	| 'inScheme'
	| 'target class';

/** Message builders for every validation rule. */
export interface ValidationMessages {
	noPropertyId(stmtTerm: string): string;
	unknownPrefix(kind: PrefixedFieldKind, prefix: string, value: string): string;
	invalidCardinality(min: number, max: number): string;
	minNegative(min: number): string;
	maxNegative(max: number): string;
	unresolvedRef(ref: string, descTerm: string): string;
	literalWithRef(stmtTerm: string, descTerm: string): string;
	iriWithDatatype(stmtTerm: string): string;
	refAndClass(stmtTerm: string, descTerm: string): string;
	dctapConstraintNeedsNodeType(): string;
	profileEmpty(descPlural: string): string;
	mainFirst(descTerm: string, firstName: string): string;
	descNoName(descTerm: string): string;
	duplicateDescName(descTerm: string, name: string): string;
	descNoStatements(descTerm: string, name: string): string;
	idPrefixUndeclared(prefix: string): string;
	idPrefixNoTargetClass(descTerm: string, name: string): string;
}

// ── English (historical strings, verbatim) ──────────────────────

const EN: ValidationMessages = {
	noPropertyId: (stmtTerm) => `${stmtTerm} has no property ID`,
	unknownPrefix: (kind, prefix, value) =>
		`Unknown prefix "${prefix}" in ${kind} "${value}"`,
	invalidCardinality: (min, max) =>
		`Invalid cardinality: min (${min}) > max (${max})`,
	minNegative: (min) => `Min must be >= 0 (got ${min})`,
	maxNegative: (max) => `Max must be >= 0 (got ${max})`,
	unresolvedRef: (ref, descTerm) =>
		`Reference "${ref}" does not match any ${descTerm}`,
	literalWithRef: (stmtTerm, descTerm) =>
		`Literal ${stmtTerm.toLowerCase()} should not carry a ${descTerm} reference`,
	iriWithDatatype: (stmtTerm) =>
		`IRI ${stmtTerm.toLowerCase()} should not carry a datatype`,
	refAndClass: (stmtTerm, descTerm) =>
		`${stmtTerm} has both a ${descTerm} reference and a class constraint`,
	dctapConstraintNeedsNodeType: () =>
		`DCTAP statement with a constraint should declare a valueNodeType`,
	profileEmpty: (descPlural) => `Profile has no ${descPlural}`,
	mainFirst: (descTerm, firstName) =>
		`SimpleDSP profile must open with a [MAIN] block (first ${descTerm} is "${firstName}")`,
	descNoName: (descTerm) => `${descTerm} has no name`,
	duplicateDescName: (descTerm, name) =>
		`Duplicate ${descTerm} name "${name}"`,
	descNoStatements: (descTerm, name) => `${descTerm} "${name}" has no statements`,
	idPrefixUndeclared: (prefix) =>
		`ID prefix "${prefix}" is not declared in namespaces`,
	idPrefixNoTargetClass: (descTerm, name) =>
		`${descTerm} "${name}" declares an ID prefix but has no target class`,
};

// ── Japanese (MIC-J / MetaBridge terminology) ───────────────────

const PREFIX_FIELD_JP: Record<PrefixedFieldKind, string> = {
	property: 'プロパティ',
	datatype: 'データ型',
	'class constraint': 'クラス制約',
	inScheme: 'inScheme',
	'target class': '対象クラス',
};

const JP: ValidationMessages = {
	noPropertyId: () => '項目記述規則にプロパティがありません',
	unknownPrefix: (kind, prefix, value) =>
		`${PREFIX_FIELD_JP[kind]} "${value}" の接頭辞 "${prefix}" が宣言されていません`,
	invalidCardinality: (min, max) =>
		`出現数が不正です: 最小 (${min}) が最大 (${max}) を超えています`,
	minNegative: (min) => `最小出現数は0以上でなければなりません (${min})`,
	maxNegative: (max) => `最大出現数は0以上でなければなりません (${max})`,
	unresolvedRef: (ref) => `参照 "${ref}" に一致するレコード記述規則がありません`,
	literalWithRef: () =>
		'文字列の項目記述規則にレコード記述規則への参照は指定できません',
	iriWithDatatype: () => '参照値の項目記述規則にデータ型は指定できません',
	refAndClass: () =>
		'項目記述規則にレコード記述規則への参照とクラス制約の両方が指定されています',
	// DCTAP-only rule — never reached in SimpleDSP JP mode, but keep a
	// sensible Japanese fallback for completeness.
	dctapConstraintNeedsNodeType: () =>
		'制約を持つDCTAP statementにはvalueNodeTypeを指定してください',
	profileEmpty: () => 'プロファイルにレコード記述規則がありません',
	mainFirst: (_descTerm, firstName) =>
		`SimpleDSPプロファイルは [MAIN] ブロックで始まる必要があります(最初のレコード記述規則は "${firstName}")`,
	descNoName: () => 'レコード記述規則に名前がありません',
	duplicateDescName: (_descTerm, name) =>
		`レコード記述規則名 "${name}" が重複しています`,
	descNoStatements: (_descTerm, name) =>
		`レコード記述規則 "${name}" に項目記述規則がありません`,
	idPrefixUndeclared: (prefix) =>
		`ID接頭辞 "${prefix}" が名前空間で宣言されていません`,
	idPrefixNoTargetClass: (_descTerm, name) =>
		`レコード記述規則 "${name}" にID接頭辞が指定されていますが対象クラスがありません`,
};

// ── Resolver ────────────────────────────────────────────────────

/**
 * Returns the message catalogue for a language.
 *
 * @param lang - `en` (default, historical strings) or `jp`.
 * @returns The matching ValidationMessages implementation.
 */
export function getValidationMessages(lang: SimpleDspLang = 'en'): ValidationMessages {
	return lang === 'jp' ? JP : EN;
}
