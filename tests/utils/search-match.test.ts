import { describe, it, expect } from 'vitest';
import {
	statementMatchesQuery,
	descriptionMatchesQuery,
	countStatementMatches,
} from '$lib/utils/search-match';
import { createDescription, createStatement } from '$lib/types/profile';

// ── statementMatchesQuery ───────────────────────────────────────

describe('statementMatchesQuery', () => {
	const stmt = createStatement({
		label: 'Author Name',
		propertyId: 'foaf:name',
		note: 'Full legal name of the author',
	});

	it('returns true for an empty query (no-op filter)', () => {
		expect(statementMatchesQuery(stmt, '')).toBe(true);
	});

	it('matches against the label', () => {
		expect(statementMatchesQuery(stmt, 'author')).toBe(true);
	});

	it('matches against the property IRI', () => {
		expect(statementMatchesQuery(stmt, 'foaf')).toBe(true);
	});

	it('matches against the note', () => {
		expect(statementMatchesQuery(stmt, 'legal')).toBe(true);
	});

	it('is case-insensitive', () => {
		expect(statementMatchesQuery(stmt, 'AUTHOR')).toBe(true);
		expect(statementMatchesQuery(stmt, 'Foaf:Name')).toBe(true);
	});

	it('does not match when the query is absent from all fields', () => {
		expect(statementMatchesQuery(stmt, 'publisher')).toBe(false);
	});

	it('handles a statement with missing optional fields gracefully', () => {
		const bare = createStatement({ propertyId: 'dc:title' });
		expect(statementMatchesQuery(bare, 'title')).toBe(true);
		expect(statementMatchesQuery(bare, 'xyz')).toBe(false);
	});
});

// ── descriptionMatchesQuery ─────────────────────────────────────

describe('descriptionMatchesQuery', () => {
	const desc = createDescription({
		name: 'Person',
		label: 'Individual',
		note: 'A human being',
		statements: [
			createStatement({ label: 'Name', propertyId: 'foaf:name' }),
			createStatement({ label: 'Email', propertyId: 'foaf:mbox' }),
		],
	});

	it('returns true for an empty query', () => {
		expect(descriptionMatchesQuery(desc, '')).toBe(true);
	});

	it('matches against the description name', () => {
		expect(descriptionMatchesQuery(desc, 'person')).toBe(true);
	});

	it('matches against the description label', () => {
		expect(descriptionMatchesQuery(desc, 'individual')).toBe(true);
	});

	it('matches against the description note', () => {
		expect(descriptionMatchesQuery(desc, 'human')).toBe(true);
	});

	it('matches when any statement matches', () => {
		expect(descriptionMatchesQuery(desc, 'email')).toBe(true);
		expect(descriptionMatchesQuery(desc, 'mbox')).toBe(true);
	});

	it('does not match when nothing contains the query', () => {
		expect(descriptionMatchesQuery(desc, 'organization')).toBe(false);
	});
});

// ── countStatementMatches ───────────────────────────────────────

describe('countStatementMatches', () => {
	const desc = createDescription({
		name: 'Book',
		statements: [
			createStatement({ label: 'Title', propertyId: 'dc:title' }),
			createStatement({ label: 'Author', propertyId: 'dc:creator' }),
			createStatement({ label: 'Author Link', propertyId: 'dc:contributor' }),
		],
	});

	it('returns 0 for an empty query', () => {
		expect(countStatementMatches(desc, '')).toBe(0);
	});

	it('counts label matches', () => {
		expect(countStatementMatches(desc, 'author')).toBe(2);
	});

	it('counts property-IRI matches', () => {
		expect(countStatementMatches(desc, 'dc:')).toBe(3);
	});

	it('returns 0 when nothing matches', () => {
		expect(countStatementMatches(desc, 'xyz')).toBe(0);
	});
});
