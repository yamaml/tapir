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
 * | Statement.pattern        | String facet (`/pattern/`)            |
 * | Statement.values         | Value set (`["a" "b"]`)               |
 *
 * Ported from yama-cli `src/modules/shex.js`.
 *
 * @module converters/shex-generator
 * @see https://shex.io
 * @see https://shexspec.github.io/primer/
 */

import type { TapirProject, Statement, FacetName } from '$lib/types';

// ── Cardinality Formatting ──────────────────────────────────────

/**
 * Formats a cardinality constraint as ShExC shorthand or `{m,n}` syntax.
 *
 * ShEx cardinality rules:
 *   - `*`     = {0,inf}
 *   - `+`     = {1,inf}
 *   - `?`     = {0,1}
 *   - `{n}`   = exactly n
 *   - `{m,n}` = between m and n
 *   - (omit)  = {1,1} (exactly once)
 *
 * @param min - Minimum cardinality (null = unspecified).
 * @param max - Maximum cardinality (null = unspecified).
 * @returns ShExC cardinality string (may be empty).
 */
export function formatCardinality(
	min: number | null | undefined,
	max: number | null | undefined
): string {
	const hasMin = min != null;
	const hasMax = max != null;

	if (!hasMin && !hasMax) return '';

	const m = hasMin ? min! : 1;
	const n = hasMax ? max! : -1; // -1 = unbounded

	// Shorthands
	if (m === 0 && n === -1) return ' *';
	if (m === 1 && n === -1) return ' +';
	if (m === 0 && n === 1) return ' ?';

	// Exact
	if (hasMin && !hasMax) return ` {${m},}`;
	if (m === n) return ` {${m}}`;

	return ` {${m},${n}}`;
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
 *   - Value set: `["val1" "val2"]`
 *   - Node kind: `IRI`, `LITERAL`, `BNODE`, `NONLITERAL`
 *
 * @param stmt - The statement to format.
 * @returns ShExC node constraint string.
 */
export function formatNodeConstraint(stmt: Statement): string {
	const parts: string[] = [];

	// Shape reference(s) take precedence. Multi-shape becomes a disjunction.
	const refs = stmt.shapeRefs ?? [];
	if (refs.length === 1) {
		parts.push(`@<${refs[0]}>`);
	} else if (refs.length > 1) {
		parts.push(`(${refs.map((r) => `@<${r}>`).join(' OR ')})`);
	} else if (stmt.datatype) {
		// Datatype constraint (already prefixed, e.g. "xsd:string")
		parts.push(stmt.datatype);
	} else if (Array.isArray(stmt.values) && stmt.values.length > 0) {
		// Value set
		const vals = stmt.values.map((v) => `"${v}"`).join(' ');
		parts.push(`[${vals}]`);
	} else {
		// Bare node kind from valueType
		const type = (stmt.valueType || 'literal').toUpperCase();
		parts.push(type);
	}

	// String facet: pattern
	if (stmt.pattern) {
		parts.push(`//${stmt.pattern}//`);
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

// ── Schema Builder ──────────────────────────────────────────────

/**
 * Builds a ShExC schema string from a `TapirProject`.
 *
 * @param project - The Tapir project to export.
 * @returns Complete ShExC schema as a string.
 *
 * @example
 * const shex = buildShExC(project);
 * console.log(shex);
 */
export function buildShExC(project: TapirProject): string {
	const lines: string[] = [];
	const namespaces = project.namespaces || {};
	const base = project.base || '';

	// Header
	lines.push('#');
	lines.push('# Generated with YAMA');
	lines.push('# https://www.yamaml.org');
	lines.push('#');
	lines.push('');

	// PREFIX declarations
	for (const [prefix, uri] of Object.entries(namespaces)) {
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
			tripleConstraints.push(`  a [${desc.targetClass}]`);
		}

		// Statement triple constraints
		for (const stmt of statements) {
			if (!stmt.propertyId) continue;

			const nodeConstraint = formatNodeConstraint(stmt);
			const cardinality = formatCardinality(stmt.min, stmt.max);

			tripleConstraints.push(`  ${stmt.propertyId} ${nodeConstraint}${cardinality}`);
		}

		// Join with semicolons (ShEx TripleExpression separator)
		lines.push(tripleConstraints.join(' ;\n'));

		lines.push('}');
	}

	lines.push('');
	return lines.join('\n');
}
