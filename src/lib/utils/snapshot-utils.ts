// tapir/src/lib/utils/snapshot-utils.ts
/**
 * Pure utility functions for snapshot change detection and diffing.
 *
 * @module utils/snapshot-utils
 */

import type { TapirProject, Description } from '$lib/types';

/**
 * Computes a hash of a project's semantic content, excluding timestamps.
 * Used for change detection — if the hash changes, the project has unsaved changes.
 */
export function computeContentHash(project: TapirProject): string {
	const content = JSON.stringify({
		id: project.id,
		name: project.name,
		flavor: project.flavor,
		base: project.base,
		namespaces: project.namespaces,
		descriptions: project.descriptions,
	});
	let hash = 5381;
	for (let i = 0; i < content.length; i++) {
		hash = ((hash << 5) + hash + content.charCodeAt(i)) & 0xffffffff;
	}
	return hash.toString(36);
}

/** Summary of changes between two project states. */
export interface DiffSummary {
	descriptionsAdded: number;
	descriptionsRemoved: number;
	statementsAdded: number;
	statementsRemoved: number;
	propertiesChanged: number;
}

/**
 * Computes a summary diff between two project snapshots.
 * Matches descriptions and statements by their stable `id` (UUID).
 *
 * @returns null if either project is missing (e.g. first snapshot has no predecessor)
 */
export function computeSummaryDiff(
	older: TapirProject | null,
	newer: TapirProject
): DiffSummary | null {
	if (!older) return null;

	const olderDescs = new Map(older.descriptions.map((d) => [d.id, d]));
	const newerDescs = new Map(newer.descriptions.map((d) => [d.id, d]));

	let descriptionsAdded = 0;
	let descriptionsRemoved = 0;
	let statementsAdded = 0;
	let statementsRemoved = 0;
	let propertiesChanged = 0;

	// Check for added descriptions
	for (const [id] of newerDescs) {
		if (!olderDescs.has(id)) descriptionsAdded++;
	}

	// Check for removed descriptions
	for (const [id] of olderDescs) {
		if (!newerDescs.has(id)) descriptionsRemoved++;
	}

	// Compare matched descriptions
	for (const [id, newerDesc] of newerDescs) {
		const olderDesc = olderDescs.get(id);
		if (!olderDesc) continue;

		const olderStmts = new Map(olderDesc.statements.map((s) => [s.id, s]));
		const newerStmts = new Map(newerDesc.statements.map((s) => [s.id, s]));

		for (const [sid] of newerStmts) {
			if (!olderStmts.has(sid)) statementsAdded++;
		}
		for (const [sid] of olderStmts) {
			if (!newerStmts.has(sid)) statementsRemoved++;
		}
		for (const [sid, newerStmt] of newerStmts) {
			const olderStmt = olderStmts.get(sid);
			if (olderStmt && olderStmt.propertyId !== newerStmt.propertyId) {
				propertiesChanged++;
			}
		}
	}

	return { descriptionsAdded, descriptionsRemoved, statementsAdded, statementsRemoved, propertiesChanged };
}

/**
 * Formats a DiffSummary into a human-readable one-line string.
 */
export function formatDiffSummary(diff: DiffSummary | null): string {
	if (!diff) return 'Initial version';

	const parts: string[] = [];
	if (diff.descriptionsAdded > 0) parts.push(`+${diff.descriptionsAdded} description${diff.descriptionsAdded > 1 ? 's' : ''}`);
	if (diff.descriptionsRemoved > 0) parts.push(`-${diff.descriptionsRemoved} description${diff.descriptionsRemoved > 1 ? 's' : ''}`);
	if (diff.statementsAdded > 0) parts.push(`+${diff.statementsAdded} statement${diff.statementsAdded > 1 ? 's' : ''}`);
	if (diff.statementsRemoved > 0) parts.push(`-${diff.statementsRemoved} statement${diff.statementsRemoved > 1 ? 's' : ''}`);
	if (diff.propertiesChanged > 0) parts.push(`~${diff.propertiesChanged} propert${diff.propertiesChanged > 1 ? 'ies' : 'y'} changed`);

	return parts.length > 0 ? parts.join(', ') : 'No changes';
}
