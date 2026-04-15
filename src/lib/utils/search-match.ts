/**
 * @fileoverview Shared search-match predicates for the editor.
 *
 * The editor's Ctrl+K search needs to answer three questions from the
 * same logic so the UX is coherent:
 *
 *   1. Does this description match? (sidebar filter)
 *   2. Does this statement match?   (card/row highlight)
 *   3. How many matches does the active description have? (count badge)
 *
 * Centralising the predicates here keeps the definition of "match"
 * identical across the sidebar, customized editor, and smart table —
 * when the rules evolve, they evolve in one place.
 *
 * Matching is case-insensitive and checks the human-readable fields
 * most users search by: name, label, property IRI, and free-text
 * note. Structural fields (min/max, valueType enum, etc.) are not
 * included — those have dedicated filters elsewhere.
 *
 * @module utils/search-match
 */

import type { Description, Statement } from '$lib/types';

// ── Helpers ─────────────────────────────────────────────────────

function includesCaseInsensitive(haystack: string | undefined | null, needle: string): boolean {
	if (!haystack) return false;
	return haystack.toLowerCase().includes(needle);
}

// ── Statement match ─────────────────────────────────────────────

/**
 * Returns true if the statement's label, property IRI, or note
 * contains the query (case-insensitive). An empty query matches
 * everything so callers can use this as a no-op filter predicate.
 *
 * @param stmt - The statement to test.
 * @param query - The (possibly empty) search query.
 * @returns True if the statement matches.
 */
export function statementMatchesQuery(stmt: Statement, query: string): boolean {
	if (!query) return true;
	const q = query.toLowerCase();
	return (
		includesCaseInsensitive(stmt.label, q) ||
		includesCaseInsensitive(stmt.propertyId, q) ||
		includesCaseInsensitive(stmt.note, q)
	);
}

// ── Description match ───────────────────────────────────────────

/**
 * Returns true if the description itself or any of its statements
 * matches the query. Used by the sidebar to filter which descriptions
 * are visible.
 *
 * @param desc - The description to test.
 * @param query - The (possibly empty) search query.
 * @returns True if the description or any of its statements matches.
 */
export function descriptionMatchesQuery(desc: Description, query: string): boolean {
	if (!query) return true;
	const q = query.toLowerCase();
	if (
		includesCaseInsensitive(desc.name, q) ||
		includesCaseInsensitive(desc.label, q) ||
		includesCaseInsensitive(desc.note, q)
	) {
		return true;
	}
	return desc.statements.some((s) => statementMatchesQuery(s, query));
}

// ── Counts ──────────────────────────────────────────────────────

/**
 * Counts matching statements inside a description. Returns 0 when
 * the query is empty (caller decides how to render a 0-count badge).
 *
 * @param desc - The description whose statements to count.
 * @param query - The search query.
 * @returns Number of matching statements.
 */
export function countStatementMatches(desc: Description, query: string): number {
	if (!query) return 0;
	return desc.statements.reduce(
		(n, s) => (statementMatchesQuery(s, query) ? n + 1 : n),
		0,
	);
}
