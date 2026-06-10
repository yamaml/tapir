import { describe, it, expect } from 'vitest';
import { computeContentHash } from '$lib/utils/snapshot-utils';
import { createProject } from '$lib/types';

// ── Tests ───────────────────────────────────────────────────────

describe('computeContentHash', () => {
	it('is stable for identical content', () => {
		const p = createProject({ name: 'X', flavor: 'simpledsp' });
		expect(computeContentHash(p)).toBe(computeContentHash({ ...p }));
	});

	it('ignores timestamp-only changes', () => {
		const p = createProject({ name: 'X', flavor: 'simpledsp' });
		const h1 = computeContentHash(p);
		const h2 = computeContentHash({ ...p, updatedAt: '2099-01-01T00:00:00Z' });
		expect(h2).toBe(h1);
	});

	it('changes when the project description changes', () => {
		const p = createProject({ name: 'X', flavor: 'simpledsp' });
		const h1 = computeContentHash(p);
		const h2 = computeContentHash({ ...p, description: 'a new subtitle' });
		expect(h2).not.toBe(h1);
	});

	it('changes when the name or namespaces change', () => {
		const p = createProject({ name: 'X', flavor: 'simpledsp' });
		const h = computeContentHash(p);
		expect(computeContentHash({ ...p, name: 'Y' })).not.toBe(h);
		expect(
			computeContentHash({ ...p, namespaces: { ex: 'http://example.org/' } })
		).not.toBe(h);
	});
});
