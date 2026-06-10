/**
 * @fileoverview YAMA JSON generator.
 *
 * Converts a `TapirProject` to a YAMA-format JSON string. The JSON
 * structure mirrors the YAMA YAML format exactly — both formats are
 * produced from the same document-object builder
 * (`buildYamaDocumentObject` in `yaml-generator.ts`), so field
 * coverage cannot diverge: `a`/class constraints, `inScheme`,
 * `closed`, `cardinalityNote`, and `languageTag` all serialize
 * identically in YAML and JSON.
 *
 * @module converters/json-generator
 */

import type { TapirProject } from '$lib/types';
import { buildYamaDocumentObject } from './yaml-generator';

// ── Main Generator ──────────────────────────────────────────────

/**
 * Generates a YAMA-format JSON string from a `TapirProject`.
 *
 * @param project - The Tapir project to export.
 * @param indent - JSON indentation (defaults to 2 spaces).
 * @returns YAMA JSON string.
 *
 * @example
 * const json = buildYamaJson(project);
 * console.log(json);
 */
export function buildYamaJson(project: TapirProject, indent: number = 2): string {
	return JSON.stringify(buildYamaDocumentObject(project), null, indent);
}
