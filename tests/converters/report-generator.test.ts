import { describe, it, expect } from 'vitest';
import { generateHtmlReport } from '$lib/converters/report-generator';
import { createProject, createDescription, createStatement } from '$lib/types/profile';
import type { TapirProject } from '$lib/types';

function dctapProject(overrides?: Partial<TapirProject>): TapirProject {
	return createProject({ name: 'Report', flavor: 'dctap', ...overrides });
}

/** Extracts the cells of the first <tr> in the statements table body. */
function firstRowCells(html: string): string[] {
	const bodyRows = html.match(/<tr>[\s\S]*?<\/tr>/g) ?? [];
	// Skip header rows (which use <th>); find the first row with <td>.
	const dataRow = bodyRows.find((r) => r.includes('<td>'));
	if (!dataRow) return [];
	return [...dataRow.matchAll(/<td>([\s\S]*?)<\/td>/g)].map((m) => m[1].trim());
}

describe('generateHtmlReport — DCTAP cardinality', () => {
	it('distinguishes unspecified (blank) from unbounded (TRUE) repeatable', () => {
		const project = dctapProject();
		project.descriptions = [
			createDescription({
				name: 'S',
				statements: [
					// max undefined = unspecified → blank
					createStatement({ propertyId: 'ex:a', valueType: ['literal'] }),
					// max null = explicitly unbounded → TRUE
					createStatement({ propertyId: 'ex:b', valueType: ['literal'], max: null }),
					// max 1 = not repeatable → FALSE
					createStatement({ propertyId: 'ex:c', valueType: ['literal'], max: 1 }),
				],
			}),
		];

		const html = generateHtmlReport(project);
		// Column order: name, property, min(mandatory), max(repeatable), ...
		// Pull every row's repeatable (4th) cell.
		const rows = (html.match(/<tr>[\s\S]*?<\/tr>/g) ?? []).filter((r) => r.includes('<td>'));
		const repeatables = rows.map(
			(r) => [...r.matchAll(/<td>([\s\S]*?)<\/td>/g)].map((m) => m[1].trim())[3]
		);
		expect(repeatables[0]).toBe(''); // unspecified
		expect(repeatables[1]).toBe('TRUE'); // unbounded
		expect(repeatables[2]).toBe('FALSE'); // capped at 1
	});

	it('renders mandatory as blank when min is unspecified', () => {
		const project = dctapProject();
		project.descriptions = [
			createDescription({
				name: 'S',
				statements: [createStatement({ propertyId: 'ex:a', valueType: ['literal'] })],
			}),
		];
		const cells = firstRowCells(generateHtmlReport(project));
		// mandatory cell (3rd) blank for unspecified min.
		expect(cells[2]).toBe('');
	});
});
