import { describe, expect, it } from 'vitest';
import { changedSymbols, chunkFileBySymbol, parseFile } from './symbols.js';

const TS = `import { db } from './db';

export function getUser(id: string) {
  return query(id);
}

export class Store {
  save(user: User) {
    return db.insert(user);
  }
}

const helper = (n: number) => double(n) + 1;
`;

describe('Tree-sitter symbols', () => {
  it('finds functions, methods and arrow functions with their calls', async () => {
    const parsed = await parseFile('src/a.ts', TS);
    expect(parsed).not.toBeNull();
    const names = parsed!.symbols.map((s) => s.name);
    expect(names).toEqual(expect.arrayContaining(['getUser', 'Store', 'save', 'helper']));
    expect(parsed!.symbols.find((s) => s.name === 'getUser')!.calls).toContain('query');
    expect(parsed!.symbols.find((s) => s.name === 'helper')!.calls).toContain('double');
    expect(parsed!.imports[0]).toContain("from './db'");
  });

  it('maps changed lines to the symbols that contain them', async () => {
    const parsed = (await parseFile('src/a.ts', TS))!;
    const touched = changedSymbols(parsed, new Set([10])); // inside Store.save
    expect(touched.map((s) => s.name)).toContain('save');
    expect(touched.map((s) => s.name)).not.toContain('getUser');
  });

  it('chunks by symbol and names each chunk', async () => {
    const chunks = await chunkFileBySymbol('src/a.ts', TS);
    expect(chunks.map((c) => c.symbol)).toEqual(expect.arrayContaining(['getUser', 'save', 'helper']));
    const getUser = chunks.find((c) => c.symbol === 'getUser')!;
    expect(getUser.content).toContain('return query(id)');
    expect(getUser.startLine).toBe(3);
  });

  it('parses python', async () => {
    const parsed = await parseFile('a.py', 'import os\n\ndef load(path):\n    return open(path).read()\n');
    expect(parsed!.symbols.map((s) => s.name)).toContain('load');
    expect(parsed!.symbols[0]!.calls).toContain('open');
  });

  it('falls back to line windows for languages without a grammar', async () => {
    const chunks = await chunkFileBySymbol('notes.md', '# title\n\nsome text\n');
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.symbol).toBeNull();
  });
});

describe('Tree-sitter structure (containers, heritage, imports)', () => {
  it('records the enclosing class, extends and implements of TypeScript symbols', async () => {
    const code = `import a, { b as c } from './x.js';\nimport * as ns from 'pkg';\nexport { e } from './y';\nexport class A extends B implements I, J { m() {} }\ninterface K extends L, M {}\n`;
    const parsed = (await parseFile('src/a.ts', code))!;
    const a = parsed.symbols.find((s) => s.name === 'A')!;
    expect(a.extends).toEqual(['B']);
    expect(a.implements).toEqual(['I', 'J']);
    expect(parsed.symbols.find((s) => s.name === 'm')!.container).toBe('A');
    expect(parsed.symbols.find((s) => s.name === 'K')!.extends).toEqual(['L', 'M']);
    expect(parsed.importRefs.map((r) => r.source)).toEqual(['./x.js', 'pkg', './y']);
    expect(parsed.importRefs[0]!.bindings).toEqual([
      { local: 'a', imported: 'default' },
      { local: 'c', imported: 'b' },
    ]);
  });

  it('parses Java package, imports and base types', async () => {
    const code = `package com.foo;\nimport com.bar.Baz;\nimport com.q.*;\npublic class A extends B implements I, J { void m() {} }\n`;
    const parsed = (await parseFile('A.java', code))!;
    expect(parsed.packageName).toBe('com.foo');
    expect(parsed.importRefs.map((r) => r.source)).toEqual(['com.bar.Baz', 'com.q.*']);
    const a = parsed.symbols.find((s) => s.name === 'A')!;
    expect([a.extends, a.implements]).toEqual([['B'], ['I', 'J']]);
  });

  it('parses Python imports and base classes', async () => {
    const code = `import a.b as c\nfrom .x import y as z, w\nclass A(B, C):\n  def m(self): pass\n`;
    const parsed = (await parseFile('p.py', code))!;
    expect(parsed.importRefs.map((r) => r.source)).toEqual(['a.b', '.x']);
    expect(parsed.importRefs[1]!.bindings).toEqual([
      { local: 'z', imported: 'y' },
      { local: 'w', imported: 'w' },
    ]);
    expect(parsed.symbols.find((s) => s.name === 'A')!.extends).toEqual(['B', 'C']);
  });
});
