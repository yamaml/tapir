/**
 * @fileoverview Export format types.
 * @module types/export
 */

// ── Format Types ────────────────────────────────────────────────

/**
 * RDF serialization formats.
 *
 * All four are N3.Writer formats. JSON-LD is deliberately absent: it
 * was previously advertised here but silently degraded to N-Triples,
 * which lied to callers — re-add it only with a real serializer.
 */
export type RdfFormat = 'turtle' | 'ntriples' | 'nquads' | 'trig';

/** Diagram visual styles. */
export type DiagramStyle = 'color' | 'bw' | 'overview' | 'overview-bw';

/** Diagram output formats. */
export type DiagramFormat = 'svg' | 'png' | 'dot';

/** Tabular output formats. */
export type TabularFormat = 'tsv' | 'csv' | 'xlsx';

/** All supported export targets. */
export type ExportTarget =
	| { type: 'simpledsp'; format: TabularFormat; lang?: 'en' | 'jp' }
	| { type: 'dctap'; format: TabularFormat }
	| { type: 'shacl'; format: RdfFormat }
	| { type: 'shex' }
	| { type: 'dsp'; format: RdfFormat }
	| { type: 'yaml' }
	| { type: 'json' }
	| { type: 'datapackage' }
	| { type: 'diagram'; style: DiagramStyle; format: DiagramFormat };

// ── Parse Result ────────────────────────────────────────────────

/** Parse result with structured errors/warnings. */
export interface ParseResult<T> {
	data: T;
	warnings: ParseMessage[];
	errors: ParseMessage[];
}

/** A single parse issue. */
export interface ParseMessage {
	line?: number;
	field?: string;
	message: string;
}

// ── Generator Warnings ──────────────────────────────────────────

/**
 * A warning produced while generating an export artefact (lossy
 * mapping, sanitised cell, unresolvable prefix, etc.).
 *
 * Generators accept an optional accumulator array so existing
 * call sites keep working; callers that care pass an array and
 * surface the collected messages.
 */
export interface GeneratorWarning {
	message: string;
}

// ── Diagram Export Settings ─────────────────────────────────────

/**
 * Display configuration consumed by the standalone SVG export
 * builder. Structurally compatible with the diagram-settings store's
 * `DiagramSettings` — defined here so converters stay free of
 * store-layer imports.
 */
export interface DiagramExportSettings {
	/** Colour palette: colour for screen, B&W for print. */
	palette: 'color' | 'bw';
	/** Whether cross-reference edges between shapes are drawn. */
	showEdges: boolean;
	/** Whether edge text annotations are drawn (needs `showEdges`). */
	showEdgeLabels: boolean;
	/** Whether the per-row cardinality column renders. */
	showCardinality: boolean;
	/** Whether each statement's human-readable label is shown. */
	showLabel: boolean;
	/** Whether the property IRI is shown. */
	showProperty: boolean;
}
