import { describe, it, expect } from 'vitest';
import {
	toMandatory,
	toRepeatable,
	toValueNodeType,
	toValueConstraint,
	buildDctapRows,
	DCTAP_COLUMNS,
} from '$lib/converters/dctap-generator';
import { dctapRowsToTapir } from '$lib/converters/dctap-parser';
import { createProject, createDescription, createStatement } from '$lib/types/profile';
import type { TapirProject } from '$lib/types';

// ── Helpers ─────────────────────────────────────────────────────

function makeProject(overrides?: Partial<TapirProject>): TapirProject {
	return createProject({
		name: 'Test',
		flavor: 'dctap',
		...overrides,
	});
}

// ── DCTAP_COLUMNS ───────────────────────────────────────────────

describe('DCTAP_COLUMNS', () => {
	it('contains all 12 standard DCTAP columns', () => {
		expect(DCTAP_COLUMNS).toHaveLength(12);
		expect(DCTAP_COLUMNS).toContain('shapeID');
		expect(DCTAP_COLUMNS).toContain('shapeLabel');
		expect(DCTAP_COLUMNS).toContain('propertyID');
		expect(DCTAP_COLUMNS).toContain('propertyLabel');
		expect(DCTAP_COLUMNS).toContain('mandatory');
		expect(DCTAP_COLUMNS).toContain('repeatable');
		expect(DCTAP_COLUMNS).toContain('valueNodeType');
		expect(DCTAP_COLUMNS).toContain('valueDataType');
		expect(DCTAP_COLUMNS).toContain('valueConstraint');
		expect(DCTAP_COLUMNS).toContain('valueConstraintType');
		expect(DCTAP_COLUMNS).toContain('valueShape');
		expect(DCTAP_COLUMNS).toContain('note');
	});
});

// ── toMandatory ─────────────────────────────────────────────────

describe('toMandatory', () => {
	it('returns TRUE for min >= 1', () => {
		expect(toMandatory(1)).toBe('TRUE');
		expect(toMandatory(2)).toBe('TRUE');
	});

	it('returns FALSE for min 0', () => {
		expect(toMandatory(0)).toBe('FALSE');
	});

	it('returns empty string for null', () => {
		expect(toMandatory(null)).toBe('');
	});
});

// ── toRepeatable ────────────────────────────────────────────────

describe('toRepeatable', () => {
	it('returns TRUE for null max (unbounded)', () => {
		expect(toRepeatable(null, 0)).toBe('TRUE');
		expect(toRepeatable(null, 1)).toBe('TRUE');
	});

	it('returns TRUE for max > 1', () => {
		expect(toRepeatable(5, 0)).toBe('TRUE');
	});

	it('returns FALSE for max 1', () => {
		expect(toRepeatable(1, 0)).toBe('FALSE');
	});

	it('returns empty string when both null', () => {
		expect(toRepeatable(null, null)).toBe('');
	});
});

// ── toValueNodeType ─────────────────────────────────────────────

describe('toValueNodeType', () => {
	it('maps iri to IRI', () => {
		expect(toValueNodeType('iri')).toBe('IRI');
	});

	it('maps literal to literal', () => {
		expect(toValueNodeType('literal')).toBe('literal');
	});

	it('maps bnode to bnode', () => {
		expect(toValueNodeType('bnode')).toBe('bnode');
	});

	it('returns empty string for empty/unknown', () => {
		expect(toValueNodeType('')).toBe('');
		expect(toValueNodeType('unknown')).toBe('');
	});
});

// ── toValueConstraint ───────────────────────────────────────────

describe('toValueConstraint', () => {
	it('returns picklist for values', () => {
		const stmt = createStatement({ values: ['red', 'green', 'blue'] });
		const result = toValueConstraint(stmt);
		expect(result.valueConstraint).toBe('red,green,blue');
		expect(result.valueConstraintType).toBe('picklist');
	});

	it('returns pattern for pattern', () => {
		const stmt = createStatement({ pattern: '^[A-Z]+$' });
		const result = toValueConstraint(stmt);
		expect(result.valueConstraint).toBe('^[A-Z]+$');
		expect(result.valueConstraintType).toBe('pattern');
	});

	it('returns minInclusive facet', () => {
		const stmt = createStatement({ facets: { MinInclusive: 0 } });
		const result = toValueConstraint(stmt);
		expect(result.valueConstraint).toBe('0');
		expect(result.valueConstraintType).toBe('minInclusive');
	});

	it('returns maxInclusive facet', () => {
		const stmt = createStatement({ facets: { MaxInclusive: 100 } });
		const result = toValueConstraint(stmt);
		expect(result.valueConstraint).toBe('100');
		expect(result.valueConstraintType).toBe('maxInclusive');
	});

	it('returns minLength facet', () => {
		const stmt = createStatement({ facets: { MinLength: 3 } });
		const result = toValueConstraint(stmt);
		expect(result.valueConstraint).toBe('3');
		expect(result.valueConstraintType).toBe('minLength');
	});

	it('returns maxLength facet', () => {
		const stmt = createStatement({ facets: { MaxLength: 255 } });
		const result = toValueConstraint(stmt);
		expect(result.valueConstraint).toBe('255');
		expect(result.valueConstraintType).toBe('maxLength');
	});

	it('returns empty for unconstrained statement', () => {
		const stmt = createStatement();
		const result = toValueConstraint(stmt);
		expect(result.valueConstraint).toBe('');
		expect(result.valueConstraintType).toBe('');
	});

	it('prioritises values over pattern', () => {
		const stmt = createStatement({
			values: ['a', 'b'],
			pattern: '^test',
		});
		const result = toValueConstraint(stmt);
		expect(result.valueConstraintType).toBe('picklist');
	});

	it('emits IRIstem from inScheme', () => {
		const stmt = createStatement({
			inScheme: ['https://id.loc.gov/authorities/subjects/', 'http://vocab.getty.edu/'],
		});
		const result = toValueConstraint(stmt);
		expect(result.valueConstraintType).toBe('IRIstem');
		expect(result.valueConstraint).toBe(
			'https://id.loc.gov/authorities/subjects/,http://vocab.getty.edu/'
		);
	});

	it('emits languageTag when constraintType is set explicitly', () => {
		const stmt = createStatement({
			values: ['en', 'fr', 'zh-Hans'],
			constraintType: 'languageTag',
		});
		const result = toValueConstraint(stmt);
		expect(result.valueConstraintType).toBe('languageTag');
		expect(result.valueConstraint).toBe('en,fr,zh-Hans');
	});

	it('preserves user-set constraintType over heuristic', () => {
		// Values present but user flagged them as languageTag — don't call it picklist.
		const stmt = createStatement({
			values: ['en', 'fr'],
			constraintType: 'languageTag',
		});
		const result = toValueConstraint(stmt);
		expect(result.valueConstraintType).toBe('languageTag');
	});

	it('preserves unknown extension types verbatim', () => {
		const stmt = createStatement({
			constraint: 'foo',
			constraintType: 'myCustom',
		});
		const result = toValueConstraint(stmt);
		expect(result.valueConstraintType).toBe('myCustom');
		expect(result.valueConstraint).toBe('foo');
	});
});

// ── buildDctapRows ──────────────────────────────────────────────

describe('buildDctapRows', () => {
	it('returns empty array for project with no descriptions', () => {
		const project = makeProject();
		expect(buildDctapRows(project)).toHaveLength(0);
	});

	it('generates row for description with no statements', () => {
		const project = makeProject();
		project.descriptions = [
			createDescription({ name: 'EmptyShape', label: 'Empty', note: 'A note' }),
		];

		const rows = buildDctapRows(project);
		expect(rows).toHaveLength(1);
		expect(rows[0].shapeID).toBe('EmptyShape');
		expect(rows[0].shapeLabel).toBe('Empty');
		expect(rows[0].note).toBe('A note');
		expect(rows[0].propertyID).toBe('');
	});

	it('generates rows for description with statements', () => {
		const project = makeProject();
		project.descriptions = [
			createDescription({
				name: 'PersonShape',
				label: 'Person',
				statements: [
					createStatement({
						propertyId: 'foaf:name',
						label: 'Name',
						min: 1,
						max: 1,
						valueType: 'literal',
						datatype: 'xsd:string',
						note: 'Full name',
					}),
					createStatement({
						propertyId: 'foaf:mbox',
						label: 'Email',
						min: 0,
						max: null,
						valueType: 'iri',
					}),
				],
			}),
		];

		const rows = buildDctapRows(project);
		expect(rows).toHaveLength(2);

		// First row carries shape info
		expect(rows[0].shapeID).toBe('PersonShape');
		expect(rows[0].shapeLabel).toBe('Person');
		expect(rows[0].propertyID).toBe('foaf:name');
		expect(rows[0].propertyLabel).toBe('Name');
		expect(rows[0].mandatory).toBe('TRUE');
		expect(rows[0].repeatable).toBe('FALSE');
		expect(rows[0].valueNodeType).toBe('literal');
		expect(rows[0].valueDataType).toBe('xsd:string');
		expect(rows[0].note).toBe('Full name');

		// Second row has empty shape columns
		expect(rows[1].shapeID).toBe('');
		expect(rows[1].shapeLabel).toBe('');
		expect(rows[1].propertyID).toBe('foaf:mbox');
		expect(rows[1].mandatory).toBe('FALSE');
		expect(rows[1].repeatable).toBe('TRUE');
		expect(rows[1].valueNodeType).toBe('IRI');
	});

	it('generates rows for multiple descriptions', () => {
		const project = makeProject();
		project.descriptions = [
			createDescription({
				name: 'PersonShape',
				statements: [createStatement({ propertyId: 'foaf:name' })],
			}),
			createDescription({
				name: 'BookShape',
				statements: [createStatement({ propertyId: 'dcterms:title' })],
			}),
		];

		const rows = buildDctapRows(project);
		expect(rows).toHaveLength(2);
		expect(rows[0].shapeID).toBe('PersonShape');
		expect(rows[1].shapeID).toBe('BookShape');
	});

	it('includes valueShape for shape references', () => {
		const project = makeProject();
		project.descriptions = [
			createDescription({
				name: 'BookShape',
				statements: [
					createStatement({ propertyId: 'dcterms:creator', shapeRefs: ['PersonShape'] }),
				],
			}),
		];

		const rows = buildDctapRows(project);
		expect(rows[0].valueShape).toBe('PersonShape');
	});

	it('skips statements without propertyId', () => {
		const project = makeProject();
		project.descriptions = [
			createDescription({
				name: 'S',
				statements: [
					createStatement({ propertyId: '' }),
					createStatement({ propertyId: 'ex:p' }),
				],
			}),
		];

		const rows = buildDctapRows(project);
		expect(rows).toHaveLength(1);
		expect(rows[0].propertyID).toBe('ex:p');
	});
});

// ── Round-trip Test ─────────────────────────────────────────────

describe('round-trip (generate -> parse)', () => {
	it('preserves structure through generate and parse', () => {
		const original = makeProject();
		original.descriptions = [
			createDescription({
				name: 'PersonShape',
				label: 'Person',
				statements: [
					createStatement({
						propertyId: 'foaf:name',
						label: 'Name',
						min: 1,
						max: 1,
						valueType: 'literal',
						datatype: 'xsd:string',
						note: 'Full name',
					}),
					createStatement({
						propertyId: 'foaf:mbox',
						label: 'Email',
						min: 0,
						max: null,
						valueType: 'iri',
					}),
				],
			}),
			createDescription({
				name: 'BookShape',
				label: 'Book',
				statements: [
					createStatement({
						propertyId: 'dcterms:title',
						label: 'Title',
						min: 1,
						max: 1,
						valueType: 'literal',
					}),
					createStatement({
						propertyId: 'dcterms:creator',
						label: 'Author',
						shapeRefs: ['PersonShape'],
					}),
				],
			}),
		];

		// Generate DCTAP rows
		const rows = buildDctapRows(original);

		// Parse back
		const result = dctapRowsToTapir(rows);
		expect(result.errors).toHaveLength(0);

		const parsed = result.data;
		expect(parsed.descriptions).toHaveLength(2);

		// First description
		const person = parsed.descriptions[0];
		expect(person.name).toBe('PersonShape');
		expect(person.label).toBe('Person');
		expect(person.statements).toHaveLength(2);

		const name = person.statements[0];
		expect(name.propertyId).toBe('foaf:name');
		expect(name.label).toBe('Name');
		expect(name.min).toBe(1);
		expect(name.max).toBe(1);
		expect(name.valueType).toBe('literal');
		expect(name.datatype).toBe('xsd:string');
		expect(name.note).toBe('Full name');

		const email = person.statements[1];
		expect(email.propertyId).toBe('foaf:mbox');
		expect(email.min).toBe(0);
		expect(email.max).toBeNull();
		expect(email.valueType).toBe('iri');

		// Second description
		const book = parsed.descriptions[1];
		expect(book.name).toBe('BookShape');
		expect(book.label).toBe('Book');
		expect(book.statements).toHaveLength(2);

		const title = book.statements[0];
		expect(title.propertyId).toBe('dcterms:title');
		expect(title.min).toBe(1);
		expect(title.max).toBe(1);
		expect(title.valueType).toBe('literal');

		const author = book.statements[1];
		expect(author.shapeRefs).toEqual(['PersonShape']);
	});

	it('preserves picklist values through round-trip', () => {
		const original = makeProject();
		original.descriptions = [
			createDescription({
				name: 'ItemShape',
				statements: [
					createStatement({
						propertyId: 'ex:status',
						values: ['active', 'inactive', 'pending'],
					}),
				],
			}),
		];

		const rows = buildDctapRows(original);
		const result = dctapRowsToTapir(rows);
		const stmt = result.data.descriptions[0].statements[0];
		expect(stmt.values).toEqual(['active', 'inactive', 'pending']);
	});

	it('preserves pattern through round-trip', () => {
		const original = makeProject();
		original.descriptions = [
			createDescription({
				name: 'CodeShape',
				statements: [
					createStatement({
						propertyId: 'ex:code',
						pattern: '^[A-Z]{3}$',
					}),
				],
			}),
		];

		const rows = buildDctapRows(original);
		const result = dctapRowsToTapir(rows);
		const stmt = result.data.descriptions[0].statements[0];
		expect(stmt.pattern).toBe('^[A-Z]{3}$');
	});

	it('preserves facets through round-trip', () => {
		const original = makeProject();
		original.descriptions = [
			createDescription({
				name: 'NumShape',
				statements: [
					createStatement({
						propertyId: 'ex:age',
						facets: { MinInclusive: 0 },
					}),
				],
			}),
		];

		const rows = buildDctapRows(original);
		const result = dctapRowsToTapir(rows);
		const stmt = result.data.descriptions[0].statements[0];
		expect(stmt.facets).toEqual({ MinInclusive: 0 });
	});

	// Multi-valueShape (DCMI SRAP convention: space-separated shape IDs)

	it('emits multiple valueShapes space-separated', () => {
		const project = makeProject();
		project.descriptions = [
			createDescription({
				name: 'Work',
				statements: [
					createStatement({
						propertyId: 'dcterms:creator',
						valueType: 'iri',
						shapeRefs: ['Person', 'Organization'],
					}),
				],
			}),
			createDescription({ name: 'Person' }),
			createDescription({ name: 'Organization' }),
		];
		const rows = buildDctapRows(project);
		expect(rows[0].valueShape).toBe('Person Organization');
	});

	it('round-trips multi-shape valueShape through DCTAP', () => {
		const original = makeProject();
		original.descriptions = [
			createDescription({
				name: 'Work',
				statements: [
					createStatement({
						propertyId: 'dcterms:creator',
						valueType: 'iri',
						shapeRefs: ['Person', 'Organization'],
					}),
				],
			}),
			createDescription({ name: 'Person' }),
			createDescription({ name: 'Organization' }),
		];
		const rows = buildDctapRows(original);
		const parsed = dctapRowsToTapir(rows).data;
		const stmt = parsed.descriptions[0].statements[0];
		expect(stmt.shapeRefs).toEqual(['Person', 'Organization']);
	});
});
