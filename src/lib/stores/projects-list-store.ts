/**
 * @fileoverview Reactive store for the project index.
 *
 * Wraps IndexedDB listProjects() as a reactive Svelte store for
 * the dashboard view. Refreshed on project save/delete.
 *
 * @module stores/projects-list-store
 */

import { writable } from 'svelte/store';
import type { ProjectMeta } from '$lib/types';
import { listProjects as dbListProjects } from '$lib/db';

// ── Store ───────────────────────────────────────────────────────

/** Reactive list of all saved projects. */
export const projectsList = writable<ProjectMeta[]>([]);

/** Whether the projects list is loading. */
export const projectsLoading = writable(true);

// ── Actions ─────────────────────────────────────────────────────

/** Refreshes the project list from IndexedDB. */
export async function refreshProjectsList(): Promise<void> {
	projectsLoading.set(true);
	const list = await dbListProjects();
	projectsList.set(list);
	projectsLoading.set(false);
}
