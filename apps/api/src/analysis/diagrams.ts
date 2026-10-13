import { typeKindOf } from '@codereview/shared';
import type { Confidence, Diagram, DiagramEdge, DiagramKind, DiagramNode, RelationKind } from '@codereview/shared';

/** The stored graph of one analysis, as read from the database. */
export interface GraphData {
  files: { path: string; language: string | null; lines: number }[];
  symbols: { filePath: string; name: string; kind: string; container: string | null; startLine: number; endLine: number }[];
  relations: {
    kind: RelationKind;
    fromFile: string;
    fromSymbol: string | null;
    toFile: string | null;
    toSymbol: string | null;
    toExternal: string | null;
    confidence: Confidence;
  }[];
}

export interface DiagramOptions {
  scope?: string;
  depth?: number;
  external?: boolean;
  limit?: number;
}

const DEFAULT_LIMIT: Record<DiagramKind, number> = { packages: 40, dependencies: 60, classes: 40 };

// ---------- Mermaid text helpers: labels come from untrusted repositories, so they are always escaped ----------

/** Safe content for a quoted Mermaid label. */
export function esc(text: string, max = 60): string {
  const clean = text
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/"/g, '#quot;')
    .replace(/</g, '#lt;')
    .replace(/>/g, '#gt;')
    .replace(/`/g, "'")
    .replace(/\\/g, '/');
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/** Method names are written bare in a class box: keep identifier characters only. */
const ident = (name: string) => name.replace(/[^\w$]/g, '_');

const shorten = (path: string, max = 42) => (path.length > max ? `…${path.slice(path.length - max + 1)}` : path);

/** Weakest of two confidences: a grouped edge is only "exact" when every relation behind it is. */
const weaker = (a: Confidence, b: Confidence): Confidence => (a === 'exact' && b === 'exact' ? 'exact' : a === 'unresolved' || b === 'unresolved' ? 'unresolved' : 'inferred');

const inScope = (path: string, scope: string) => !scope || path === scope || path.startsWith(`${scope}/`);
const normalizeScope = (scope: string | undefined) => (scope ?? '').replace(/^\/+|\/+$/g, '');

/** Keeps the `limit` most connected ids (ties: stable order of the input). */
function topIds(ids: string[], degree: Map<string, number>, limit: number): Set<string> {
  if (ids.length <= limit) return new Set(ids);
  return new Set([...ids].sort((a, b) => (degree.get(b) ?? 0) - (degree.get(a) ?? 0)).slice(0, limit));
}

const bump = (m: Map<string, number>, k: string, by = 1) => m.set(k, (m.get(k) ?? 0) + by);

// ---------- packages: directories and the imports between them ----------

function packagesDiagram(data: GraphData, opts: DiagramOptions, limit: number): Pick<Diagram, 'mermaid' | 'nodes' | 'edges' | 'notes' | 'truncated'> {
  const scope = normalizeScope(opts.scope);
  const files = data.files.filter((f) => inScope(f.path, scope));
  const rel = (p: string) => (scope ? p.slice(scope.length + 1) : p);
  const groupAt = (p: string, depth: number) => {
    const dirs = rel(p).split('/').slice(0, -1).slice(0, depth);
    return dirs.length === 0 ? (scope || '(root)') : scope ? `${scope}/${dirs.join('/')}` : dirs.join('/');
  };
  let depth = opts.depth;
  if (!depth) {
    depth = 1;
    for (let d = 1; d <= 6; d++) {
      depth = d;
      if (new Set(files.map((f) => groupAt(f.path, d))).size >= 5) break; // enough boxes to be a useful overview
    }
  }
  const groupOf = new Map(files.map((f) => [f.path, groupAt(f.path, depth!)]));
  const fileCount = new Map<string, number>();
  for (const g of groupOf.values()) bump(fileCount, g);

  const links = new Map<string, { from: string; to: string; weight: number; confidence: Confidence }>();
  let outside = 0;
  for (const r of data.relations) {
    if (r.kind !== 'import') continue;
    const from = groupOf.get(r.fromFile);
    if (!from) continue;
    const to = r.toFile ? groupOf.get(r.toFile) : undefined;
    if (!to) {
      outside++; // external package, unresolved import, or a file outside the scope
      continue;
    }
    if (from === to) continue;
    const key = `${from}\u0000${to}`;
    const cur = links.get(key);
    links.set(key, cur ? { ...cur, weight: cur.weight + 1, confidence: weaker(cur.confidence, r.confidence) } : { from, to, weight: 1, confidence: r.confidence });
  }

  const degree = new Map<string, number>();
  for (const l of links.values()) {
    bump(degree, l.from, l.weight);
    bump(degree, l.to, l.weight);
  }
  const groups = [...fileCount.keys()].sort();
  const keep = topIds(groups, new Map(groups.map((g) => [g, (degree.get(g) ?? 0) * 1000 + (fileCount.get(g) ?? 0)])), limit);
  const ids = new Map([...keep].sort().map((g, i) => [g, `d${i}`]));

  const nodes: DiagramNode[] = [...ids].map(([g, id]) => ({
    id, label: `${g} (${fileCount.get(g)} files)`, kind: 'directory', path: g === '(root)' ? null : g, line: null,
  }));
  const edges: DiagramEdge[] = [...links.values()]
    .filter((l) => ids.has(l.from) && ids.has(l.to))
    .map((l) => ({ from: ids.get(l.from)!, to: ids.get(l.to)!, kind: 'import' as const, confidence: l.confidence, weight: l.weight }));

  const lines = ['flowchart LR'];
  for (const n of nodes) lines.push(`  ${n.id}["${esc(n.label)}"]`);
  for (const e of edges) lines.push(`  ${e.from} ${e.confidence === 'exact' ? '-->' : '-.->'}|${e.weight}| ${e.to}`);
  return {
    mermaid: lines.join('\n'),
    nodes,
    edges,
    truncated: ids.size < groups.length,
    notes: [
      `Directories grouped at depth ${depth}${opts.depth ? '' : ' (chosen automatically)'}. Arrow labels count the import statements between two directories.`,
      `${outside} import(s) to external packages, unresolved targets or files outside the scope are not drawn.`,
      'Dotted arrows: at least one import behind the arrow was matched by name only (not proven).',
      ...(ids.size < groups.length ? [`Showing the ${ids.size} most connected of ${groups.length} directories.`] : []),
    ],
  };
}

// ---------- dependencies: file-level import graph ----------

function dependenciesDiagram(data: GraphData, opts: DiagramOptions, limit: number): Pick<Diagram, 'mermaid' | 'nodes' | 'edges' | 'notes' | 'truncated'> {
  const scope = normalizeScope(opts.scope);
  const files = data.files.filter((f) => inScope(f.path, scope));
  const known = new Set(files.map((f) => f.path));
  const rel = (p: string) => (scope ? p.slice(scope.length + 1) : p);

  const fileEdges = new Map<string, { from: string; to: string; confidence: Confidence }>();
  const externals = new Map<string, { to: string; uses: number }>();
  const externalEdges = new Map<string, { from: string; to: string }>();
  let unresolved = 0;
  for (const r of data.relations) {
    if (r.kind !== 'import' || !known.has(r.fromFile)) continue;
    if (r.toFile && known.has(r.toFile) && r.toFile !== r.fromFile) {
      fileEdges.set(`${r.fromFile}\u0000${r.toFile}`, { from: r.fromFile, to: r.toFile, confidence: r.confidence });
    } else if (r.toExternal && r.confidence === 'exact' && !r.toFile) {
      if (opts.external) {
        externals.set(r.toExternal, { to: r.toExternal, uses: (externals.get(r.toExternal)?.uses ?? 0) + 1 });
        externalEdges.set(`${r.fromFile}\u0000${r.toExternal}`, { from: r.fromFile, to: r.toExternal });
      }
    } else if (r.confidence === 'unresolved') unresolved++;
  }

  const degree = new Map<string, number>();
  for (const e of fileEdges.values()) {
    bump(degree, e.from);
    bump(degree, e.to);
  }
  // files with no drawn relation would only be noise
  const connected = files.map((f) => f.path).filter((p) => degree.has(p));
  const keepFiles = topIds(connected, degree, limit);
  const fileIds = new Map([...keepFiles].sort().map((p, i) => [p, `f${i}`]));
  const topExternals = [...externals.values()].sort((a, b) => b.uses - a.uses).slice(0, 15).map((e) => e.to);
  const extIds = new Map(topExternals.map((p, i) => [p, `x${i}`]));

  const nodes: DiagramNode[] = [
    ...[...fileIds].map(([p, id]) => ({ id, label: shorten(rel(p)), kind: 'file' as const, path: p, line: null })),
    ...[...extIds].map(([p, id]) => ({ id, label: p, kind: 'external' as const, path: null, line: null })),
  ];
  const edges: DiagramEdge[] = [
    ...[...fileEdges.values()]
      .filter((e) => fileIds.has(e.from) && fileIds.has(e.to))
      .map((e) => ({ from: fileIds.get(e.from)!, to: fileIds.get(e.to)!, kind: 'import' as const, confidence: e.confidence, weight: 1 })),
    ...[...externalEdges.values()]
      .filter((e) => fileIds.has(e.from) && extIds.has(e.to))
      .map((e) => ({ from: fileIds.get(e.from)!, to: extIds.get(e.to)!, kind: 'import' as const, confidence: 'exact' as const, weight: 1 })),
  ];

  const lines = ['flowchart LR'];
  for (const n of nodes) lines.push(n.kind === 'external' ? `  ${n.id}(["${esc(n.label)}"])` : `  ${n.id}["${esc(n.label)}"]`);
  for (const e of edges) lines.push(`  ${e.from} ${e.confidence === 'exact' ? '-->' : '-.->'} ${e.to}`);
  return {
    mermaid: lines.join('\n'),
    nodes,
    edges,
    truncated: keepFiles.size < connected.length,
    notes: [
      'One arrow per import between two files of the repository. Only files with at least one drawn import appear.',
      `${unresolved} import(s) could not be resolved (path aliases, ambiguous names) and are not drawn.`,
      ...(opts.external ? [] : ['External packages are hidden (enable "external packages" to draw them).']),
      ...(keepFiles.size < connected.length ? [`Showing the ${keepFiles.size} most connected of ${connected.length} files: narrow the scope to see the rest.`] : []),
    ],
  };
}

// ---------- classes: UML class diagram from classes, interfaces and enums ----------

function classesDiagram(data: GraphData, opts: DiagramOptions, limit: number): Pick<Diagram, 'mermaid' | 'nodes' | 'edges' | 'notes' | 'truncated'> {
  const scope = normalizeScope(opts.scope);
  const types = data.symbols.filter((s) => typeKindOf(s.kind) && inScope(s.filePath, scope));
  const key = (file: string, name: string) => `${file}\u0000${name}`;
  const typeKeys = new Set(types.map((t) => key(t.filePath, t.name)));

  const degree = new Map<string, number>();
  const heritage = data.relations.filter((r) => (r.kind === 'extends' || r.kind === 'implements') && r.fromSymbol && typeKeys.has(key(r.fromFile, r.fromSymbol)));
  for (const r of heritage) {
    bump(degree, key(r.fromFile, r.fromSymbol!));
    if (r.toFile && r.toSymbol) bump(degree, key(r.toFile, r.toSymbol));
  }
  const members = new Map<string, string[]>();
  for (const s of data.symbols) {
    if (!s.container || typeKindOf(s.kind)) continue;
    const k = key(s.filePath, s.container);
    if (typeKeys.has(k)) members.set(k, [...(members.get(k) ?? []), s.name]);
  }
  const typeIds = types.map((t) => key(t.filePath, t.name));
  const score = new Map(typeIds.map((k) => [k, (degree.get(k) ?? 0) * 100 + (members.get(k)?.length ?? 0)]));
  const keep = topIds(typeIds, score, limit);
  const kept = types.filter((t) => keep.has(key(t.filePath, t.name)));
  const ids = new Map(kept.map((t, i) => [key(t.filePath, t.name), `C${i}`]));

  const nodes: DiagramNode[] = kept.map((t) => ({
    id: ids.get(key(t.filePath, t.name))!,
    label: t.container ? `${t.container}.${t.name}` : t.name,
    kind: typeKindOf(t.kind)!,
    path: t.filePath,
    line: t.startLine,
  }));
  const edges: DiagramEdge[] = [];
  const lines = ['classDiagram'];
  const externalIds = new Map<string, string>();
  let notDrawn = 0;
  for (const n of nodes) {
    lines.push(`  class ${n.id}["${esc(n.label)}"]`);
    if (n.kind === 'interface') lines.push(`  <<interface>> ${n.id}`);
    if (n.kind === 'enum') lines.push(`  <<enumeration>> ${n.id}`);
  }
  for (const t of kept) {
    const names = [...new Set(members.get(key(t.filePath, t.name)) ?? [])];
    const id = ids.get(key(t.filePath, t.name))!;
    for (const m of names.slice(0, 12)) lines.push(`  ${id} : +${ident(m)}()`);
    if (names.length > 12) lines.push(`  ${id} : +${names.length - 12} more methods`);
  }
  for (const r of heritage) {
    const from = ids.get(key(r.fromFile, r.fromSymbol!));
    if (!from) continue;
    let to: string | undefined;
    if (r.toFile && r.toSymbol) to = ids.get(key(r.toFile, r.toSymbol));
    else if (r.toExternal && r.confidence !== 'unresolved' && externalIds.size < 15) {
      to = externalIds.get(r.toExternal);
      if (!to) {
        to = `E${externalIds.size}`;
        externalIds.set(r.toExternal, to);
        nodes.push({ id: to, label: r.toExternal, kind: 'external', path: null, line: null });
        lines.push(`  class ${to}["${esc(r.toExternal)} (external)"]`);
      }
    }
    if (!to) {
      notDrawn++;
      continue;
    }
    edges.push({ from, to, kind: r.kind, confidence: r.confidence, weight: 1 });
    const arrow = r.kind === 'extends' ? '<|--' : '<|..';
    lines.push(`  ${to} ${arrow} ${from}${r.confidence === 'exact' ? '' : ' : inferred'}`);
  }
  return {
    mermaid: lines.join('\n'),
    nodes,
    edges,
    truncated: kept.length < types.length,
    notes: [
      'Classes, interfaces and enums with their methods. Fields and visibility are not extracted, so they are not shown.',
      'Base types come from the code (`extends` / `implements`). "inferred" means the base type was matched by name only; ambiguous names are not drawn.',
      `${notDrawn} inheritance relation(s) could not be placed and are not drawn.`,
      ...(kept.length < types.length ? [`Showing the ${kept.length} most connected of ${types.length} types: narrow the scope to see the rest.`] : []),
    ],
  };
}

export function buildDiagram(
  kind: DiagramKind,
  data: GraphData,
  opts: DiagramOptions,
  meta: { branch: string; commitSha: string | null },
): Diagram {
  const limit = opts.limit ?? DEFAULT_LIMIT[kind];
  const body = kind === 'packages' ? packagesDiagram(data, opts, limit) : kind === 'dependencies' ? dependenciesDiagram(data, opts, limit) : classesDiagram(data, opts, limit);
  return { kind, ...meta, ...body };
}
