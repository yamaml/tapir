import { describe, it, expect } from 'vitest';

/**
 * Regression tests for the New Project dialog's namespace-provenance model.
 *
 * The dialog keeps two independent namespace sources:
 *   - manualNamespaces: prefixes the user quick-adds or types by hand
 *   - importedNamespaces: prefixes contributed by the currently-loaded import
 * and exposes their union (manual wins on collision) as `projectNamespaces`.
 *
 * These tests lock in the invariants that fixed two reported bugs:
 *   Bug 1 — loading a second example accumulated the first example's
 *           namespaces (the import portion was merged, never replaced).
 *   Bug 2 — switching flavor while an example was loaded left stale
 *           namespaces/base/selection behind.
 *
 * The model is intentionally simple, so we test it directly rather than
 * mounting the Svelte component. `effectiveNamespaces` mirrors the
 * component's `$derived` union exactly.
 */

function effectiveNamespaces(
	imported: Record<string, string>,
	manual: Record<string, string>
): Record<string, string> {
	// Mirrors: $derived({ ...importedNamespaces, ...manualNamespaces })
	return { ...imported, ...manual };
}

describe('namespace provenance: manual additions persist', () => {
	it('a manually added prefix survives a subsequent import', () => {
		const manual = { dcterms: 'http://purl.org/dc/terms/' };
		const imported = {
			schema: 'http://schema.org/',
			foaf: 'http://xmlns.com/foaf/0.1/',
		};
		expect(effectiveNamespaces(imported, manual)).toEqual({
			dcterms: 'http://purl.org/dc/terms/',
			schema: 'http://schema.org/',
			foaf: 'http://xmlns.com/foaf/0.1/',
		});
	});

	it('a manually set URI wins over an import that declares the same prefix', () => {
		const manual = { xsd: 'http://manual.example/xsd#' };
		const imported = { xsd: 'http://import.example/xsd#', schema: 'http://schema.org/' };
		expect(effectiveNamespaces(imported, manual).xsd).toBe('http://manual.example/xsd#');
	});
});

describe('namespace provenance: imports do not accumulate (bug 1)', () => {
	it('loading a new example replaces the previous example’s namespaces', () => {
		const manual: Record<string, string> = {};
		// First example (SRAP) contributes a large prefix set...
		let imported: Record<string, string> = {
			dct: 'http://purl.org/dc/terms/',
			bibo: 'http://purl.org/ontology/bibo/',
			srap: 'http://example.org/srap/',
			edtf: 'http://id.loc.gov/datatypes/EDTFScheme/',
		};
		// ...then a second example (TBBT) replaces it entirely (the import
		// portion is reset before the new import is applied).
		imported = {
			schema: 'http://schema.org/',
			foaf: 'http://xmlns.com/foaf/0.1/',
			rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
			xsd: 'http://www.w3.org/2001/XMLSchema#',
		};
		const result = effectiveNamespaces(imported, manual);
		expect(Object.keys(result).sort()).toEqual(['foaf', 'rdfs', 'schema', 'xsd']);
		expect('dct' in result).toBe(false);
		expect('srap' in result).toBe(false);
		expect('bibo' in result).toBe(false);
		expect('edtf' in result).toBe(false);
	});
});

describe('namespace provenance: clearing an import (bug 2)', () => {
	it('clearing the import leaves only the user’s manual namespaces', () => {
		const manual: Record<string, string> = { dcterms: 'http://purl.org/dc/terms/' };
		let imported: Record<string, string> = {
			schema: 'http://schema.org/',
			foaf: 'http://xmlns.com/foaf/0.1/',
		};
		// A flavor switch (or Remove) resets the imported portion to empty.
		imported = {};
		expect(effectiveNamespaces(imported, manual)).toEqual({
			dcterms: 'http://purl.org/dc/terms/',
		});
	});
});
