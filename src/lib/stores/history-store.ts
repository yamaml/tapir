/**
 * @fileoverview In-session undo/redo stack.
 *
 * Tracks operational changes within the current editing session.
 * Distinct from the snapshot-based version history (version-history
 * dialog) which persists across sessions in IndexedDB.
 *
 * Usage: `pushUndo()` is called BEFORE every mutation by the
 * project-store mutation helpers, so components never need to call it
 * directly. `undo()` / `redo()` navigate the stack; `clearHistory()`
 * resets it on editor mount and project switch.
 *
 * Snapshots are stored as JSON strings: this gives free deep-cloning
 * (Svelte 5 proxies cannot be `structuredClone`d), cheap top-of-stack
 * equality checks, and identical clone semantics for push, undo, and
 * redo.
 *
 * @module stores/history-store
 */

import { writable, derived, get } from 'svelte/store';
import type { TapirProject } from '$lib/types';
import { currentProject } from './project-store';

// ── Constants ───────────────────────────────────────────────────

const MAX_UNDO_DEPTH = 30;

/**
 * Rapid same-key pushes within this window collapse into one undo
 * step, so keystroke-level `updateStatement` calls (oninput) don't
 * flood the stack with single-character states.
 */
const COALESCE_WINDOW_MS = 1000;

// ── Internal Stores ─────────────────────────────────────────────

const undoStack = writable<string[]>([]);
const redoStack = writable<string[]>([]);

/** Coalescing state for keystroke-level mutations. */
let lastPushKey: string | null = null;
let lastPushTime = 0;

// ── Derived Stores ──────────────────────────────────────────────

/** Whether undo is available. */
export const canUndo = derived(undoStack, ($s) => $s.length > 0);

/** Whether redo is available. */
export const canRedo = derived(redoStack, ($s) => $s.length > 0);

// ── Actions ─────────────────────────────────────────────────────

/**
 * Pushes the current project state onto the undo stack.
 * Called BEFORE a mutation (the project-store helpers do this).
 *
 * @param coalesceKey - Optional key identifying the mutation target.
 *   Consecutive pushes with the same key inside the coalescing window
 *   are collapsed into one (the pre-edit state is already captured),
 *   so continuous typing produces a single undo step.
 */
export function pushUndo(coalesceKey?: string): void {
	const project = get(currentProject);
	if (!project) return;

	const now = Date.now();
	if (
		coalesceKey &&
		coalesceKey === lastPushKey &&
		now - lastPushTime < COALESCE_WINDOW_MS
	) {
		lastPushTime = now;
		return;
	}
	lastPushKey = coalesceKey ?? null;
	lastPushTime = now;

	const json = JSON.stringify(project);
	undoStack.update((stack) => {
		// Skip no-op pushes: a blur that re-commits an unchanged value
		// would otherwise stack an entry identical to the current state.
		if (stack.length > 0 && stack[stack.length - 1] === json) return stack;
		const next = [...stack, json];
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

	lastPushKey = null;
	redoStack.update((r) => [...r, JSON.stringify(project)]);
	currentProject.set(JSON.parse(stack[stack.length - 1]) as TapirProject);
	undoStack.set(stack.slice(0, -1));
}

/** Restores the next state from the redo stack. */
export function redo(): void {
	const project = get(currentProject);
	if (!project) return;
	const stack = get(redoStack);
	if (stack.length === 0) return;

	lastPushKey = null;
	undoStack.update((u) => [...u, JSON.stringify(project)]);
	currentProject.set(JSON.parse(stack[stack.length - 1]) as TapirProject);
	redoStack.set(stack.slice(0, -1));
}

/** Clears both stacks (e.g., on editor mount or project switch). */
export function clearHistory(): void {
	lastPushKey = null;
	lastPushTime = 0;
	undoStack.set([]);
	redoStack.set([]);
}
