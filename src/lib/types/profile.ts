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
	min: number | null;
	max: number | null;
	cardinalityNote: string;
	valueType: ValueType;
	datatype: string;
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
	 * SimpleDSP's spec allows only one shape per statement — multi-ref
	 * export is lossy (first ref emitted, others dropped with a warning).
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
 * Value type classification (flavor-neutral).
 *
 * Display labels differ by flavor:
 *   - `literal` → SimpleDSP: "literal", DCTAP: "literal"
 *   - `iri`     → SimpleDSP: "IRI", DCTAP: "IRI"
 *   - `bnode`   → DCTAP only: "bnode"
 *
 * SimpleDSP `structured` and `id` are resolved at display time from
 * `shapeRef`/`classConstraint` fields, not stored as valueType.
 */
export type ValueType = 'literal' | 'iri' | 'bnode' | '';

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
 * const stmt = createStatement({ propertyId: 'foaf:name', valueType: 'literal' });
 */
export function createStatement(init?: Partial<Statement>): Statement {
	return {
		id: uuid(),
		label: '',
		propertyId: '',
		min: null,
		max: null,
		cardinalityNote: '',
		valueType: '',
		datatype: '',
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
