/**
 * @fileoverview Reactive store for the currently open project.
 *
 * Provides a writable store for the active TapirProject and helper
 * functions for mutating descriptions and statements. All mutations
 * update the `updatedAt` timestamp.
 *
 * @module stores/project-store
 */

import { writable, derived } from 'svelte/store';
import type { TapirProject, Description, Statement } from '$lib/types';
import { createDescription, createStatement } from '$lib/types';

// ── Store ───────────────────────────────────────────────────────

/** The currently open project. Null when on the dashboard. */
export const currentProject = writable<TapirProject | null>(null);

/** Whether a project is currently loaded. */
export const hasProject = derived(currentProject, ($p) => $p !== null);

// ── Description Mutations ───────────────────────────────────────

/** Adds a new description to the project. */
export function addDescription(init: Partial<Description> & Pick<Description, 'name'>): void {
	currentProject.update((p) => {
		if (!p) return p;
		const desc = createDescription(init);
		return {
			...p,
			descriptions: [...p.descriptions, desc],
			updatedAt: new Date().toISOString(),
		};
	});
}

/** Removes a description by ID. Also drops shapeRefs entries that point to it. */
export function removeDescription(descriptionId: string): void {
	currentProject.update((p) => {
		if (!p) return p;
		const removed = p.descriptions.find((d) => d.id === descriptionId);
		const removedName = removed?.name;

		let descriptions = p.descriptions.filter((d) => d.id !== descriptionId);

		// Drop references to the removed description from every statement's shapeRefs list
		if (removedName) {
			descriptions = descriptions.map((d) => ({
				...d,
				statements: d.statements.map((s) => {
					if (!s.shapeRefs || !s.shapeRefs.includes(removedName)) return s;
					return { ...s, shapeRefs: s.shapeRefs.filter((r) => r !== removedName) };
				}),
			}));
		}

		return {
			...p,
			descriptions,
			updatedAt: new Date().toISOString(),
		};
	});
}

/** Updates a description's fields by ID. Also rewrites shapeRefs entries if the name changes. */
export function updateDescription(
	descriptionId: string,
	updates: Partial<Omit<Description, 'id' | 'statements'>>
): void {
	currentProject.update((p) => {
		if (!p) return p;

		// Find the old name for shapeRefs rewrites
		const oldDesc = p.descriptions.find((d) => d.id === descriptionId);
		const oldName = oldDesc?.name;
		const newName = updates.name;
		const nameChanged = newName && oldName && newName !== oldName;

		let descriptions = p.descriptions.map((d) =>
			d.id === descriptionId ? { ...d, ...updates } : d
		);

		// If the name changed, rewrite every shapeRefs entry pointing to the old name
		if (nameChanged) {
			descriptions = descriptions.map((d) => ({
				...d,
				statements: d.statements.map((s) => {
					if (!s.shapeRefs || !s.shapeRefs.includes(oldName)) return s;
					return {
						...s,
						shapeRefs: s.shapeRefs.map((r) => (r === oldName ? newName : r)),
					};
				}),
			}));
		}

		return {
			...p,
			descriptions,
			updatedAt: new Date().toISOString(),
		};
	});
}

/** Reorders descriptions within the project. */
export function reorderDescriptions(fromIndex: number, toIndex: number): void {
	currentProject.update((p) => {
		if (!p) return p;
		if (fromIndex < 0 || fromIndex >= p.descriptions.length) return p;
		if (toIndex < 0 || toIndex >= p.descriptions.length) return p;
		const descs = [...p.descriptions];
		const [moved] = descs.splice(fromIndex, 1);
		descs.splice(toIndex, 0, moved);
		return { ...p, descriptions: descs, updatedAt: new Date().toISOString() };
	});
}

// ── Statement Mutations ─────────────────────────────────────────

/** Adds a statement to a description. */
export function addStatement(descriptionId: string, init?: Partial<Statement>): void {
	currentProject.update((p) => {
		if (!p) return p;
		const stmt = createStatement(init);
		return {
			...p,
			descriptions: p.descriptions.map((d) =>
				d.id === descriptionId
					? { ...d, statements: [...d.statements, stmt] }
					: d
			),
			updatedAt: new Date().toISOString(),
		};
	});
}

/** Removes a statement by ID from a description. */
export function removeStatement(descriptionId: string, statementId: string): void {
	currentProject.update((p) => {
		if (!p) return p;
		return {
			...p,
			descriptions: p.descriptions.map((d) =>
				d.id === descriptionId
					? { ...d, statements: d.statements.filter((s) => s.id !== statementId) }
					: d
			),
			updatedAt: new Date().toISOString(),
		};
	});
}

/** Updates a statement's fields by ID. */
export function updateStatement(
	descriptionId: string,
	statementId: string,
	updates: Partial<Omit<Statement, 'id'>>
): void {
	currentProject.update((p) => {
		if (!p) return p;
		return {
			...p,
			descriptions: p.descriptions.map((d) =>
				d.id === descriptionId
					? {
							...d,
							statements: d.statements.map((s) =>
								s.id === statementId ? { ...s, ...updates } : s
							),
						}
					: d
			),
			updatedAt: new Date().toISOString(),
		};
	});
}

/** Duplicates a statement within a description, inserting the copy after the original. */
export function duplicateStatement(descriptionId: string, statementId: string): void {
	currentProject.update((p) => {
		if (!p) return p;
		return {
			...p,
			descriptions: p.descriptions.map((d) => {
				if (d.id !== descriptionId) return d;
				const idx = d.statements.findIndex((s) => s.id === statementId);
				if (idx === -1) return d;
				// Use JSON round-trip instead of structuredClone to avoid
				// Svelte 5 proxy issues (proxies can't be structuredClone'd)
				const copy: Statement = JSON.parse(JSON.stringify(d.statements[idx]));
				copy.id = crypto.randomUUID();
				const newStatements = [...d.statements];
				newStatements.splice(idx + 1, 0, copy);
				return { ...d, statements: newStatements };
			}),
			updatedAt: new Date().toISOString(),
		};
	});
}

/** Reorders statements within a description. */
export function reorderStatements(
	descriptionId: string,
	fromIndex: number,
	toIndex: number
): void {
	currentProject.update((p) => {
		if (!p) return p;
		return {
			...p,
			descriptions: p.descriptions.map((d) => {
				if (d.id !== descriptionId) return d;
				if (fromIndex < 0 || fromIndex >= d.statements.length) return d;
				if (toIndex < 0 || toIndex >= d.statements.length) return d;
				const stmts = [...d.statements];
				const [moved] = stmts.splice(fromIndex, 1);
				stmts.splice(toIndex, 0, moved);
				return { ...d, statements: stmts };
			}),
			updatedAt: new Date().toISOString(),
		};
	});
}

// ── Project-Level Mutations ─────────────────────────────────────

/** Updates the project's namespace map. */
export function setNamespaces(namespaces: Record<string, string>): void {
	currentProject.update((p) => {
		if (!p) return p;
		return { ...p, namespaces, updatedAt: new Date().toISOString() };
	});
}

/** Updates the project's base IRI. */
export function setBase(base: string): void {
	currentProject.update((p) => {
		if (!p) return p;
		return { ...p, base, updatedAt: new Date().toISOString() };
	});
}

/** Updates the project's display name. Empty/whitespace is rejected. */
export function setProjectName(name: string): void {
	const trimmed = name.trim();
	if (!trimmed) return;
	currentProject.update((p) => {
		if (!p) return p;
		if (p.name === trimmed) return p;
		return { ...p, name: trimmed, updatedAt: new Date().toISOString() };
	});
}

/** Updates the project's optional one-line description. */
export function setProjectDescription(description: string): void {
	const trimmed = description.trim();
	currentProject.update((p) => {
		if (!p) return p;
		if ((p.description ?? '') === trimmed) return p;
		return { ...p, description: trimmed, updatedAt: new Date().toISOString() };
	});
}

/**
 * Renames a namespace prefix in place, also rewriting every reference
 * in the profile so existing statements keep pointing at the same URI.
 *
 * If `newPrefix` already exists in the namespace map (and isn't the same
 * as `oldPrefix`), the rename is rejected to avoid silently merging two
 * bindings.
 *
 * @returns `true` if the rename succeeded, `false` if the new prefix
 *   already exists or `oldPrefix` is missing.
 */
export function renamePrefix(oldPrefix: string, newPrefix: string): boolean {
	if (oldPrefix === newPrefix) return true;
	let success = false;
	currentProject.update((p) => {
		if (!p) return p;
		if (!(oldPrefix in p.namespaces)) return p;
		if (newPrefix in p.namespaces) return p; // collision

		// Move the URI to the new prefix key, preserving order.
		const namespaces: Record<string, string> = {};
		for (const [k, v] of Object.entries(p.namespaces)) {
			namespaces[k === oldPrefix ? newPrefix : k] = v;
		}

		const oldRe = new RegExp(`^${oldPrefix.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}:`);
		const swap = (s: string): string => oldRe.test(s) ? s.replace(oldRe, `${newPrefix}:`) : s;
		const swapList = (xs: string[] | undefined): string[] | undefined =>
			xs ? xs.map(swap) : xs;

		const descriptions = p.descriptions.map((d) => ({
			...d,
			targetClass: swap(d.targetClass),
			idPrefix: d.idPrefix === oldPrefix ? newPrefix : d.idPrefix,
			statements: d.statements.map((s) => ({
				...s,
				propertyId: swap(s.propertyId),
				datatype: swap(s.datatype),
				classConstraint: swapList(s.classConstraint) ?? [],
				inScheme: swapList(s.inScheme) ?? [],
				values: swapList(s.values) ?? [],
				constraint: swap(s.constraint),
			})),
		}));

		success = true;
		return {
			...p,
			namespaces,
			descriptions,
			updatedAt: new Date().toISOString(),
		};
	});
	return success;
}
