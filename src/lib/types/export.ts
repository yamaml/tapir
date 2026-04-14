/**
 * @fileoverview Export format types.
 * @module types/export
 */

// ── Format Types ────────────────────────────────────────────────

/** RDF serialization formats. */
export type RdfFormat = 'turtle' | 'jsonld' | 'ntriples' | 'nquads' | 'trig';

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
