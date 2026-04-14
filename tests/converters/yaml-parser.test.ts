import { describe, it, expect } from 'vitest';
import { parseYamaYaml } from '$lib/converters/yaml-parser';

// ── parseYamaYaml ───────────────────────────────────────────────

describe('parseYamaYaml', () => {
	it('parses empty document with warning', () => {
		const result = parseYamaYaml('{}');
		expect(result.errors).toHaveLength(0);
		expect(result.warnings.length).toBeGreaterThan(0);
		expect(result.data.descriptions).toHaveLength(0);
	});

	it('parses base IRI', () => {
		const yaml = `
base: http://example.org/
descriptions: {}
`;
		const result = parseYamaYaml(yaml);
		expect(result.errors).toHaveLength(0);
		expect(result.data.base).toBe('http://example.org/');
	});

	it('parses namespaces', () => {
		const yaml = `
namespaces:
  foaf: http://xmlns.com/foaf/0.1/
  xsd: http://www.w3.org/2001/XMLSchema#
descriptions: {}
`;
		const result = parseYamaYaml(yaml);
		expect(result.errors).toHaveLength(0);
		expect(result.data.namespaces['foaf']).toBe('http://xmlns.com/foaf/0.1/');
		expect(result.data.namespaces['xsd']).toBe('http://www.w3.org/2001/XMLSchema#');
	});

	it('parses a description with targetClass', () => {
		const yaml = `
descriptions:
  person:
    a: foaf:Person
    label: Person
    note: A person entity
`;
		const result = parseYamaYaml(yaml);
		expect(result.errors).toHaveLength(0);
		expect(result.data.descriptions).toHaveLength(1);

		const desc = result.data.descriptions[0];
		expect(desc.name).toBe('person');
		expect(desc.targetClass).toBe('foaf:Person');
		expect(desc.label).toBe('Person');
		expect(desc.note).toBe('A person entity');
	});

	it('parses statements with full properties', () => {
		const yaml = `
descriptions:
  person:
    a: foaf:Person
    statements:
      name:
        property: foaf:name
        label: Name
        min: 1
        max: 1
        type: literal
        datatype: xsd:string
        note: Full name
`;
		const result = parseYamaYaml(yaml);
		expect(result.errors).toHaveLength(0);

		const stmt = result.data.descriptions[0].statements[0];
		expect(stmt.id).toBe('name');
		expect(stmt.propertyId).toBe('foaf:name');
		expect(stmt.label).toBe('Name');
		expect(stmt.min).toBe(1);
		expect(stmt.max).toBe(1);
		expect(stmt.valueType).toBe('literal');
		expect(stmt.datatype).toBe('xsd:string');
		expect(stmt.note).toBe('Full name');
	});

	it('resolves IRI value type', () => {
		const yaml = `
descriptions:
  person:
    statements:
      homepage:
        property: foaf:homepage
        type: IRI
`;
		const result = parseYamaYaml(yaml);
		const stmt = result.data.descriptions[0].statements[0];
		expect(stmt.valueType).toBe('iri');
	});

	it('resolves BNODE value type', () => {
		const yaml = `
descriptions:
  person:
    statements:
      address:
        property: foaf:address
        type: BNODE
`;
		const result = parseYamaYaml(yaml);
		const stmt = result.data.descriptions[0].statements[0];
		expect(stmt.valueType).toBe('bnode');
	});

	it('parses shape references (description field)', () => {
		const yaml = `
descriptions:
  person:
    statements:
      knows:
        property: foaf:knows
        type: IRI
        description: person
`;
		const result = parseYamaYaml(yaml);
		const stmt = result.data.descriptions[0].statements[0];
		expect(stmt.shapeRefs).toEqual(['person']);
	});

	it('parses value sets', () => {
		const yaml = `
descriptions:
  person:
    statements:
      gender:
        property: schema:gender
        values:
          - male
          - female
          - other
`;
		const result = parseYamaYaml(yaml);
		const stmt = result.data.descriptions[0].statements[0];
		expect(stmt.values).toEqual(['male', 'female', 'other']);
	});

	it('parses pattern', () => {
		const yaml = `
descriptions:
  person:
    statements:
      email:
        property: schema:email
        pattern: "^[a-z]+@"
`;
		const result = parseYamaYaml(yaml);
		const stmt = result.data.descriptions[0].statements[0];
		expect(stmt.pattern).toBe('^[a-z]+@');
	});

	it('returns error for invalid YAML', () => {
		const result = parseYamaYaml('{ invalid yaml: [');
		expect(result.errors.length).toBeGreaterThan(0);
		expect(result.errors[0].message).toContain('YAML parse error');
	});

	it('returns error for non-mapping input', () => {
		const result = parseYamaYaml('- a list item');
		expect(result.errors.length).toBeGreaterThan(0);
	});

	it('uses provided project name', () => {
		const result = parseYamaYaml('{}', 'My Project');
		expect(result.data.name).toBe('My Project');
	});

	it('parses multiple descriptions', () => {
		const yaml = `
descriptions:
  person:
    a: foaf:Person
    statements:
      name:
        property: foaf:name
  book:
    a: schema:Book
    statements:
      title:
        property: schema:name
`;
		const result = parseYamaYaml(yaml);
		expect(result.errors).toHaveLength(0);
		expect(result.data.descriptions).toHaveLength(2);
		expect(result.data.descriptions[0].name).toBe('person');
		expect(result.data.descriptions[1].name).toBe('book');
	});

	it('handles null min/max as null', () => {
		const yaml = `
descriptions:
  person:
    statements:
      name:
        property: foaf:name
`;
		const result = parseYamaYaml(yaml);
		const stmt = result.data.descriptions[0].statements[0];
		expect(stmt.min).toBeNull();
		expect(stmt.max).toBeNull();
	});

	it('parses the manga example structure', () => {
		const yaml = `
base: http://purl.org/yama/examples/2024/manga/0.1/
namespaces:
  schema: http://schema.org/
  xsd: http://www.w3.org/2001/XMLSchema#
descriptions:
  series:
    a: schema:ComicSeries
    label: Manga Series
    note: A manga series or title
    statements:
      title:
        label: Title
        property: schema:name
        min: 1
        max: 1
        type: literal
        datatype: xsd:string
      author:
        label: Author
        property: schema:author
        min: 1
        type: IRI
        description: creator
  creator:
    a: foaf:Person
    label: Creator
    statements:
      name:
        label: Name
        property: schema:name
        min: 1
        max: 1
        type: literal
        datatype: xsd:string
`;
		const result = parseYamaYaml(yaml);
		expect(result.errors).toHaveLength(0);
		expect(result.data.base).toBe('http://purl.org/yama/examples/2024/manga/0.1/');
		expect(result.data.descriptions).toHaveLength(2);

		const series = result.data.descriptions[0];
		expect(series.targetClass).toBe('schema:ComicSeries');
		expect(series.label).toBe('Manga Series');
		expect(series.statements).toHaveLength(2);

		const author = series.statements[1];
		expect(author.shapeRefs).toEqual(['creator']);
		expect(author.valueType).toBe('iri');
		expect(author.min).toBe(1);
		expect(author.max).toBeNull();
	});
});
