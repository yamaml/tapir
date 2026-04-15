import { describe, it, expect } from 'vitest';
import { validateProject } from '$lib/utils/validation';
import { validateStatementVocab, type VocabLookup } from '$lib/utils/vocab-validation';
import { createProject, createDescription, createStatement } from '$lib/types/profile';
import type { VocabChunk } from '$lib/types';

// ── Fake vocabularies ────────────────────────────────────────────

const foaf: VocabChunk = {
	prefix: 'foaf',
	namespace: 'http://xmlns.com/foaf/0.1/',
	terms: {
		Agent: { t: 'C', l: 'Agent' },
		Person: { t: 'C', l: 'Person', sc: ['Agent'] },
		Document: { t: 'C', l: 'Document' },
		name: { t: 'P', l: 'name', r: ['string'], d: ['Agent'] },
		age: { t: 'P', l: 'age', r: ['integer'], d: ['Person'] },
		knows: { t: 'P', l: 'knows', r: ['Person'], d: ['Person'] },
	},
};

const xsd: VocabChunk = {
	prefix: 'xsd',
	namespace: 'http://www.w3.org/2001/XMLSchema#',
	terms: {
		string: { t: 'C', l: 'string' },
		integer: { t: 'C', l: 'integer' },
		date: { t: 'C', l: 'date' },
	},
};

function makeVocabs(...chunks: VocabChunk[]): VocabLookup {
	const map = new Map(chunks.map((c) => [c.prefix, c]));
	return { getCachedVocab: (p) => map.get(p) };
}

// ── Direct unit tests ────────────────────────────────────────────

describe('validateStatementVocab', () => {
	const desc = createDescription({ name: 'MAIN', targetClass: 'foaf:Person' });

	it('emits no warnings for a valid foaf:name on a foaf:Person', () => {
		const stmt = createStatement({
			propertyId: 'foaf:name',
			valueType: 'literal',
			datatype: 'xsd:string',
		});
		const out = validateStatementVocab(stmt, desc, 'MAIN.name', makeVocabs(foaf, xsd));
		expect(out).toHaveLength(0);
	});

	it('warns on a class-range property declared as literal', () => {
		const stmt = createStatement({ propertyId: 'foaf:knows', valueType: 'literal' });
		const out = validateStatementVocab(stmt, desc, 'MAIN.knows', makeVocabs(foaf));
		expect(out).toHaveLength(1);
		expect(out[0].message).toContain('expects an IRI/object');
	});

	it('warns on a literal-range property declared as IRI', () => {
		const stmt = createStatement({ propertyId: 'foaf:name', valueType: 'iri' });
		const out = validateStatementVocab(stmt, desc, 'MAIN.name', makeVocabs(foaf));
		expect(out).toHaveLength(1);
		expect(out[0].message).toContain('expects a literal');
	});

	it('warns on a datatype mismatch (foaf:age expects integer, declared string)', () => {
		const stmt = createStatement({
			propertyId: 'foaf:age',
			valueType: 'literal',
			datatype: 'xsd:string',
		});
		const out = validateStatementVocab(stmt, desc, 'MAIN.age', makeVocabs(foaf, xsd));
		expect(out).toHaveLength(1);
		expect(out[0].message).toContain('range is xsd:integer');
	});

	it('warns when targetClass is incompatible with property domain', () => {
		const docDesc = createDescription({ name: 'DOC', targetClass: 'foaf:Document' });
		const stmt = createStatement({
			propertyId: 'foaf:age',
			valueType: 'literal',
			datatype: 'xsd:integer',
		});
		const out = validateStatementVocab(stmt, docDesc, 'DOC.age', makeVocabs(foaf));
		expect(out).toHaveLength(1);
		expect(out[0].message).toContain('expects domain foaf:Person');
	});

	it('honours subclass relations when checking domain (Person is a subclass of Agent)', () => {
		// foaf:name's domain is Agent; Person sc Agent → no warning.
		const stmt = createStatement({
			propertyId: 'foaf:name',
			valueType: 'literal',
			datatype: 'xsd:string',
		});
		const out = validateStatementVocab(stmt, desc, 'MAIN.name', makeVocabs(foaf));
		expect(out).toHaveLength(0);
	});

	// ── Skip-on-unknown semantics — these are the safety net ────

	it('skips silently when the property prefix is unknown', () => {
		const stmt = createStatement({ propertyId: 'custom:thing', valueType: 'literal' });
		const out = validateStatementVocab(stmt, desc, 'MAIN.thing', makeVocabs(foaf));
		expect(out).toHaveLength(0);
	});

	it('skips silently when the property exists but carries no range/domain', () => {
		const sparse: VocabChunk = {
			prefix: 'ex',
			namespace: 'http://example.com/',
			terms: { thing: { t: 'P', l: 'thing' } },
		};
		const stmt = createStatement({ propertyId: 'ex:thing', valueType: 'literal' });
		const out = validateStatementVocab(stmt, desc, 'MAIN.thing', makeVocabs(sparse));
		expect(out).toHaveLength(0);
	});

	it('skips datatype check when the datatype prefix is non-xsd', () => {
		const stmt = createStatement({
			propertyId: 'foaf:age',
			valueType: 'literal',
			datatype: 'custom:weird',
		});
		const out = validateStatementVocab(stmt, desc, 'MAIN.age', makeVocabs(foaf));
		expect(out).toHaveLength(0);
	});

	it('skips silently when statement has no propertyId', () => {
		const stmt = createStatement({ propertyId: '', valueType: 'literal' });
		const out = validateStatementVocab(stmt, desc, 'MAIN.empty', makeVocabs(foaf));
		expect(out).toHaveLength(0);
	});
});

// ── Integration via validateProject ──────────────────────────────

describe('validateProject vocab-aware mode', () => {
	it('without vocabs, emits exactly the same output as before (no Tier-2 warnings)', () => {
		const project = createProject({ name: 'Test', flavor: 'simpledsp' });
		project.descriptions = [
			createDescription({
				name: 'MAIN',
				targetClass: 'foaf:Document',
				statements: [
					createStatement({
						propertyId: 'foaf:age',
						valueType: 'literal',
						datatype: 'xsd:integer',
					}),
				],
			}),
		];
		const out = validateProject(project);
		// Would warn if vocabs were passed (Document ↛ Person), but
		// without the lookup the syntactic-only path stays silent.
		const tier2 = out.warnings.filter((w) => w.message.includes('expects domain'));
		expect(tier2).toHaveLength(0);
	});

	it('with vocabs, surfaces the domain mismatch as a warning (not an error)', () => {
		const project = createProject({ name: 'Test', flavor: 'simpledsp' });
		project.descriptions = [
			createDescription({
				name: 'MAIN',
				targetClass: 'foaf:Document',
				statements: [
					createStatement({
						propertyId: 'foaf:age',
						valueType: 'literal',
						datatype: 'xsd:integer',
					}),
				],
			}),
		];
		const out = validateProject(project, makeVocabs(foaf));
		expect(out.errors).toHaveLength(0);
		expect(out.warnings.some((w) => w.message.includes('expects domain'))).toBe(true);
	});
});
