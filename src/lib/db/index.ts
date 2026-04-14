/**
 * @fileoverview IndexedDB wrapper for Tapir project persistence.
 *
 * Uses the `idb` library for a Promise-based API over IndexedDB.
 * Database name: "tapir"
 * Object stores:
 *   - "projects"  → TapirProject records, keyed by `id`
 *   - "snapshots" → ProjectSnapshot records, auto-increment key,
 *                    indexed by `projectId`
 *   - "prefs"     → UserPrefs singleton
 *
 * @module db
 */

import { openDB, type IDBPDatabase } from 'idb';
import type { TapirProject, ProjectMeta, ProjectSnapshot } from '$lib/types';

// ── Database Setup ──────────────────────────────────────────────

const DB_NAME = 'tapir';
const DB_VERSION = 1;

/** Cached database connection. */
let dbPromise: Promise<IDBPDatabase> | null = null;

/** Opens (or returns cached) the Tapir database. */
function getDb(): Promise<IDBPDatabase> {
	if (!dbPromise) {
		dbPromise = openDB(DB_NAME, DB_VERSION, {
			upgrade(db) {
				if (!db.objectStoreNames.contains('projects')) {
					db.createObjectStore('projects', { keyPath: 'id' });
				}
				if (!db.objectStoreNames.contains('snapshots')) {
					const store = db.createObjectStore('snapshots', {
						keyPath: 'id',
						autoIncrement: true,
					});
					store.createIndex('byProject', 'projectId');
				}
				if (!db.objectStoreNames.contains('prefs')) {
					db.createObjectStore('prefs');
				}
			},
		});
	}
	return dbPromise;
}

// ── Project Operations ──────────────────────────────────────────

/** Saves a project to IndexedDB (create or update). */
export async function saveProject(project: TapirProject): Promise<void> {
	const db = await getDb();
	await db.put('projects', project);
}

/** Loads a project by ID. Returns undefined if not found. */
export async function loadProject(id: string): Promise<TapirProject | undefined> {
	const db = await getDb();
	return db.get('projects', id);
}

/**
 * Checks whether a project with the given name already exists.
 *
 * Comparison is case-insensitive and trims whitespace, so "My Profile"
 * and "  my profile  " are treated as duplicates. An optional
 * `excludeId` skips a single project (used by rename flows so a project
 * isn't reported as colliding with itself).
 *
 * @param name - The candidate project name.
 * @param excludeId - Project ID to ignore (for rename checks).
 * @returns True if another project already uses this name.
 */
export async function projectNameExists(
	name: string,
	excludeId?: string
): Promise<boolean> {
	const normalized = name.trim().toLowerCase();
	if (!normalized) return false;
	const db = await getDb();
	const projects: TapirProject[] = await db.getAll('projects');
	return projects.some(
		(p) => p.id !== excludeId && p.name.trim().toLowerCase() === normalized
	);
}

/** Lists all projects as metadata summaries, sorted by updatedAt descending. */
export async function listProjects(): Promise<ProjectMeta[]> {
	const db = await getDb();
	const projects: TapirProject[] = await db.getAll('projects');
	return projects
		.map((p) => ({
			id: p.id,
			name: p.name,
			description: p.description ?? '',
			flavor: p.flavor,
			descriptionCount: p.descriptions.length,
			statementCount: p.descriptions.reduce(
				(sum, d) => sum + d.statements.length,
				0
			),
			updatedAt: p.updatedAt,
		}))
		.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

/** Deletes a project and its snapshots. */
export async function deleteProject(id: string): Promise<void> {
	const db = await getDb();
	await db.delete('projects', id);

	// Also delete associated snapshots
	const tx = db.transaction('snapshots', 'readwrite');
	const index = tx.store.index('byProject');
	let cursor = await index.openCursor(id);
	while (cursor) {
		await cursor.delete();
		cursor = await cursor.continue();
	}
	await tx.done;
}

/** Creates a deep copy of a project with new UUIDs and " (copy)" appended to the name. */
export async function duplicateProject(projectId: string): Promise<TapirProject> {
	const db = await getDb();
	const original = await db.get('projects', projectId);
	if (!original) throw new Error(`Project ${projectId} not found`);

	const copy: TapirProject = structuredClone(original);
	copy.id = crypto.randomUUID();
	copy.name = await uniqueCopyName(db, original.name);
	copy.createdAt = new Date().toISOString();
	copy.updatedAt = new Date().toISOString();

	// Give all descriptions and statements new UUIDs
	for (const desc of copy.descriptions) {
		desc.id = crypto.randomUUID();
		for (const stmt of desc.statements) {
			stmt.id = crypto.randomUUID();
		}
	}

	await db.put('projects', copy);
	return copy;
}

/**
 * Picks a unique "… (copy)" / "… (copy 2)" / etc. name for a duplicate,
 * avoiding collisions with existing projects.
 */
async function uniqueCopyName(db: IDBPDatabase, base: string): Promise<string> {
	const projects: TapirProject[] = await db.getAll('projects');
	const taken = new Set(projects.map((p) => p.name.trim().toLowerCase()));
	const first = `${base} (copy)`;
	if (!taken.has(first.trim().toLowerCase())) return first;
	for (let n = 2; n < 1000; n++) {
		const candidate = `${base} (copy ${n})`;
		if (!taken.has(candidate.trim().toLowerCase())) return candidate;
	}
	return `${base} (copy ${Date.now()})`;
}

// ── Snapshot Operations ─────────────────────────────────────────

/** Saves a version snapshot. Returns the auto-generated ID. */
export async function saveSnapshot(snapshot: ProjectSnapshot): Promise<number> {
	const db = await getDb();
	return db.add('snapshots', snapshot) as Promise<number>;
}

/** Gets all snapshots for a project, ordered by timestamp descending. */
export async function getSnapshots(projectId: string): Promise<ProjectSnapshot[]> {
	const db = await getDb();
	const index = db.transaction('snapshots').store.index('byProject');
	const snapshots = await index.getAll(projectId);
	return snapshots.sort(
		(a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
	);
}

/** Deletes auto-save snapshots beyond the limit for a project. */
export async function pruneAutoSnapshots(
	projectId: string,
	keepCount: number = 50
): Promise<void> {
	const db = await getDb();
	const all = await getSnapshots(projectId);
	const autoSnapshots = all.filter((s) => s.auto);
	if (autoSnapshots.length <= keepCount) return;

	const toDelete = autoSnapshots.slice(keepCount);
	const tx = db.transaction('snapshots', 'readwrite');
	for (const snap of toDelete) {
		if (snap.id != null) {
			await tx.store.delete(snap.id);
		}
	}
	await tx.done;
}

/** Deletes a single snapshot by ID. */
export async function deleteSnapshot(id: number): Promise<void> {
	const db = await getDb();
	await db.delete('snapshots', id);
}

/**
 * Updates the label of an existing snapshot.
 *
 * @param id - The snapshot's auto-increment ID (must exist).
 * @param label - The new label string.
 */
export async function updateSnapshotLabel(id: number, label: string): Promise<void> {
	const db = await getDb();
	const snapshot = await db.get('snapshots', id);
	if (!snapshot) return;
	snapshot.label = label;
	await db.put('snapshots', snapshot);
}

// ── Preferences ─────────────────────────────────────────────────

/** User preferences shape. */
export interface UserPrefs {
	editorMode: 'customized' | 'smart-table' | 'raw-table';
	diagramStyle: 'detail' | 'overview';
	diagramColorMode: 'color' | 'bw';
	simpleDspLang: 'en' | 'jp';
	assistanceEnabled: boolean;
	sidebarWidth: number;
	diagramPanelWidth: number;
}

/** Default preferences. */
export const DEFAULT_PREFS: UserPrefs = {
	editorMode: 'customized',
	diagramStyle: 'detail',
	diagramColorMode: 'color',
	simpleDspLang: 'en',
	assistanceEnabled: true,
	sidebarWidth: 220,
	diagramPanelWidth: 300,
};

/** Loads user preferences, returning defaults if none saved. */
export async function loadPrefs(): Promise<UserPrefs> {
	const db = await getDb();
	const prefs = await db.get('prefs', 'user');
	return prefs ? { ...DEFAULT_PREFS, ...prefs } : DEFAULT_PREFS;
}

/** Saves user preferences. */
export async function savePrefs(prefs: UserPrefs): Promise<void> {
	const db = await getDb();
	await db.put('prefs', prefs, 'user');
}

/**
 * Closes the database connection and resets the cache.
 * Useful for testing where the database is recreated between tests.
 */
export async function resetDb(): Promise<void> {
	if (dbPromise) {
		const db = await dbPromise;
		db.close();
		dbPromise = null;
	}
}
