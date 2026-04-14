/**
 * @fileoverview UI state store.
 *
 * Manages editor mode, panel sizes, and selected description.
 *
 * @module stores/ui-store
 */

import { writable } from 'svelte/store';
import type { SimpleDspLang } from '$lib/types/flavor';

// ── Types ───────────────────────────────────────────────────────

/** Editor mode selection. */
export type EditorMode = 'customized' | 'smart-table' | 'raw-table';

// ── Stores ──────────────────────────────────────────────────────

/** Currently active editor mode. */
export const editorMode = writable<EditorMode>('customized');

/** ID of the currently selected description in the sidebar. */
export const selectedDescriptionId = writable<string | null>(null);

/** Whether the diagram panel is visible. */
export const diagramVisible = writable(true);

/**
 * Active language for SimpleDSP label/column rendering.
 *
 * DCTAP projects ignore this store. For SimpleDSP, `en` renders OWL-DSP
 * English labels; `jp` renders the original MetaBridge Japanese labels.
 * Hydrated from persisted UserPrefs at editor mount.
 */
export const simpleDspLang = writable<SimpleDspLang>('en');

/** Whether Smart Table assistance is enabled. */
export const assistanceEnabled = writable(true);
