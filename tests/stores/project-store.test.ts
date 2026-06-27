import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { get } from 'svelte/store';
import {
	currentProject,
	addDescription,
	removeDescription,
	updateDescription,
	addStatement,
	removeStatement,
	updateStatement,
	setProjectDescription,
	renamePrefix,
} from '$lib/stores/project-store';
import {
	canUndo,
	canRedo,
	undo,
	redo,
	clearHistory,
} from '$lib/stores/history-store';
import { createProject, createDescription, createStatement } from '$lib/types';
import type { TapirProject } from '$lib/types';

// ── Fixtures ────────────────────────────────────────────────────

function makeProject(): TapirProject {
	const stmt = createStatement({
		id: 'stmt-1',
		label: 'Title',
		propertyId: 'dcterms:title',
		valueType: ['literal'],
		datatype: ['xsd:string'],
	});
	const desc = createDescription({ id: 'desc-1', name: 'MAIN', statements: [stmt] });
	return createProject({
		name: 'Test',
		flavor: 'simpledsp',
		namespaces: { dcterms: 'http://purl.org/dc/terms/' },
		descriptions: [desc],
	});
}

beforeEach(() => {
	currentProject.set(makeProject());
	clearHistory();
});

afterEach(() => {
	vi.restoreAllMocks();
	currentProject.set(null);
	clearHistory();
});

// ── Undo/redo wiring ────────────────────────────────────────────

describe('undo/redo wiring', () => {
	it('starts with empty stacks', () => {
		expect(get(canUndo)).toBe(false);
		expect(get(canRedo)).toBe(false);
	});

	it('addStatement pushes an undo entry', () => {
		addStatement('desc-1');
		expect(get(canUndo)).toBe(true);
		expect(get(currentProject)!.descriptions[0].statements).toHaveLength(2);
	});

	it('undo restores the pre-mutation state after a statement delete', () => {
		removeStatement('desc-1', 'stmt-1');
		expect(get(currentProject)!.descriptions[0].statements).toHaveLength(0);
		undo();
		const stmts = get(currentProject)!.descriptions[0].statements;
		expect(stmts).toHaveLength(1);
		expect(stmts[0].propertyId).toBe('dcterms:title');
	});

	it('redo reapplies an undone mutation', () => {
		removeStatement('desc-1', 'stmt-1');
		undo();
		expect(get(canRedo)).toBe(true);
		redo();
		expect(get(currentProject)!.descriptions[0].statements).toHaveLength(0);
		expect(get(canRedo)).toBe(false);
	});

	it('a new mutation clears the redo stack', () => {
		removeStatement('desc-1', 'stmt-1');
		undo();
		expect(get(canRedo)).toBe(true);
		addStatement('desc-1');
		expect(get(canRedo)).toBe(false);
	});

	it('undo restores a removed description with its shapeRefs intact', () => {
		addDescription({ name: 'Agent' });
		updateStatement('desc-1', 'stmt-1', { shapeRefs: ['Agent'], datatype: [] });
		const agentId = get(currentProject)!.descriptions[1].id;
		removeDescription(agentId);
		// removeDescription also drops the now-dangling shapeRefs
		expect(get(currentProject)!.descriptions[0].statements[0].shapeRefs).toEqual([]);
		undo();
		const p = get(currentProject)!;
		expect(p.descriptions).toHaveLength(2);
		expect(p.descriptions[0].statements[0].shapeRefs).toEqual(['Agent']);
	});

	it('clearHistory empties both stacks', () => {
		removeStatement('desc-1', 'stmt-1');
		undo();
		clearHistory();
		expect(get(canUndo)).toBe(false);
		expect(get(canRedo)).toBe(false);
	});
});

// ── Coalescing + no-op skipping ─────────────────────────────────

describe('undo coalescing', () => {
	it('coalesces rapid same-field updates into one undo step', () => {
		let now = 1_000;
		vi.spyOn(Date, 'now').mockImplementation(() => now);

		updateStatement('desc-1', 'stmt-1', { label: 'T' });
		now += 300;
		updateStatement('desc-1', 'stmt-1', { label: 'Ti' });
		now += 300;
		updateStatement('desc-1', 'stmt-1', { label: 'Tit' });

		undo();
		expect(get(currentProject)!.descriptions[0].statements[0].label).toBe('Title');
		expect(get(canUndo)).toBe(false); // single coalesced step
	});

	it('does not coalesce updates to different fields', () => {
		let now = 1_000;
		vi.spyOn(Date, 'now').mockImplementation(() => now);

		updateStatement('desc-1', 'stmt-1', { label: 'X' });
		now += 100;
		updateStatement('desc-1', 'stmt-1', { note: 'a note' });

		undo();
		expect(get(currentProject)!.descriptions[0].statements[0].note).toBe('');
		expect(get(currentProject)!.descriptions[0].statements[0].label).toBe('X');
		undo();
		expect(get(currentProject)!.descriptions[0].statements[0].label).toBe('Title');
	});

	it('pushes separately once the coalescing window has passed', () => {
		let now = 1_000;
		vi.spyOn(Date, 'now').mockImplementation(() => now);

		updateStatement('desc-1', 'stmt-1', { label: 'A' });
		now += 5_000;
		updateStatement('desc-1', 'stmt-1', { label: 'B' });

		undo();
		expect(get(currentProject)!.descriptions[0].statements[0].label).toBe('A');
		undo();
		expect(get(currentProject)!.descriptions[0].statements[0].label).toBe('Title');
	});
});

describe('no-op mutations', () => {
	it('updateStatement with unchanged values pushes nothing', () => {
		updateStatement('desc-1', 'stmt-1', { label: 'Title' });
		expect(get(canUndo)).toBe(false);
	});

	it('updateDescription with unchanged values pushes nothing', () => {
		updateDescription('desc-1', { name: 'MAIN' });
		expect(get(canUndo)).toBe(false);
	});

	it('setProjectDescription with unchanged value pushes nothing', () => {
		setProjectDescription('');
		expect(get(canUndo)).toBe(false);
	});

	it('no-op updates do not bump updatedAt', () => {
		const before = get(currentProject)!.updatedAt;
		updateStatement('desc-1', 'stmt-1', { datatype: ['xsd:string'] });
		expect(get(currentProject)!.updatedAt).toBe(before);
	});
});

// ── renamePrefix ────────────────────────────────────────────────

describe('renamePrefix', () => {
	it('renames a prefix and rewrites references', () => {
		const ok = renamePrefix('dcterms', 'dct');
		expect(ok).toBe(true);
		const p = get(currentProject)!;
		expect(p.namespaces.dct).toBe('http://purl.org/dc/terms/');
		expect(p.namespaces.dcterms).toBeUndefined();
		expect(p.descriptions[0].statements[0].propertyId).toBe('dct:title');
	});

	it('does not treat the dot in "a.b" as a regex wildcard', () => {
		currentProject.update((p) => ({
			...p!,
			namespaces: { 'a.b': 'http://a.example/', axb: 'http://x.example/' },
			descriptions: [
				{
					...p!.descriptions[0],
					statements: [
						{ ...p!.descriptions[0].statements[0], propertyId: 'axb:title', datatype: [] },
					],
				},
			],
		}));
		const ok = renamePrefix('a.b', 'ab');
		expect(ok).toBe(true);
		// axb:title must be untouched — "a.b" is not a wildcard pattern
		expect(get(currentProject)!.descriptions[0].statements[0].propertyId).toBe('axb:title');
	});

	it('does not throw on regex metacharacters like "a(b"', () => {
		currentProject.update((p) => ({
			...p!,
			namespaces: { 'a(b': 'http://paren.example/' },
		}));
		expect(() => renamePrefix('a(b', 'ab')).not.toThrow();
		expect(get(currentProject)!.namespaces.ab).toBe('http://paren.example/');
	});

	it('rejects a rename onto an existing prefix', () => {
		currentProject.update((p) => ({
			...p!,
			namespaces: { ...p!.namespaces, dct: 'http://other.example/' },
		}));
		expect(renamePrefix('dcterms', 'dct')).toBe(false);
		expect(get(currentProject)!.namespaces.dcterms).toBe('http://purl.org/dc/terms/');
	});

	it('rejects a rename of a missing prefix without pushing undo', () => {
		expect(renamePrefix('nope', 'x')).toBe(false);
		expect(get(canUndo)).toBe(false);
	});
});
