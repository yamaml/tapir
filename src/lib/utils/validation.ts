/**
 * @fileoverview Profile validation rule catalogue.
 *
 * The catalogue mirrors the rules the YAMA command-line toolkit checks
 * and is grouped into five categories:
 *
 *   1. **File-structure rules** — the project has at least one description;
 *      SimpleDSP projects open with a `MAIN` block; description names are
 *      unique and non-empty.
 *   2. **Namespace rules** — prefixes used in property IDs, datatypes,
 *      target classes, class constraints, and inScheme resolve to either
 *      the project's declared namespaces or a standard prefix.
 *   3. **ID-statement rules** — SimpleDSP descriptions with an `idPrefix`
 *      must reference a declared namespace; when an `idPrefix` is present
 *      the description should also have a `targetClass`.
 *   4. **Statement-level rules** — cardinality coherence (`min <= max`),
 *      shape references resolve to an existing description, and value-type
 *      consistency (literal statements should not carry a shape reference;
 *      IRI statements should not carry a datatype).
 *   5. **DCTAP-specific rules** — DCTAP shapes with a `propertyID` must
 *      carry a `valueNodeType` when a constraint is present; the
 *      `valueShape` reference must match another shape.
 *
 * @module utils/validation
 */

import type { TapirProject, Description, Statement, Flavor } from '$lib/types';
import type { ParseMessage } from '$lib/types/export';
import { getFlavorLabels } from '$lib/types';
import { STANDARD_PREFIXES } from '$lib/converters/simpledsp-generator';
import { validateStatementVocab, type VocabLookup } from './vocab-validation';

// ── Types ───────────────────────────────────────────────────────

/** Validation result with categorized issues. */
export interface ValidationResult {
	errors: ParseMessage[];
	warnings: ParseMessage[];
}

// ── Helpers ─────────────────────────────────────────────────────

/**
 * Extracts the prefix from a prefixed term (e.g. "foaf:name" → "foaf").
 * Returns null if the term is not prefixed.
 */
function extractPrefix(term: string): string | null {
	if (!term) return null;
	if (/^(https?|urn):/.test(term)) return null;
	const colon = term.indexOf(':');
	if (colon > 0) return term.substring(0, colon);
	return null;
}

/** Checks whether a prefix is known (standard or declared). */
function isPrefixKnown(prefix: string, namespaces: Record<string, string>): boolean {
	return prefix in namespaces || prefix in STANDARD_PREFIXES;
}

/** Splits a possibly space-separated token list (datatype, classConstraint, etc.). */
function splitTokens(value: string): string[] {
	return value.split(/\s+/).filter(Boolean);
}

// ── Field-level Validation ───────────────────────────────────────

/** Context needed for field-level validation. */
export interface FieldValidationContext {
	namespaces: Record<string, string>;
	descriptionNames: string[];
	peerValue?: string;
	/** Flavor for terminology-aware messages. Defaults to simpledsp. */
	flavor?: Flavor;
}

/** Fields that support inline validation. */
export type ValidatableField =
	| 'property'
	| 'datatype'
	| 'targetClass'
	| 'idPrefix'
	| 'min'
	| 'max'
	| 'shapeRef';

/**
 * Validates a single field value and returns an error message (or null).
 *
 * Used for on-blur validation in the editor to give immediate feedback.
 *
 * @param field - Which field type is being validated.
 * @param value - The current value of the field.
 * @param ctx - Validation context (namespaces, description names, peer value).
 * @returns Error message string, or null if valid.
 */
export function validateField(
	field: ValidatableField,
	value: string,
	ctx: FieldValidationContext
): string | null {
	if (!value) return null;
	const allNs = { ...STANDARD_PREFIXES, ...ctx.namespaces };

	switch (field) {
		case 'property':
		case 'datatype':
		case 'targetClass': {
			const prefix = extractPrefix(value);
			if (prefix && !isPrefixKnown(prefix, ctx.namespaces)) {
				return `Unknown prefix "${prefix}" — declare it in namespaces`;
			}
			return null;
		}
		case 'idPrefix': {
			if (value && !allNs[value]) {
				return `Prefix "${value}" is not declared in namespaces`;
			}
			return null;
		}
		case 'min': {
			if (ctx.peerValue) {
				const min = parseInt(value, 10);
				const max = parseInt(ctx.peerValue, 10);
				if (!isNaN(min) && !isNaN(max) && min > max) return `Min (${min}) exceeds max (${max})`;
			}
			return null;
		}
		case 'max': {
			if (ctx.peerValue) {
				const min = parseInt(ctx.peerValue, 10);
				const max = parseInt(value, 10);
				if (!isNaN(min) && !isNaN(max) && min > max) return `Min (${min}) exceeds max (${max})`;
			}
			return null;
		}
		case 'shapeRef': {
			if (value && !ctx.descriptionNames.includes(value)) {
				const term = getFlavorLabels(ctx.flavor ?? 'simpledsp').descriptionSingular.toLowerCase();
				return `References undefined ${term} "${value}"`;
			}
			return null;
		}
		default:
			return null;
	}
}

// ── Statement-level rules (2, 4, 5) ─────────────────────────────

/**
 * Validates a single statement against namespace, cardinality,
 * shape-reference, value-type, and DCTAP-specific rules.
 *
 * @param stmt - The statement to validate.
 * @param descName - Parent description name (for error context).
 * @param namespaces - Known namespace map.
 * @param descriptionNames - All description names (for shape-ref validation).
 * @param flavor - Profile flavor (selects DCTAP rules + label terminology).
 * @returns Validation result.
 */
export function validateStatement(
	stmt: Statement,
	descName: string,
	namespaces: Record<string, string>,
	descriptionNames: Set<string>,
	flavor: Flavor = 'simpledsp',
	vocabContext?: { desc: Description; vocabs: VocabLookup }
): ValidationResult {
	const errors: ParseMessage[] = [];
	const warnings: ParseMessage[] = [];
	const labels = getFlavorLabels(flavor);
	const stmtTerm = labels.statementSingular;
	const descTerm = labels.descriptionSingular.toLowerCase();
	const fieldKey = `${descName}.${stmt.label || stmt.propertyId || '(unnamed)'}`;

	// 2. Namespace rules: propertyId, datatype, classConstraint, inScheme
	if (!stmt.propertyId) {
		warnings.push({ field: fieldKey, message: `${stmtTerm} has no property ID` });
	} else {
		const prefix = extractPrefix(stmt.propertyId);
		if (prefix && !isPrefixKnown(prefix, namespaces)) {
			errors.push({
				field: fieldKey,
				message: `Unknown prefix "${prefix}" in property "${stmt.propertyId}"`,
			});
		}
	}

	if (stmt.datatype) {
		for (const dt of splitTokens(stmt.datatype)) {
			const prefix = extractPrefix(dt);
			if (prefix && !isPrefixKnown(prefix, namespaces)) {
				errors.push({
					field: fieldKey,
					message: `Unknown prefix "${prefix}" in datatype "${dt}"`,
				});
			}
		}
	}

	for (const cls of stmt.classConstraint ?? []) {
		const prefix = extractPrefix(cls);
		if (prefix && !isPrefixKnown(prefix, namespaces)) {
			errors.push({
				field: fieldKey,
				message: `Unknown prefix "${prefix}" in class constraint "${cls}"`,
			});
		}
	}

	for (const scheme of stmt.inScheme ?? []) {
		const prefix = extractPrefix(scheme);
		if (prefix && !isPrefixKnown(prefix, namespaces)) {
			errors.push({
				field: fieldKey,
				message: `Unknown prefix "${prefix}" in inScheme "${scheme}"`,
			});
		}
	}

	// 4. Cardinality coherence
	if (stmt.min != null && stmt.max != null && stmt.min > stmt.max) {
		errors.push({
			field: fieldKey,
			message: `Invalid cardinality: min (${stmt.min}) > max (${stmt.max})`,
		});
	}
	if (stmt.min != null && stmt.min < 0) {
		errors.push({ field: fieldKey, message: `Min must be >= 0 (got ${stmt.min})` });
	}
	if (stmt.max != null && stmt.max < 0) {
		errors.push({ field: fieldKey, message: `Max must be >= 0 (got ${stmt.max})` });
	}

	// 4. Shape references resolve (each ref in the list must resolve)
	const shapeRefs = stmt.shapeRefs ?? [];
	for (const ref of shapeRefs) {
		if (!descriptionNames.has(ref)) {
			errors.push({
				field: fieldKey,
				message: `Reference "${ref}" does not match any ${descTerm}`,
			});
		}
	}
	const hasAnyShapeRef = shapeRefs.length > 0;

	// 4. Value-type consistency
	if (stmt.valueType === 'literal' && hasAnyShapeRef) {
		warnings.push({
			field: fieldKey,
			message: `Literal ${stmtTerm.toLowerCase()} should not carry a ${descTerm} reference`,
		});
	}
	if (stmt.valueType === 'iri' && stmt.datatype) {
		warnings.push({
			field: fieldKey,
			message: `IRI ${stmtTerm.toLowerCase()} should not carry a datatype`,
		});
	}
	if (hasAnyShapeRef && stmt.classConstraint && stmt.classConstraint.length > 0) {
		warnings.push({
			field: fieldKey,
			message: `${stmtTerm} has both a ${descTerm} reference and a class constraint`,
		});
	}

	// 5. DCTAP-specific rules
	if (flavor === 'dctap') {
		const hasConstraint =
			!!stmt.datatype ||
			hasAnyShapeRef ||
			(stmt.values && stmt.values.length > 0) ||
			(stmt.classConstraint && stmt.classConstraint.length > 0);
		if (hasConstraint && !stmt.valueType) {
			warnings.push({
				field: fieldKey,
				message: `DCTAP statement with a constraint should declare a valueNodeType`,
			});
		}
	}

	// 6. Tier-2 vocabulary-aware checks. Opt-in: silently skipped
	// unless the caller supplies a `vocabs` lookup. Each individual
	// check inside also short-circuits on missing vocab data, so an
	// unknown property or unrecognised range/domain produces zero
	// warnings (rather than false positives).
	if (vocabContext) {
		warnings.push(
			...validateStatementVocab(stmt, vocabContext.desc, fieldKey, vocabContext.vocabs),
		);
	}

	return { errors, warnings };
}

// ── Project-level validation (covers 1, 2, 3, + delegates 4, 5) ─

/**
 * Validates a complete project against every rule category in the
 * catalogue.
 *
 * @param project - The project to validate.
 * @returns Validation result with all errors and warnings.
 *
 * @example
 * const result = validateProject(project);
 * if (result.errors.length > 0) {
 *   console.error('Validation errors:', result.errors);
 * }
 */
export function validateProject(
	project: TapirProject,
	vocabs?: VocabLookup,
): ValidationResult {
	const errors: ParseMessage[] = [];
	const warnings: ParseMessage[] = [];
	const flavor: Flavor = project.flavor ?? 'simpledsp';
	const labels = getFlavorLabels(flavor);
	const descTerm = labels.descriptionSingular;
	const descriptions = project.descriptions ?? [];
	const descriptionNames = new Set(descriptions.map((d) => d.name));

	// 1. File-structure rules
	if (descriptions.length === 0) {
		warnings.push({
			field: '(project)',
			message: `Profile has no ${labels.descriptionPlural.toLowerCase()}`,
		});
	}

	if (flavor === 'simpledsp' && descriptions.length > 0 && descriptions[0].name !== 'MAIN') {
		errors.push({
			field: descriptions[0].name || '(first)',
			message: `SimpleDSP profile must open with a [MAIN] block (first ${descTerm.toLowerCase()} is "${descriptions[0].name}")`,
		});
	}

	const namesSeen = new Set<string>();
	for (const desc of descriptions) {
		if (!desc.name) {
			errors.push({ field: '(unnamed)', message: `${descTerm} has no name` });
			continue;
		}
		if (namesSeen.has(desc.name)) {
			errors.push({
				field: desc.name,
				message: `Duplicate ${descTerm.toLowerCase()} name "${desc.name}"`,
			});
		}
		namesSeen.add(desc.name);
	}

	// Per-description validation
	for (const desc of descriptions) {
		// 1. File-structure: empty descriptions
		if (desc.statements.length === 0) {
			warnings.push({
				field: desc.name,
				message: `${descTerm} "${desc.name}" has no statements`,
			});
		}

		// 2. Namespace rules on targetClass (SimpleDSP only — DCTAP shapes
		// don't have a targetClass in the spec).
		if (flavor === 'simpledsp' && desc.targetClass) {
			const prefix = extractPrefix(desc.targetClass);
			if (prefix && !isPrefixKnown(prefix, project.namespaces)) {
				errors.push({
					field: desc.name,
					message: `Unknown prefix "${prefix}" in target class "${desc.targetClass}"`,
				});
			}
		}

		// 3. ID-statement rules (SimpleDSP)
		if (flavor === 'simpledsp' && desc.idPrefix) {
			const allNs = { ...STANDARD_PREFIXES, ...project.namespaces };
			if (!allNs[desc.idPrefix]) {
				errors.push({
					field: desc.name,
					message: `ID prefix "${desc.idPrefix}" is not declared in namespaces`,
				});
			}
			if (!desc.targetClass) {
				warnings.push({
					field: desc.name,
					message: `${descTerm} "${desc.name}" declares an ID prefix but has no target class`,
				});
			}
		}

		// 4 + 5 + 6. Statement-level + DCTAP rules + (optional) vocab
		// coherence. Tier-2 vocab checks fire only when the caller
		// supplies a vocab lookup; they emit warnings only.
		const vocabContext = vocabs ? { desc, vocabs } : undefined;
		for (const stmt of desc.statements) {
			const result = validateStatement(
				stmt,
				desc.name,
				project.namespaces,
				descriptionNames,
				flavor,
				vocabContext,
			);
			errors.push(...result.errors);
			warnings.push(...result.warnings);
		}
	}

	return { errors, warnings };
}
