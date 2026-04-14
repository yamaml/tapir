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
} from '$lib/db';
import { createProject } from '$lib/types/profile';

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
});
