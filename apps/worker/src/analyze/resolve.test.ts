import { describe, expect, it } from 'vitest';
import type { ParsedFile, Symbol } from '../index/symbols.js';
import { readProjectConfig } from './project-config.js';
import { resolveRelations } from './resolve.js';
import type { AnalyzedFile } from './resolve.js';

const sym = (name: string, kind: string, extra: Partial<Symbol> = {}): Symbol => ({
  name, kind, startLine: 1, endLine: 2, calls: [], container: null, extends: [], implements: [], ...extra,
});
const parsed = (p: Partial<ParsedFile>): ParsedFile => ({ symbols: [], imports: [], importRefs: [], packageName: null, ...p });
const file = (path: string, language: string, p: Partial<ParsedFile>): AnalyzedFile => ({ path, language, lines: 10, parsed: parsed(p) });
const find = (rows: ReturnType<typeof resolveRelations>, kind: string, from: string) => rows.filter((r) => r.kind === kind && r.fromFile === from);

describe('resolveRelations: TypeScript', () => {
  const files = [
    file('src/a.ts', 'typescript', {
      importRefs: [
        { source: './b.js', bindings: [{ local: 'Base', imported: 'Base' }, { local: 'helper', imported: 'helper' }], line: 1 },
        { source: 'zod', bindings: [{ local: 'z', imported: 'z' }], line: 2 },
        { source: '@/lib/x', bindings: [{ local: 'X', imported: 'X' }], line: 3 },
        { source: './missing', bindings: [], line: 4 },
      ],
      symbols: [
        sym('Child', 'class_declaration', { extends: ['Base'], implements: ['Port', 'X'] }),
        sym('run', 'method_definition', { container: 'Child', calls: ['helper', 'local', 'unknown'] }),
        sym('local', 'function_declaration'),
        sym('Port', 'interface_declaration'),
      ],
    }),
    file('src/b.ts', 'typescript', { symbols: [sym('Base', 'class_declaration'), sym('helper', 'function_declaration')] }),
  ];
  const rows = resolveRelations(files);

  it('resolves relative imports (./b.js -> b.ts), external packages and keeps aliases unresolved', () => {
    const imports = find(rows, 'import', 'src/a.ts');
    expect(imports.find((r) => r.toFile === 'src/b.ts')?.confidence).toBe('exact');
    expect(imports.find((r) => r.toExternal === 'zod')?.confidence).toBe('exact');
    expect(imports.find((r) => r.toExternal === '@/lib/x')?.confidence).toBe('unresolved');
    expect(imports.find((r) => r.toExternal === './missing')?.confidence).toBe('unresolved');
  });

  it('resolves base types through imports, same file, and flags unresolved aliases', () => {
    expect(find(rows, 'extends', 'src/a.ts')[0]).toMatchObject({ toFile: 'src/b.ts', toSymbol: 'Base', confidence: 'exact' });
    const impl = find(rows, 'implements', 'src/a.ts');
    expect(impl.find((r) => r.toSymbol === 'Port')).toMatchObject({ toFile: 'src/a.ts', confidence: 'exact' });
    expect(impl.find((r) => r.toExternal === 'X')?.confidence).toBe('unresolved');
  });

  it('keeps only calls it can place: imported function (exact) and same-file function (inferred)', () => {
    const calls = find(rows, 'call', 'src/a.ts');
    expect(calls.find((r) => r.toSymbol === 'helper')).toMatchObject({ toFile: 'src/b.ts', confidence: 'exact' });
    expect(calls.find((r) => r.toSymbol === 'local')).toMatchObject({ toFile: 'src/a.ts', confidence: 'inferred' });
    expect(calls.some((r) => r.toSymbol === 'unknown')).toBe(false);
  });
});

describe('resolveRelations: Java and Python', () => {
  it('links Java imports and same-package base types by qualified name', () => {
    const rows = resolveRelations([
      file('src/com/foo/A.java', 'java', {
        packageName: 'com.foo',
        importRefs: [{ source: 'com.bar.Baz', bindings: [{ local: 'Baz', imported: 'Baz' }], line: 2 }, { source: 'java.util.List', bindings: [{ local: 'List', imported: 'List' }], line: 3 }],
        symbols: [sym('A', 'class_declaration', { extends: ['Baz'], implements: ['Port'] })],
      }),
      file('src/com/bar/Baz.java', 'java', { packageName: 'com.bar', symbols: [sym('Baz', 'class_declaration')] }),
      file('src/com/foo/Port.java', 'java', { packageName: 'com.foo', symbols: [sym('Port', 'interface_declaration')] }),
    ]);
    expect(rows.find((r) => r.kind === 'import' && r.toFile === 'src/com/bar/Baz.java')?.confidence).toBe('exact');
    expect(rows.find((r) => r.kind === 'import' && r.toExternal === 'java.util.List')).toBeTruthy();
    expect(rows.find((r) => r.kind === 'implements')).toMatchObject({ toFile: 'src/com/foo/Port.java', confidence: 'exact' });
  });

  it('resolves Python relative imports exactly and absolute ones by suffix as inferred', () => {
    const rows = resolveRelations([
      file('pkg/a.py', 'python', {
        importRefs: [
          { source: '.b', bindings: [{ local: 'f', imported: 'f' }], line: 1 },
          { source: 'util.io', bindings: [{ local: 'io', imported: '*' }], line: 2 },
          { source: 'os.path', bindings: [{ local: 'os', imported: '*' }], line: 3 },
        ],
      }),
      file('pkg/b.py', 'python', {}),
      file('src/util/io.py', 'python', {}),
    ]);
    expect(rows.find((r) => r.toFile === 'pkg/b.py')?.confidence).toBe('exact');
    expect(rows.find((r) => r.toFile === 'src/util/io.py')?.confidence).toBe('inferred');
    expect(rows.find((r) => r.toExternal === 'os')?.confidence).toBe('exact');
  });

  it('marks a name defined twice in the repository as unresolved instead of guessing', () => {
    const rows = resolveRelations([
      file('a/X.java', 'java', { packageName: 'a', symbols: [sym('X', 'class_declaration')] }),
      file('b/X.java', 'java', { packageName: 'b', symbols: [sym('X', 'class_declaration')] }),
      file('c/Y.java', 'java', { packageName: 'c', symbols: [sym('Y', 'class_declaration', { extends: ['X'] })] }),
    ]);
    expect(rows.find((r) => r.kind === 'extends')).toMatchObject({ toFile: null, confidence: 'unresolved' });
  });
});

describe('resolveRelations: project configuration', () => {
  const files = [
    file('apps/web/src/page.tsx', 'tsx', {
      importRefs: [
        { source: '@/components/button', bindings: [], line: 1 },
        { source: '@acme/db', bindings: [], line: 2 },
        { source: '@acme/db/schema', bindings: [], line: 3 },
        { source: '@/nope', bindings: [], line: 4 },
      ],
    }),
    file('apps/web/src/components/button.tsx', 'tsx', {}),
    file('packages/db/src/index.ts', 'typescript', {}),
    file('packages/db/src/schema.ts', 'typescript', {}),
  ];
  const config = readProjectConfig([
    { path: 'apps/web/tsconfig.json', content: '{ // comment\n "compilerOptions": { "paths": { "@/*": ["./src/*"], }, /* x */ }, }' },
    { path: 'packages/db/package.json', content: '{ "name": "@acme/db" }' },
    { path: 'broken/tsconfig.json', content: '{ not json' },
  ]);

  it('reads JSONC tsconfig paths and package names, ignoring unreadable files', () => {
    expect(config.workspacePackages.get('@acme/db')).toBe('packages/db');
    expect(config.tsconfigs).toEqual([{ dir: 'apps/web', baseUrl: null, paths: { '@/*': ['./src/*'] } }]);
  });

  it('resolves tsconfig aliases (exact) and workspace packages (inferred); unknown aliases stay unresolved', () => {
    const rows = resolveRelations(files, config).filter((r) => r.kind === 'import');
    expect(rows.find((r) => r.toFile === 'apps/web/src/components/button.tsx')?.confidence).toBe('exact');
    expect(rows.find((r) => r.toFile === 'packages/db/src/index.ts')?.confidence).toBe('inferred');
    expect(rows.find((r) => r.toFile === 'packages/db/src/schema.ts')?.confidence).toBe('inferred');
    expect(rows.find((r) => r.toExternal === '@/nope')?.confidence).toBe('unresolved');
  });
});
