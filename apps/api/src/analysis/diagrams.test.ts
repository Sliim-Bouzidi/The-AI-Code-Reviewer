import { describe, expect, it } from 'vitest';
import { buildDiagram, esc } from './diagrams.js';
import type { GraphData } from './diagrams.js';

const data: GraphData = {
  files: [
    { path: 'apps/api/src/a.ts', language: 'typescript', lines: 10 },
    { path: 'apps/api/src/b.ts', language: 'typescript', lines: 10 },
    { path: 'apps/web/src/c.ts', language: 'typescript', lines: 10 },
    { path: 'packages/db/src/d.ts', language: 'typescript', lines: 10 },
    { path: 'packages/shared/src/e.ts', language: 'typescript', lines: 10 },
  ],
  symbols: [
    { filePath: 'apps/api/src/a.ts', name: 'Child', kind: 'class_declaration', container: null, startLine: 3, endLine: 9 },
    { filePath: 'apps/api/src/a.ts', name: 'run', kind: 'method_definition', container: 'Child', startLine: 4, endLine: 5 },
    { filePath: 'apps/api/src/b.ts', name: 'Base', kind: 'class_declaration', container: null, startLine: 1, endLine: 4 },
    { filePath: 'apps/api/src/b.ts', name: 'Port', kind: 'interface_declaration', container: null, startLine: 6, endLine: 8 },
  ],
  relations: [
    { kind: 'import', fromFile: 'apps/api/src/a.ts', fromSymbol: null, toFile: 'apps/api/src/b.ts', toSymbol: null, toExternal: null, confidence: 'exact' },
    { kind: 'import', fromFile: 'apps/api/src/a.ts', fromSymbol: null, toFile: 'packages/db/src/d.ts', toSymbol: null, toExternal: null, confidence: 'inferred' },
    { kind: 'import', fromFile: 'apps/web/src/c.ts', fromSymbol: null, toFile: 'packages/shared/src/e.ts', toSymbol: null, toExternal: null, confidence: 'exact' },
    { kind: 'import', fromFile: 'apps/web/src/c.ts', fromSymbol: null, toFile: null, toSymbol: null, toExternal: 'react', confidence: 'exact' },
    { kind: 'import', fromFile: 'apps/web/src/c.ts', fromSymbol: null, toFile: null, toSymbol: null, toExternal: '@/x', confidence: 'unresolved' },
    { kind: 'extends', fromFile: 'apps/api/src/a.ts', fromSymbol: 'Child', toFile: 'apps/api/src/b.ts', toSymbol: 'Base', toExternal: null, confidence: 'exact' },
    { kind: 'implements', fromFile: 'apps/api/src/a.ts', fromSymbol: 'Child', toFile: 'apps/api/src/b.ts', toSymbol: 'Port', toExternal: null, confidence: 'inferred' },
    { kind: 'extends', fromFile: 'apps/api/src/a.ts', fromSymbol: 'Child', toFile: null, toSymbol: null, toExternal: 'Dup', confidence: 'unresolved' },
  ],
};
const meta = { branch: 'main', commitSha: 'abc' };

describe('diagrams', () => {
  it('packages: groups files by directory, counts imports, dots non-exact links', () => {
    const d = buildDiagram('packages', data, { depth: 2 }, meta);
    const label = (id: string) => d.nodes.find((n) => n.id === id)!.label;
    expect(d.nodes.map((n) => n.label).sort()).toEqual(['apps/api (2 files)', 'apps/web (1 files)', 'packages/db (1 files)', 'packages/shared (1 files)']);
    expect(d.edges).toHaveLength(2); // a->b stays inside apps/api; external and unresolved imports are not edges
    const api = d.edges.find((e) => label(e.from).startsWith('apps/api'))!;
    expect(label(api.to)).toContain('packages/db');
    expect(api.confidence).toBe('inferred');
    expect(d.mermaid).toContain('-.->|1|');
    expect(d.mermaid).toContain('-->|1|');
  });

  it('dependencies: file edges only between known files, externals only on request', () => {
    const hidden = buildDiagram('dependencies', data, {}, meta);
    expect(hidden.nodes.every((n) => n.kind === 'file')).toBe(true);
    expect(hidden.edges).toHaveLength(3);
    const shown = buildDiagram('dependencies', data, { external: true }, meta);
    expect(shown.nodes.some((n) => n.kind === 'external' && n.label === 'react')).toBe(true);
    expect(shown.nodes.some((n) => n.label === '@/x')).toBe(false); // unresolved aliases are never drawn
  });

  it('classes: UML text with methods, interface stereotype, and inheritance from the stored relations', () => {
    const d = buildDiagram('classes', data, {}, meta);
    expect(d.mermaid.startsWith('classDiagram')).toBe(true);
    expect(d.mermaid).toContain('+run()');
    expect(d.mermaid).toContain('<<interface>>');
    expect(d.mermaid).toMatch(/C\d <\|-- C\d\n/); // Base <|-- Child (exact: no label)
    expect(d.mermaid).toMatch(/<\|\.\. C\d : inferred/);
    expect(d.edges).toHaveLength(2); // the ambiguous `Dup` is not drawn
    expect(d.nodes.find((n) => n.label === 'Child')).toMatchObject({ path: 'apps/api/src/a.ts', line: 3 });
  });

  it('respects the scope', () => {
    const d = buildDiagram('classes', data, { scope: 'apps/web' }, meta);
    expect(d.nodes).toHaveLength(0);
  });

  it('escapes labels coming from untrusted repositories', () => {
    expect(esc('a"b<script>`x`\nnew')).toBe("a#quot;b#lt;script#gt;'x' new");
    const d = buildDiagram('packages', { ...data, files: [{ path: 'x"]\nclick/y.ts', language: 'typescript', lines: 1 }], relations: [] }, { depth: 1 }, meta);
    expect(d.mermaid).not.toMatch(/\nclick/);
    expect(d.mermaid).not.toContain('x"]');
  });
});
