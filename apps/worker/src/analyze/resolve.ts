import { posix } from 'node:path';
import { typeKindOf } from '@codereview/shared';
import type { Confidence, RelationKind } from '@codereview/shared';
import type { ParsedFile, Symbol } from '../index/symbols.js';
import { EMPTY_CONFIG } from './project-config.js';
import type { ProjectConfig } from './project-config.js';

/** One source file with what the parser found in it (`parsed` is null for languages without a grammar). */
export interface AnalyzedFile {
  path: string;
  language: string | null;
  lines: number;
  parsed: ParsedFile | null;
}

export interface RelationRow {
  kind: RelationKind;
  fromFile: string;
  fromSymbol: string | null;
  toFile: string | null;
  toSymbol: string | null;
  toExternal: string | null;
  confidence: Confidence;
  line: number | null;
}

interface Target {
  toFile: string | null;
  toSymbol: string | null;
  toExternal: string | null;
  confidence: Confidence;
}

/** What an import binds a local name to: a file of the repository, or something outside it. */
interface Binding {
  file: string | null;
  external: string | null;
  imported: string;
  /** Confidence of the import itself: what depends on it can never be more certain. */
  confidence: Confidence;
}

const JS_LANGS = new Set(['typescript', 'tsx', 'javascript']);
const JS_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs'];

function resolveJsPath(base: string, paths: Set<string>): string | null {
  const stripped = base.replace(/\.[cm]?jsx?$/, ''); // TypeScript sources import './x.js' for ./x.ts
  const candidates = [
    base,
    ...JS_EXTS.map((e) => stripped + e),
    ...JS_EXTS.map((e) => `${stripped}/index${e}`),
    ...JS_EXTS.map((e) => `${base}/index${e}`),
  ];
  return candidates.find((c) => paths.has(c)) ?? null;
}

function packageOf(spec: string): string {
  if (spec.startsWith('node:')) return spec;
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!;
}

/**
 * Turns the raw parse results of a repository into relations between files and symbols.
 * Pure and deterministic: nothing is guessed beyond the three confidence levels, and a relation whose
 * target cannot be established is kept as `unresolved` instead of being dropped or presented as certain.
 * Supported: TypeScript / JavaScript, Python and Java (other languages only contribute files and symbols).
 */
export function resolveRelations(files: AnalyzedFile[], config: ProjectConfig = EMPTY_CONFIG): RelationRow[] {
  const paths = new Set(files.map((f) => f.path));
  const topDirs = new Set(files.filter((f) => f.path.includes('/')).map((f) => f.path.split('/')[0]!));
  const byPath = new Map(files.map((f) => [f.path, f]));

  // every class / interface / enum of the repository, by bare name and (Java) by qualified name
  const typesByName = new Map<string, { file: string; name: string }[]>();
  const javaTypes = new Map<string, string>(); // com.foo.Bar -> file
  for (const f of files) {
    for (const s of f.parsed?.symbols ?? []) {
      if (!typeKindOf(s.kind)) continue;
      const list = typesByName.get(s.name) ?? [];
      list.push({ file: f.path, name: s.name });
      typesByName.set(s.name, list);
      if (f.language === 'java' && !s.container && f.parsed?.packageName) javaTypes.set(`${f.parsed.packageName}.${s.name}`, f.path);
    }
  }

  const rows = new Map<string, RelationRow>();
  const add = (row: RelationRow) => {
    const key = [row.kind, row.fromFile, row.fromSymbol, row.toFile, row.toSymbol, row.toExternal].join('\u0000');
    if (!rows.has(key)) rows.set(key, row);
  };

  // ---- imports ----
  const bindingsByFile = new Map<string, Map<string, Binding>>();
  const wildcardPackages = new Map<string, string[]>(); // Java `import com.foo.*`

  for (const f of files) {
    if (!f.parsed || !f.language) continue;
    const bindings = new Map<string, Binding>();
    bindingsByFile.set(f.path, bindings);
    for (const ref of f.parsed.importRefs) {
      let target: Target | null = null;
      if (JS_LANGS.has(f.language)) target = resolveJsImport(f.path, ref.source, paths, topDirs, config);
      else if (f.language === 'python') target = resolvePythonImport(f.path, ref.source, ref.bindings.map((b) => b.imported), paths);
      else if (f.language === 'java') {
        if (ref.source.endsWith('.*')) {
          const list = wildcardPackages.get(f.path) ?? [];
          list.push(ref.source.slice(0, -2));
          wildcardPackages.set(f.path, list);
          continue;
        }
        const file = javaTypes.get(ref.source);
        target = file
          ? { toFile: file, toSymbol: null, toExternal: null, confidence: 'exact' }
          : { toFile: null, toSymbol: null, toExternal: ref.source, confidence: 'exact' };
      }
      if (!target) continue;
      add({ kind: 'import', fromFile: f.path, fromSymbol: null, ...target, line: ref.line });
      for (const b of ref.bindings) {
        bindings.set(b.local, { file: target.toFile, external: target.toExternal, imported: b.imported, confidence: target.confidence });
      }
    }
  }

  const typeSymbol = (file: string, name: string): Symbol | undefined =>
    byPath.get(file)?.parsed?.symbols.find((s) => s.name === name && typeKindOf(s.kind) && !s.container);

  /** Target of a base type named in `from`: its own file, an import, its Java package, or a unique name. */
  const resolveType = (from: AnalyzedFile, name: string): Target => {
    const binding = bindingsByFile.get(from.path)?.get(name);
    if (binding?.file) {
      const wanted = binding.imported === 'default' || binding.imported === '*' ? name : binding.imported;
      const found = typeSymbol(binding.file, wanted);
      if (found) return { toFile: binding.file, toSymbol: found.name, toExternal: null, confidence: binding.confidence === 'exact' ? 'exact' : 'inferred' };
      const global = typesByName.get(wanted);
      if (global?.length === 1) return { toFile: global[0]!.file, toSymbol: wanted, toExternal: null, confidence: 'inferred' };
      return { toFile: binding.file, toSymbol: wanted, toExternal: null, confidence: 'inferred' };
    }
    if (binding?.external) return { toFile: null, toSymbol: null, toExternal: name, confidence: binding.confidence };
    if (typeSymbol(from.path, name)) return { toFile: from.path, toSymbol: name, toExternal: null, confidence: 'exact' };
    if (from.language === 'java') {
      const pkg = from.parsed?.packageName;
      const same = pkg ? javaTypes.get(`${pkg}.${name}`) : undefined;
      if (same) return { toFile: same, toSymbol: name, toExternal: null, confidence: 'exact' };
      for (const w of wildcardPackages.get(from.path) ?? []) {
        const viaWildcard = javaTypes.get(`${w}.${name}`);
        if (viaWildcard) return { toFile: viaWildcard, toSymbol: name, toExternal: null, confidence: 'exact' };
      }
    }
    const candidates = typesByName.get(name) ?? [];
    if (candidates.length === 1) return { toFile: candidates[0]!.file, toSymbol: name, toExternal: null, confidence: 'inferred' };
    if (candidates.length > 1) return { toFile: null, toSymbol: null, toExternal: name, confidence: 'unresolved' };
    return { toFile: null, toSymbol: null, toExternal: name, confidence: 'inferred' }; // not in the repository: library or builtin
  };

  // ---- inheritance and calls ----
  for (const f of files) {
    if (!f.parsed) continue;
    const bindings = bindingsByFile.get(f.path);
    for (const s of f.parsed.symbols) {
      for (const name of s.extends) add({ kind: 'extends', fromFile: f.path, fromSymbol: s.name, ...resolveType(f, name), line: s.startLine });
      for (const name of s.implements) add({ kind: 'implements', fromFile: f.path, fromSymbol: s.name, ...resolveType(f, name), line: s.startLine });

      for (const callee of s.calls) {
        const bound = bindings?.get(callee);
        if (bound?.file && bound.imported !== 'default' && bound.imported !== '*') {
          const target = byPath.get(bound.file)?.parsed?.symbols.find((t) => t.name === bound.imported && !t.container && !typeKindOf(t.kind));
          if (target) {
            add({ kind: 'call', fromFile: f.path, fromSymbol: s.name, toFile: bound.file, toSymbol: target.name, toExternal: null, confidence: bound.confidence === 'exact' ? 'exact' : 'inferred', line: s.startLine });
            continue;
          }
        }
        if (bound) continue; // imported but not a function we can see (library, class, namespace): not a call we can place
        // same file, by bare name: `foo()` and `obj.foo()` look alike to the parser, so this stays "inferred"
        const local = f.parsed.symbols.filter((t) => t.name === callee && t !== s && !typeKindOf(t.kind));
        const sameClass = local.filter((t) => t.container === s.container);
        const pick = sameClass.length === 1 ? sameClass[0] : local.length === 1 ? local[0] : undefined;
        if (pick) add({ kind: 'call', fromFile: f.path, fromSymbol: s.name, toFile: f.path, toSymbol: pick.name, toExternal: null, confidence: 'inferred', line: s.startLine });
      }
    }
  }
  return [...rows.values()];
}

function resolveJsImport(from: string, spec: string, paths: Set<string>, topDirs: Set<string>, config: ProjectConfig): Target {
  const unresolved: Target = { toFile: null, toSymbol: null, toExternal: spec, confidence: 'unresolved' };
  const hit = (toFile: string, confidence: Confidence): Target => ({ toFile, toSymbol: null, toExternal: null, confidence });
  if (spec.startsWith('.')) {
    const found = resolveJsPath(posix.normalize(posix.join(posix.dirname(from), spec)), paths);
    return found ? hit(found, 'exact') : unresolved;
  }

  // path aliases declared in the nearest tsconfig.json that has `paths` (`"@/*": ["./src/*"]`)
  const tsconfig = config.tsconfigs
    .filter((t) => !t.dir || from.startsWith(`${t.dir}/`))
    .sort((a, b) => b.dir.length - a.dir.length)[0];
  if (tsconfig) {
    for (const [pattern, targets] of Object.entries(tsconfig.paths)) {
      const star = pattern.indexOf('*');
      const matches = star === -1 ? spec === pattern : spec.startsWith(pattern.slice(0, star)) && spec.endsWith(pattern.slice(star + 1));
      if (!matches) continue;
      const rest = star === -1 ? '' : spec.slice(star, spec.length - (pattern.length - star - 1));
      for (const target of targets) {
        const base = posix.normalize(posix.join(tsconfig.dir, tsconfig.baseUrl ?? '.', target.replace('*', rest)));
        const found = resolveJsPath(base, paths);
        if (found) return hit(found, 'exact'); // the repository's own configuration names the target
      }
    }
  }
  if (/^(@\/|~\/|#|\$)/.test(spec)) return unresolved; // an alias no configuration file explains

  // another package of the same monorepo, imported by its package.json name
  const name = [...config.workspacePackages.keys()].filter((n) => spec === n || spec.startsWith(`${n}/`)).sort((a, b) => b.length - a.length)[0];
  if (name) {
    const dir = config.workspacePackages.get(name)!;
    const sub = spec.slice(name.length + 1);
    const candidates = sub
      ? [posix.join(dir, 'src', sub), posix.join(dir, sub)]
      : [posix.join(dir, 'src', 'index'), posix.join(dir, 'index')]; // entry point guessed from the usual layout
    for (const c of candidates) {
      const found = resolveJsPath(posix.normalize(c), paths);
      if (found) return hit(found, 'inferred');
    }
  }
  if (topDirs.has(spec.split('/')[0]!)) {
    const found = resolveJsPath(posix.normalize(spec), paths); // baseUrl-style import from the repository root
    if (found) return hit(found, 'inferred');
  }
  return { toFile: null, toSymbol: null, toExternal: packageOf(spec), confidence: 'exact' };
}

function resolvePythonImport(from: string, spec: string, imported: string[], paths: Set<string>): Target {
  const module = (dotted: string) => [`${dotted.replace(/\./g, '/')}.py`, `${dotted.replace(/\./g, '/')}/__init__.py`];
  const found = (file: string, confidence: Confidence): Target => ({ toFile: file, toSymbol: null, toExternal: null, confidence });
  if (spec.startsWith('.')) {
    const dots = /^\.+/.exec(spec)![0].length;
    let dir = posix.dirname(from);
    for (let i = 1; i < dots; i++) dir = posix.dirname(dir);
    const rest = spec.slice(dots);
    const bases = rest ? [rest] : imported; // `from . import x` -> x is a sibling module
    for (const b of bases) {
      for (const c of module(b)) {
        const candidate = posix.normalize(posix.join(dir, c));
        if (paths.has(candidate)) return found(candidate, 'exact');
      }
    }
    return { toFile: null, toSymbol: null, toExternal: spec, confidence: 'unresolved' };
  }
  const wanted = module(spec);
  const exact = wanted.find((c) => paths.has(c));
  if (exact) return found(exact, 'exact');
  const suffix = [...paths].filter((p) => wanted.some((c) => p.endsWith(`/${c}`)));
  if (suffix.length === 1) return found(suffix[0]!, 'inferred'); // package root unknown (src/, app/ ...)
  if (suffix.length > 1) return { toFile: null, toSymbol: null, toExternal: spec, confidence: 'unresolved' };
  return { toFile: null, toSymbol: null, toExternal: spec.split('.')[0]!, confidence: 'exact' }; // stdlib or third-party package
}
