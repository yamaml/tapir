import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import {
	saveProject,
	loadProject,
	listProjects,
	deleteProject,
	saveSnapshot,
	getSnapshots,
	pruneAutoSnapshots,
	savePrefs,
	loadPrefs,
	DEFAULT_PREFS,
	resetDb,
	migrateLegacyDatatype,
} from '$lib/db';
import { createProject, createStatement } from '$lib/types/profile';

beforeEach(async () => {
	// Close existing connection, then delete the database for a fresh start
	await resetDb();
	await new Promise<void>((resolve, reject) => {
		const req = indexedDB.deleteDatabase('tapir');
		req.onsuccess = () => resolve();
		req.onerror = () => reject(req.error);
	});
});

describe('project operations', () => {
	it('saves and loads a project', async () => {
		const project = createProject({ name: 'Test', flavor: 'simpledsp' });
		await saveProject(project);
		const loaded = await loadProject(project.id);
		expect(loaded).toBeDefined();
		expect(loaded!.name).toBe('Test');
		expect(loaded!.flavor).toBe('simpledsp');
	});

	it('lists all projects with metadata', async () => {
		const p1 = createProject({ name: 'A', flavor: 'simpledsp' });
		const p2 = createProject({ name: 'B', flavor: 'dctap' });
		await saveProject(p1);
		await saveProject(p2);
		const list = await listProjects();
		expect(list).toHaveLength(2);
		expect(list[0].descriptionCount).toBe(0);
		expect(list[0].statementCount).toBe(0);
	});

	it('updates an existing project', async () => {
		const project = createProject({ name: 'Original', flavor: 'simpledsp' });
		await saveProject(project);
		project.name = 'Updated';
		await saveProject(project);
		const loaded = await loadProject(project.id);
		expect(loaded!.name).toBe('Updated');
		const list = await listProjects();
		expect(list).toHaveLength(1);
	});

	it('deletes a project', async () => {
		const project = createProject({ name: 'Del', flavor: 'simpledsp' });
		await saveProject(project);
		await deleteProject(project.id);
		const loaded = await loadProject(project.id);
		expect(loaded).toBeUndefined();
	});

	it('deletes associated snapshots when deleting a project', async () => {
		const project = createProject({ name: 'Snap', flavor: 'simpledsp' });
		await saveProject(project);
		await saveSnapshot({
			projectId: project.id,
			label: 'v1',
			timestamp: new Date().toISOString(),
			data: project,
			auto: false,
		});
		await deleteProject(project.id);
		const snapshots = await getSnapshots(project.id);
		expect(snapshots).toHaveLength(0);
	});

	it('removes all snapshots atomically and leaves other projects intact', async () => {
		const doomed = createProject({ name: 'Doomed', flavor: 'simpledsp' });
		const keeper = createProject({ name: 'Keeper', flavor: 'dctap' });
		await saveProject(doomed);
		await saveProject(keeper);
		for (let i = 0; i < 3; i++) {
			await saveSnapshot({
				projectId: doomed.id,
				label: `d${i}`,
				timestamp: new Date(2026, 0, 1 + i).toISOString(),
				data: doomed,
				auto: i > 0,
			});
		}
		await saveSnapshot({
			projectId: keeper.id,
			label: 'k1',
			timestamp: new Date().toISOString(),
			data: keeper,
			auto: false,
		});

		await deleteProject(doomed.id);

		expect(await loadProject(doomed.id)).toBeUndefined();
		expect(await getSnapshots(doomed.id)).toHaveLength(0);
		// The other project and its snapshots are untouched.
		expect(await loadProject(keeper.id)).toBeDefined();
		expect(await getSnapshots(keeper.id)).toHaveLength(1);
	});
});

describe('legacy datatype migration', () => {
	it('promotes string datatype to array on direct migration', () => {
		const project = createProject({ name: 'Legacy', flavor: 'simpledsp' });
		project.descriptions = [
			{
				id: 'd1',
				name: 'MAIN',
				label: '',
				targetClass: '',
				idPrefix: '',
				note: '',
				closed: false,
				statements: [
					{
						...createStatement({ propertyId: 'dcterms:date' }),
						// Pre-multi-datatype records stored a plain string.
						datatype: 'xsd:gYear xsd:date' as unknown as string[],
					},
				],
			},
		];
		const migrated = migrateLegacyDatatype(project);
		expect(migrated.descriptions[0].statements[0].datatype).toEqual([
			'xsd:gYear',
			'xsd:date',
		]);
	});

	it('normalises non-string non-array datatype to an empty array', () => {
		const project = createProject({ name: 'Legacy2', flavor: 'simpledsp' });
		project.descriptions = [
			{
				id: 'd1',
				name: 'MAIN',
				label: '',
				targetClass: '',
				idPrefix: '',
				note: '',
				closed: false,
				statements: [
					{
						...createStatement({ propertyId: 'ex:p' }),
						datatype: undefined as unknown as string[],
					},
				],
			},
		];
		const migrated = migrateLegacyDatatype(project);
		expect(migrated.descriptions[0].statements[0].datatype).toEqual([]);
	});

	it('applies the migration on loadProject (snapshot-restore parity)', async () => {
		const project = createProject({ name: 'LegacyStore', flavor: 'simpledsp' });
		project.descriptions = [
			{
				id: 'd1',
				name: 'MAIN',
				label: '',
				targetClass: '',
				idPrefix: '',
				note: '',
				closed: false,
				statements: [
					{
						...createStatement({ propertyId: 'dcterms:date' }),
						datatype: 'xsd:string' as unknown as string[],
					},
				],
			},
		];
		await saveProject(project);
		const loaded = await loadProject(project.id);
		expect(loaded!.descriptions[0].statements[0].datatype).toEqual(['xsd:string']);
	});

	it('promotes scalar valueType to a list', () => {
		const project = createProject({ name: 'LegacyVT', flavor: 'dctap' });
		const legacyStmt = (valueType: unknown) => ({
			...createStatement({ propertyId: 'ex:p' }),
			valueType: valueType as never,
		});
		project.descriptions = [
			{
				id: 'd1', name: 'S', label: '', targetClass: '', idPrefix: '',
				note: '', closed: false,
				statements: [
					legacyStmt('iri'),
					legacyStmt('IRI BNODE'), // legacy could carry a multi-token string
					legacyStmt(''), // unset
					legacyStmt('structured'), // derived pseudo-type → dropped
					legacyStmt(undefined),
				],
			},
		];
		const stmts = migrateLegacyDatatype(project).descriptions[0].statements;
		expect(stmts[0].valueType).toEqual(['iri']);
		expect(stmts[1].valueType).toEqual(['iri', 'bnode']);
		expect(stmts[2].valueType).toEqual([]);
		expect(stmts[3].valueType).toEqual([]);
		expect(stmts[4].valueType).toEqual([]);
	});
});

describe('snapshot operations', () => {
	it('saves and retrieves snapshots', async () => {
		const project = createProject({ name: 'Snap', flavor: 'simpledsp' });
		await saveProject(project);
		await saveSnapshot({
			projectId: project.id,
			label: 'Initial',
			timestamp: new Date().toISOString(),
			data: project,
			auto: false,
		});
		const snapshots = await getSnapshots(project.id);
		expect(snapshots).toHaveLength(1);
		expect(snapshots[0].label).toBe('Initial');
	});

	it('orders snapshots by timestamp descending', async () => {
		const project = createProject({ name: 'Order', flavor: 'simpledsp' });
		await saveProject(project);

		await saveSnapshot({
			projectId: project.id,
			label: 'First',
			timestamp: '2026-01-01T00:00:00Z',
			data: project,
			auto: false,
		});
		await saveSnapshot({
			projectId: project.id,
			label: 'Second',
			timestamp: '2026-01-02T00:00:00Z',
			data: project,
			auto: false,
		});

		const snapshots = await getSnapshots(project.id);
		expect(snapshots[0].label).toBe('Second');
		expect(snapshots[1].label).toBe('First');
	});

	it('prunes auto-save snapshots beyond limit', async () => {
		const project = createProject({ name: 'Prune', flavor: 'simpledsp' });
		await saveProject(project);

		// Create 5 auto snapshots
		for (let i = 0; i < 5; i++) {
			await saveSnapshot({
				projectId: project.id,
				label: `auto-${i}`,
				timestamp: new Date(2026, 0, 1 + i).toISOString(),
				data: project,
				auto: true,
			});
		}

		// Create 1 manual snapshot
		await saveSnapshot({
			projectId: project.id,
			label: 'manual',
			timestamp: new Date(2026, 0, 10).toISOString(),
			data: project,
			auto: false,
		});

		// Prune keeping only 2 auto snapshots
		await pruneAutoSnapshots(project.id, 2);

		const remaining = await getSnapshots(project.id);
		const autoRemaining = remaining.filter((s) => s.auto);
		const manualRemaining = remaining.filter((s) => !s.auto);

		expect(autoRemaining).toHaveLength(2);
		expect(manualRemaining).toHaveLength(1); // Manual never pruned
	});
});

describe('preferences', () => {
	it('returns defaults when no prefs saved', async () => {
		const prefs = await loadPrefs();
		expect(prefs).toEqual(DEFAULT_PREFS);
	});

	it('saves and loads preferences', async () => {
		const custom = { ...DEFAULT_PREFS, editorMode: 'smart-table' as const };
		await savePrefs(custom);
		const loaded = await loadPrefs();
		expect(loaded.editorMode).toBe('smart-table');
	});

	it('round-trips the persisted editor mode', async () => {
		await savePrefs({ ...DEFAULT_PREFS, editorMode: 'raw-table' });
		const loaded = await loadPrefs();
		expect(loaded.editorMode).toBe('raw-table');
	});

	it('drops the removed sidebarWidth/diagramPanelWidth legacy fields', async () => {
		// Simulate a pre-cleanup record carrying the dead schema fields.
		await savePrefs({
			...DEFAULT_PREFS,
			sidebarWidth: 220,
			diagramPanelWidth: 300,
		} as unknown as typeof DEFAULT_PREFS);
		const loaded = await loadPrefs();
		expect('sidebarWidth' in loaded).toBe(false);
		expect('diagramPanelWidth' in loaded).toBe(false);
	});
});
