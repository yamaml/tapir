/**
 * @fileoverview Core data model types for Tapir.
 *
 * These types define the internal, flavor-neutral representation of
 * application profiles. All editor modes and converters operate on
 * these types.
 *
 * Nomenclature mapping:
 *   - Description = SimpleDSP "Description Template" (dsp:DescriptionTemplate)
 *                 = DCTAP "Shape"
 *   - Statement   = SimpleDSP "Statement Template" (dsp:StatementTemplate)
 *                 = DCTAP "Statement Template"
 *
 * @module types/profile
 */

// ── Interfaces ──────────────────────────────────────────────────

/** A complete application profile project. */
export interface TapirProject {
	id: string;
	name: string;
	/**
	 * Optional one-line description shown on the dashboard card and in
	 * the editor header. Empty string means "no description".
	 */
	description: string;
	flavor: Flavor;
	base: string;
	namespaces: NamespaceMap;
	descriptions: Description[];
	createdAt: string;
	updatedAt: string;
}

/** Supported profile flavors. */
export type Flavor = 'simpledsp' | 'dctap';

/** Prefix-to-URI namespace mapping. */
export type NamespaceMap = Record<string, string>;

/** A description (OWL-DSP: Description Template; DCTAP: Shape). */
export interface Description {
	id: string;
	name: string;
	label: string;
	targetClass: string;
	/** Namespace prefix for record URIs (e.g. "ndlbooks" → records at ndlbooks:{id}). */
	idPrefix: string;
	note: string;
	closed: boolean;
	statements: Statement[];
}

/**
 * A single statement (OWL-DSP: Statement Template; DCTAP: Statement Template).
 *
 * Field mapping:
 *   - `shapeRefs` → YAMAML `statement.description` (scalar-or-list),
 *      DCTAP `valueShape` (space-separated, per SRAP convention)
 *   - `classConstraint` → YAMAML `statement.a` (class constraint)
 */
export interface Statement {
	id: string;
	label: string;
	propertyId: string;
	/**
	 * Minimum cardinality. `undefined` (absent) = unspecified — the
	 * DCTAP `mandatory` cell round-trips as empty. `null` is treated
	 * the same as unspecified (legacy data may contain it).
	 */
	min?: number | null;
	/**
	 * Maximum cardinality. `undefined` (absent) = unspecified (DCTAP
	 * `repeatable` round-trips as empty); `null` = **explicitly
	 * unbounded** (DCTAP `repeatable: TRUE`, SimpleDSP `-`).
	 */
	max?: number | null;
	cardinalityNote: string;
	/**
	 * Value node type(s): how the object of the statement is shaped.
	 *
	 * Multi-valued semantics: when more than one type is present they
	 * represent alternatives (logical OR) — a value may be any of them.
	 * Authored across the ecosystem as:
	 *   - DCTAP: space-separated `valueNodeType` cell, per the DCMI SRAP
	 *     convention (e.g. `IRI BNODE`, `IRI literal`).
	 *   - SimpleDSP: a single display type per row; a multi-type list
	 *     collapses to one type on export (see simpledsp-generator).
	 *   - SHACL: `sh:or` of nested `[sh:nodeKind X]` blank nodes
	 *     (`sh:nodeKind` itself is single-valued).
	 *   - ShEx: a parenthesised node-kind disjunction (`IRI OR LITERAL`).
	 *   - YAMA: a scalar `type` when one, a sequence when many.
	 *
	 * Empty array = unspecified. `structured` is a *display-only* type
	 * derived from `shapeRefs`/`classConstraint`; it is never stored here.
	 */
	valueType: ValueType[];
	/**
	 * Datatype constraint(s) for literal values.
	 *
	 * Multi-valued semantics: when more than one datatype is present,
	 * they represent alternatives (logical OR). Authored across the
	 * ecosystem as:
	 *   - SimpleDSP: space-separated in the Constraint cell, e.g.
	 *     `xsd:decimal xsd:integer` — endorsed by the original 2010
	 *     spec (§4.6, Table 16, literal-constraint row 3).
	 *   - DCTAP: space-separated `valueDataType` cell, per the DCMI
	 *     SRAP convention (e.g. `xsd:gYear xsd:gYearMonth xsd:date`).
	 *   - OWL-DSP: a union of `owl:onDataRange` values.
	 *   - SHACL: `sh:or` of nested `[sh:datatype X]` blank nodes
	 *     (`sh:datatype` itself is single-valued).
	 *   - ShEx: parenthesised `OR` disjunction.
	 *   - Frictionless: only the first is emitted; the rest produce
	 *     an export warning (one type per field).
	 */
	datatype: string[];
	values: string[];
	pattern: string;
	facets: FacetMap;
	inScheme: string[];
	classConstraint: string[];
	constraint: string;
	constraintType: string;
	/**
	 * Reference(s) to description templates. Empty array when none.
	 * DCTAP emits space-separated (SRAP convention, e.g. "Person Organization").
	 * SHACL/ShEx/OWL-DSP emit disjunctions (sh:or, OR, owl:unionOf).
	 * SimpleDSP emits all refs space-separated (`#A #B`) — a Tapir/YAMA
	 * extension of the single-ref 2010 spec; the parser reads both forms.
	 */
	shapeRefs: string[];
	note: string;
}

/** Numeric facet constraints. */
export type FacetMap = Partial<Record<FacetName, number>>;

/** Supported facet names. */
export type FacetName =
	| 'MinInclusive'
	| 'MaxInclusive'
	| 'MinExclusive'
	| 'MaxExclusive'
	| 'MinLength'
	| 'MaxLength'
	| 'Length'
	| 'TotalDigits'
	| 'FractionDigits';

/**
 * Value type classification (flavor-neutral), one member of the
 * `Statement.valueType` list.
 *
 * Display labels differ by flavor:
 *   - `literal` → SimpleDSP: "literal", DCTAP: "literal"
 *   - `iri`     → SimpleDSP: "IRI", DCTAP: "IRI"
 *   - `bnode`   → DCTAP only: "bnode"
 *
 * "Unspecified" is the empty `valueType` array — there is no empty-string
 * member. SimpleDSP `structured` and `id` are resolved at display time
 * from `shapeRef`/`classConstraint` fields, not stored as valueType.
 */
export type ValueType = 'literal' | 'iri' | 'bnode';

/** Metadata for the project index (stored in IndexedDB). */
export interface ProjectMeta {
	id: string;
	name: string;
	/** Optional one-line description for the dashboard card subtitle. */
	description: string;
	flavor: Flavor;
	descriptionCount: number;
	statementCount: number;
	updatedAt: string;
}

/** A point-in-time snapshot of a project. */
export interface ProjectSnapshot {
	id?: number;
	projectId: string;
	label: string;
	timestamp: string;
	data: TapirProject;
	auto: boolean;
}

// ── UUID Helper ─────────────────────────────────────────────────

/** Generates a UUID v4, with fallback for older browsers (Safari <15.4). */
function uuid(): string {
	if (typeof crypto !== 'undefined' && crypto.randomUUID) {
		return crypto.randomUUID();
	}
	// Fallback: manual UUID v4
	return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
		const r = (Math.random() * 16) | 0;
		const v = c === 'x' ? r : (r & 0x3) | 0x8;
		return v.toString(16);
	});
}

// ── Factory Functions ───────────────────────────────────────────

/**
 * Creates a new project with sensible defaults.
 *
 * @param init - Required fields: `name` and `flavor`.
 * @returns A new TapirProject with a generated UUID and timestamps.
 *
 * @example
 * const project = createProject({ name: 'My Profile', flavor: 'simpledsp' });
 */
export function createProject(
	init: Pick<TapirProject, 'name' | 'flavor'> & Partial<TapirProject>
): TapirProject {
	const now = new Date().toISOString();
	return {
		id: uuid(),
		description: '',
		base: '',
		namespaces: {},
		descriptions: [],
		createdAt: now,
		updatedAt: now,
		...init,
	};
}

/**
 * Creates a new description with sensible defaults.
 *
 * @param init - Required field: `name`.
 * @returns A new Description with a generated UUID.
 *
 * @example
 * const desc = createDescription({ name: 'character', targetClass: 'foaf:Person' });
 */
export function createDescription(
	init: Pick<Description, 'name'> & Partial<Description>
): Description {
	return {
		id: uuid(),
		label: '',
		targetClass: '',
		idPrefix: '',
		note: '',
		closed: false,
		statements: [],
		...init,
	};
}

/**
 * Creates a new statement with sensible defaults.
 *
 * @param init - Partial statement fields.
 * @returns A new Statement with a generated UUID and empty defaults.
 *
 * @example
 * const stmt = createStatement({ propertyId: 'foaf:name', valueType: ['literal'] });
 */
export function createStatement(init?: Partial<Statement>): Statement {
	return {
		id: uuid(),
		label: '',
		propertyId: '',
		// min/max stay absent (undefined = unspecified); see Statement.
		cardinalityNote: '',
		valueType: [],
		datatype: [],
		values: [],
		pattern: '',
		facets: {},
		inScheme: [],
		classConstraint: [],
		constraint: '',
		constraintType: '',
		shapeRefs: [],
		note: '',
		...init,
	};
}
