/**
 * @fileoverview ShEx (Shape Expressions) generator.
 *
 * Builds a ShExC (ShEx Compact Syntax) schema from a `TapirProject`.
 * Produces plain text output (no RDF library needed).
 *
 * YAMA-to-ShEx mapping:
 *
 * | Tapir element            | ShExC output                          |
 * |--------------------------|---------------------------------------|
 * | Description              | Shape (`<name> { ... }`)              |
 * | Description.targetClass  | `EXTRA a` + `a [class]` constraint    |
 * | Statement                | TripleConstraint                      |
 * | Statement.propertyId     | Predicate                             |
 * | Statement.valueType iri  | `IRI` node constraint                 |
 * | Statement.valueType lit  | `LITERAL` node constraint             |
 * | Statement.valueType bnode| `BNODE` node constraint               |
 * | Statement.datatype       | Datatype constraint (e.g. `xsd:string`)|
 * | Statement.min / max      | Cardinality (`*`, `+`, `?`, `{m,n}`) |
 * | Statement.shapeRefs (single) | Shape reference (`@<shape>`)          |
 * | Statement.shapeRefs (many)   | Disjunction (`(@<A> OR @<B>)`)        |
 * | Statement.facets         | Numeric facets (`MinInclusive`, etc.) |
 * | Statement.pattern        | String facet (`/pattern/`, `/` escaped)|
 * | Statement.values (literal)| Value set (`["a" "b"]`)              |
 * | Statement.values (iri)   | Value set of IRIs (`[ex:a <http://…>]`)|
 *
 * Every prefix used in the output gets a `PREFIX` declaration —
 * prefixed names without declarations are not lexable ShExC. CURIEs
 * resolve against the project's namespaces with the standard prefix
 * table (SimpleDSP §7) as a fallback.
 *
 * Ported from yama-cli `src/modules/shex.js`.
 *
 * @module converters/shex-generator
 * @see https://shex.io
 * @see https://shexspec.github.io/primer/
 */

import type { TapirProject, Statement, FacetName, NamespaceMap } from '$lib/types';
import type { GeneratorWarning } from '$lib/types/export';
import { buildResolutionMap, warnIfIllegalIriName } from './prefix-utils';

// ── Cardinality Formatting ──────────────────────────────────────

/**
 * Formats a cardinality constraint as ShExC shorthand or `{m,n}` syntax.
 *
 * YAMAML semantics: an absent bound means **no constraint** — absent
 * min is 0, absent max is unbounded. (In raw ShExC, omitting the
 * cardinality means exactly-one, so unconstrained statements must
 * emit an explicit `*`.)
 *
 *   - (0, ∞) → ` *`
 *   - (1, ∞) → ` +`
 *   - (0, 1) → ` ?`
 *   - (1, 1) → `` (ShEx default: exactly one)
 *   - (m, ∞) → ` {m,}`
 *   - (m, m) → ` {m}`
 *   - (m, n) → ` {m,n}`
 *
 * @param min - Minimum cardinality (null/undefined = unspecified → 0).
 * @param max - Maximum cardinality (null/undefined = unbounded).
 * @returns ShExC cardinality string (may be empty for exactly-one).
 */
export function formatCardinality(
	min: number | null | undefined,
	max: number | null | undefined
): string {
	const m = min ?? 0;
	const unbounded = max == null;

	if (unbounded) {
		if (m === 0) return ' *';
		if (m === 1) return ' +';
		return ` {${m},}`;
	}
	if (m === 0 && max === 1) return ' ?';
	if (m === 1 && max === 1) return '';
	if (m === max) return ` {${m}}`;
	return ` {${m},${max}}`;
}

// ── Token Helpers ───────────────────────────────────────────────

/** True when the term is a full IRI rather than a CURIE/local name. */
function isFullIri(term: string): boolean {
	return /^(https?|urn):/.test(term);
}

/**
 * Formats an IRI-position term for ShExC: full IRIs get angle
 * brackets, CURIEs stay as prefixed names (their prefixes are
 * declared by `buildShExC`).
 */
function formatIriToken(term: string): string {
	return isFullIri(term) ? `<${term}>` : term;
}

/** Escapes a string-literal member of a value set (`\` and `"`). */
function escapeLiteral(value: string): string {
	return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// ── Node Constraint Formatting ──────────────────────────────────

/** Facet names recognized by ShEx. */
const FACET_NAMES: FacetName[] = [
	'MinInclusive',
	'MaxInclusive',
	'MinExclusive',
	'MaxExclusive',
	'TotalDigits',
	'FractionDigits',
	'MinLength',
	'MaxLength',
	'Length',
];

/**
 * Formats the node constraint part of a triple constraint.
 *
 * Handles the mutual exclusivity between datatype, shape reference,
 * value set, and bare node kind constraints per ShEx grammar:
 *   - Datatype: `xsd:string`
 *   - Shape ref: `@<shapeName>`
 *   - Value set: `["val1" "val2"]` (literals escaped) or IRI members
 *   - Node kind: `IRI`, `LITERAL`, `BNODE`, `NONLITERAL`
 *
 * The pattern facet emits as a single-slash REGEXP token
 * (`/pattern/`) with literal `/` escaped as `\/` — `//pattern//`
 * cannot lex.
 *
 * @param stmt - The statement to format.
 * @returns ShExC node constraint string.
 */
export function formatNodeConstraint(stmt: Statement): string {
	const parts: string[] = [];

	// Shape reference(s) take precedence. Multi-shape becomes a disjunction.
	const refs = stmt.shapeRefs ?? [];
	const dts = stmt.datatype ?? [];
	if (refs.length === 1) {
		parts.push(`@<${refs[0]}>`);
	} else if (refs.length > 1) {
		parts.push(`(${refs.map((r) => `@<${r}>`).join(' OR ')})`);
	} else if (dts.length === 1) {
		// Datatype constraint (already prefixed, e.g. "xsd:string")
		parts.push(formatIriToken(dts[0]));
	} else if (dts.length > 1) {
		// Multi-datatype → ShEx node-constraint disjunction.
		parts.push(`(${dts.map(formatIriToken).join(' OR ')})`);
	} else if (Array.isArray(stmt.values) && stmt.values.length > 0) {
		// Value set. IRI-typed members are IRI terms (an IRI node can
		// never equal a string literal); literal members are escaped
		// string literals.
		const vals =
			stmt.valueType === 'iri'
				? stmt.values.map((v) => formatIriToken(String(v))).join(' ')
				: stmt.values.map((v) => `"${escapeLiteral(String(v))}"`).join(' ');
		parts.push(`[${vals}]`);
	} else {
		// Bare node kind from valueType
		const type = (stmt.valueType || 'literal').toUpperCase();
		parts.push(type);
	}

	// String facet: pattern — `/…/` REGEXP token, `/` escaped as `\/`.
	if (stmt.pattern) {
		parts.push(`/${stmt.pattern.replace(/\//g, '\\/')}/`);
	}

	// Numeric facets
	if (stmt.facets) {
		for (const name of FACET_NAMES) {
			if (stmt.facets[name] != null) {
				parts.push(`${name} ${stmt.facets[name]}`);
			}
		}
	}

	return parts.join(' ');
}

// ── Used-Prefix Collection ──────────────────────────────────────

/**
 * Collects the prefixes of every CURIE the schema will print, so each
 * can receive a `PREFIX` declaration.
 */
function collectCuriePrefixes(project: TapirProject): Set<string> {
	const prefixes = new Set<string>();
	const add = (term: string | undefined) => {
		if (!term || isFullIri(term)) return;
		const colon = term.indexOf(':');
		if (colon > 0) prefixes.add(term.slice(0, colon));
	};

	for (const desc of project.descriptions || []) {
		add(desc.targetClass);
		for (const stmt of desc.statements || []) {
			if (!stmt.propertyId) continue;
			add(stmt.propertyId);
			for (const dt of stmt.datatype ?? []) add(dt);
			if (
				stmt.valueType === 'iri' &&
				(stmt.shapeRefs ?? []).length === 0 &&
				(stmt.datatype ?? []).length === 0
			) {
				for (const v of stmt.values ?? []) add(String(v));
			}
		}
	}
	return prefixes;
}

// ── Schema Builder ──────────────────────────────────────────────

/**
 * Builds a ShExC schema string from a `TapirProject`.
 *
 * @param project - The Tapir project to export.
 * @param warnings - Optional accumulator for lossy-mapping warnings.
 * @returns Complete ShExC schema as a string.
 *
 * @example
 * const shex = buildShExC(project);
 * console.log(shex);
 */
export function buildShExC(project: TapirProject, warnings?: GeneratorWarning[]): string {
	const lines: string[] = [];
	const declared = project.namespaces || {};
	const resolution = buildResolutionMap(project);
	const base = project.base || '';

	// Header
	lines.push('#');
	lines.push('# Generated with YAMA');
	lines.push('# https://www.yamaml.org');
	lines.push('#');
	lines.push('');

	// PREFIX declarations: everything the project declares, plus
	// standard-table fallbacks for prefixes the schema actually uses.
	// A prefixed name without a declaration is invalid ShExC.
	const emit: NamespaceMap = { ...declared };
	for (const prefix of collectCuriePrefixes(project)) {
		if (emit[prefix]) continue;
		if (resolution[prefix]) {
			emit[prefix] = resolution[prefix];
		} else {
			warnings?.push({
				message: `Prefix "${prefix}" is not declared in the project and is not a standard prefix — the ShEx output will not parse until it is declared`,
			});
		}
	}
	for (const [prefix, uri] of Object.entries(emit)) {
		lines.push(`PREFIX ${prefix}: <${uri}>`);
	}

	// BASE declaration
	if (base) {
		lines.push(`BASE <${base}>`);
	}

	// Shape definitions
	const descriptions = project.descriptions || [];

	for (const desc of descriptions) {
		lines.push('');
		warnIfIllegalIriName(desc.name, warnings);

		const statements = desc.statements || [];
		const hasType = !!desc.targetClass;

		// Shape header with optional EXTRA a
		if (hasType) {
			lines.push(`<${desc.name}> EXTRA a {`);
		} else {
			lines.push(`<${desc.name}> {`);
		}

		// Triple constraints
		const tripleConstraints: string[] = [];

		// rdf:type constraint from targetClass
		if (hasType) {
			tripleConstraints.push(`  a [${formatIriToken(desc.targetClass)}]`);
		}

		// Statement triple constraints
		for (const stmt of statements) {
			if (!stmt.propertyId) continue;

			const nodeConstraint = formatNodeConstraint(stmt);
			const cardinality = formatCardinality(stmt.min, stmt.max);

			tripleConstraints.push(
				`  ${formatIriToken(stmt.propertyId)} ${nodeConstraint}${cardinality}`
			);
		}

		// Join with semicolons (ShEx TripleExpression separator)
		lines.push(tripleConstraints.join(' ;\n'));

		lines.push('}');
	}

	lines.push('');
	return lines.join('\n');
}
