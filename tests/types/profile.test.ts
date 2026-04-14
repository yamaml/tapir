import { describe, it, expect } from 'vitest';
import {
	createProject,
	createDescription,
	createStatement,
} from '$lib/types/profile';
import { getFlavorLabels } from '$lib/types/flavor';

describe('createProject', () => {
	it('creates a project with defaults', () => {
		const project = createProject({ name: 'Test', flavor: 'simpledsp' });
		expect(project.id).toBeTruthy();
		expect(project.name).toBe('Test');
		expect(project.flavor).toBe('simpledsp');
		expect(project.descriptions).toEqual([]);
		expect(project.namespaces).toEqual({});
		expect(project.base).toBe('');
		expect(project.createdAt).toBeTruthy();
		expect(project.updatedAt).toBeTruthy();
	});

	it('allows overriding defaults', () => {
		const project = createProject({
			name: 'Custom',
			flavor: 'dctap',
			base: 'http://example.org/',
			namespaces: { foaf: 'http://xmlns.com/foaf/0.1/' },
		});
		expect(project.flavor).toBe('dctap');
		expect(project.base).toBe('http://example.org/');
		expect(project.namespaces.foaf).toBe('http://xmlns.com/foaf/0.1/');
	});
});

describe('createDescription', () => {
	it('creates a description with defaults', () => {
		const desc = createDescription({ name: 'character' });
		expect(desc.id).toBeTruthy();
		expect(desc.name).toBe('character');
		expect(desc.label).toBe('');
		expect(desc.targetClass).toBe('');
		expect(desc.closed).toBe(false);
		expect(desc.statements).toEqual([]);
	});
});

describe('createStatement', () => {
	it('creates a statement with defaults', () => {
		const stmt = createStatement({ propertyId: 'foaf:name' });
		expect(stmt.id).toBeTruthy();
		expect(stmt.propertyId).toBe('foaf:name');
		expect(stmt.min).toBeNull();
		expect(stmt.max).toBeNull();
		expect(stmt.valueType).toBe('');
		expect(stmt.values).toEqual([]);
		expect(stmt.facets).toEqual({});
		expect(stmt.inScheme).toEqual([]);
		expect(stmt.classConstraint).toEqual([]);
		expect(stmt.cardinalityNote).toBe('');
		expect(stmt.shapeRefs).toEqual([]);
	});

	it('creates with no arguments', () => {
		const stmt = createStatement();
		expect(stmt.id).toBeTruthy();
		expect(stmt.propertyId).toBe('');
	});
});

describe('getFlavorLabels', () => {
	it('returns SimpleDSP English labels', () => {
		const labels = getFlavorLabels('simpledsp', 'en');
		expect(labels.descriptionSingular).toBe('Description Template');
		expect(labels.statementSingular).toBe('Statement Template');
		expect(labels.columns.name).toBe('Name');
		expect(labels.valueTypes.literal).toBe('literal');
		expect(labels.valueTypes.iri).toBe('IRI');
	});

	it('returns SimpleDSP Japanese labels', () => {
		const labels = getFlavorLabels('simpledsp', 'jp');
		expect(labels.descriptionSingular).toBe('レコード記述規則');
		expect(labels.statementSingular).toBe('項目記述規則');
		expect(labels.columns.name).toBe('項目規則名');
		expect(labels.valueTypes.literal).toBe('文字列');
	});

	it('returns DCTAP labels', () => {
		const labels = getFlavorLabels('dctap');
		expect(labels.descriptionSingular).toBe('Shape');
		expect(labels.statementSingular).toBe('Statement');
		expect(labels.columns.property).toBe('propertyID');
		expect(labels.valueTypes.iri).toBe('IRI');
	});

	it('defaults to English for SimpleDSP', () => {
		const labels = getFlavorLabels('simpledsp');
		expect(labels.descriptionSingular).toBe('Description Template');
	});
});
