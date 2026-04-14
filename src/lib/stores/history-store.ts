/**
 * @fileoverview In-session undo/redo stack.
 *
 * Tracks operational changes within the current editing session.
 * Distinct from the snapshot-based version history (snapshot-store.ts)
 * which persists across sessions in IndexedDB.
 *
 * Usage: Call `pushUndo()` BEFORE making a mutation to save the
 * current state. Then `undo()` / `redo()` navigate the stack.
 *
 * @module stores/history-store
 */

import { writable, derived, get } from 'svelte/store';
import type { TapirProject } from '$lib/types';
import { currentProject } from './project-store';

// ── Constants ───────────────────────────────────────────────────

const MAX_UNDO_DEPTH = 30;

// ── Internal Stores ─────────────────────────────────────────────

const undoStack = writable<TapirProject[]>([]);
const redoStack = writable<TapirProject[]>([]);

// ── Derived Stores ──────────────────────────────────────────────

/** Whether undo is available. */
export const canUndo = derived(undoStack, ($s) => $s.length > 0);

/** Whether redo is available. */
export const canRedo = derived(redoStack, ($s) => $s.length > 0);

// ── Actions ─────────────────────────────────────────────────────

/**
 * Pushes the current project state onto the undo stack.
 * Call this BEFORE making a mutation.
 */
export function pushUndo(): void {
	const project = get(currentProject);
	if (!project) return;
	undoStack.update((stack) => {
		const next = [...stack, JSON.parse(JSON.stringify(project))];
		if (next.length > MAX_UNDO_DEPTH) next.shift();
		return next;
	});
	redoStack.set([]); // Clear redo on new action
}

/** Restores the previous state from the undo stack. */
export function undo(): void {
	const project = get(currentProject);
	if (!project) return;
	const stack = get(undoStack);
	if (stack.length === 0) return;

	const prev = stack[stack.length - 1];
	redoStack.update((r) => [...r, JSON.parse(JSON.stringify(project))]);
	currentProject.set(prev);
	undoStack.set(stack.slice(0, -1));
}

/** Restores the next state from the redo stack. */
export function redo(): void {
	const project = get(currentProject);
	if (!project) return;
	const stack = get(redoStack);
	if (stack.length === 0) return;

	const next = stack[stack.length - 1];
	undoStack.update((u) => [...u, structuredClone(project)]);
	currentProject.set(next);
	redoStack.set(stack.slice(0, -1));
}

/** Clears both stacks (e.g., when switching projects). */
export function clearHistory(): void {
	undoStack.set([]);
	redoStack.set([]);
}
