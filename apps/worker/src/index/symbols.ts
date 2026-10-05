import { createRequire } from 'node:module';
import Parser from 'web-tree-sitter';
import { hashContent, chunkFile, languageOf } from './chunker.js';
import type { Chunk } from './chunker.js';

// Tree-sitter via WebAssembly: no native compilation, works the same on Windows, macOS and in Docker.
const require = createRequire(import.meta.url);

/** Per language: grammar file, the node types that define a symbol, and how calls / imports look. */
interface LangSpec {
  wasm: string;
  symbols: Set<string>;
  calls: Set<string>;
  imports: Set<string>;
}

const JS: Omit<LangSpec, 'wasm'> = {
  symbols: new Set([
    'function_declaration', 'generator_function_declaration', 'class_declaration', 'method_definition',
    'interface_declaration', 'type_alias_declaration', 'enum_declaration',
  ]),
  calls: new Set(['call_expression', 'new_expression']),
  imports: new Set(['import_statement']),
};

const SPECS: Record<string, LangSpec> = {
  typescript: { wasm: 'typescript', ...JS },
  tsx: { wasm: 'tsx', ...JS },
  javascript: { wasm: 'javascript', ...JS },
  python: {
    wasm: 'python',
    symbols: new Set(['function_definition', 'class_definition']),
    calls: new Set(['call']),
    imports: new Set(['import_statement', 'import_from_statement']),
  },
  go: {
    wasm: 'go',
    symbols: new Set(['function_declaration', 'method_declaration', 'type_declaration']),
    calls: new Set(['call_expression']),
    imports: new Set(['import_declaration']),
  },
  java: {
    wasm: 'java',
    symbols: new Set(['class_declaration', 'interface_declaration', 'method_declaration', 'constructor_declaration']),
    calls: new Set(['method_invocation']),
    imports: new Set(['import_declaration']),
  },
  ruby: {
    wasm: 'ruby',
    symbols: new Set(['method', 'singleton_method', 'class', 'module']),
    calls: new Set(['call']),
    imports: new Set([]),
  },
  rust: {
    wasm: 'rust',
    symbols: new Set(['function_item', 'struct_item', 'enum_item', 'trait_item', 'impl_item']),
    calls: new Set(['call_expression']),
    imports: new Set(['use_declaration']),
  },
};

export interface Symbol {
  name: string;
  kind: string;
  startLine: number; // 1-based
  endLine: number;
  calls: string[]; // names of functions/methods called inside
}

export interface ParsedFile {
  symbols: Symbol[];
  imports: string[]; // raw import statements
}

let initPromise: Promise<void> | null = null;
const languages = new Map<string, Promise<Parser.Language | null>>();

function loadLanguage(lang: string): Promise<Parser.Language | null> {
  const spec = SPECS[lang];
  if (!spec) return Promise.resolve(null);
  let p = languages.get(lang);
  if (!p) {
    p = (async () => {
      try {
        initPromise ??= Parser.init();
        await initPromise;
        return await Parser.Language.load(require.resolve(`tree-sitter-wasms/out/tree-sitter-${spec.wasm}.wasm`));
      } catch {
        return null; // grammar unavailable: callers fall back to line windows
      }
    })();
    languages.set(lang, p);
  }
  return p;
}

/** Name of a called function: `foo(...)` -> foo, `a.b.foo(...)` -> foo. */
function calleeName(node: Parser.SyntaxNode): string | null {
  const fn = node.childForFieldName('function') ?? node.childForFieldName('name') ?? node.childForFieldName('constructor');
  const target = fn ?? node.namedChild(0);
  if (!target) return null;
  const text = target.text;
  const m = /([A-Za-z_$][\w$]*)\s*$/.exec(text.split('(')[0]!);
  return m ? m[1]! : null;
}

function symbolName(node: Parser.SyntaxNode): string | null {
  const named = node.childForFieldName('name');
  if (named) return named.text;
  // `const foo = () => {}` / `const foo = function () {}`
  return null;
}

/** Parses a file with Tree-sitter. Returns null when the language has no grammar or parsing fails. */
export async function parseFile(path: string, content: string): Promise<ParsedFile | null> {
  const lang = languageOf(path);
  const spec = lang ? SPECS[lang] : undefined;
  if (!lang || !spec) return null;
  const language = await loadLanguage(lang);
  if (!language) return null;

  const parser = new Parser();
  try {
    parser.setLanguage(language);
    const tree = parser.parse(content);
    const symbols: Symbol[] = [];
    const imports: string[] = [];

    const collectCalls = (node: Parser.SyntaxNode): string[] => {
      const names = new Set<string>();
      const stack = [node];
      while (stack.length) {
        const n = stack.pop()!;
        if (spec.calls.has(n.type)) {
          const name = calleeName(n);
          if (name) names.add(name);
        }
        for (const c of n.namedChildren) stack.push(c);
      }
      return [...names];
    };

    const visit = (node: Parser.SyntaxNode, depth: number) => {
      if (spec.imports.has(node.type)) imports.push(node.text.slice(0, 300));
      let isSymbol = spec.symbols.has(node.type);
      let name = isSymbol ? symbolName(node) : null;
      // arrow functions / function expressions assigned to a variable
      if (!isSymbol && (node.type === 'variable_declarator' || node.type === 'lexical_declaration')) {
        const decl = node.type === 'variable_declarator' ? node : node.namedChildren.find((c) => c.type === 'variable_declarator');
        const value = decl?.childForFieldName('value');
        if (decl && value && ['arrow_function', 'function_expression', 'function'].includes(value.type)) {
          isSymbol = true;
          name = decl.childForFieldName('name')?.text ?? null;
        }
      }
      if (isSymbol && name) {
        symbols.push({
          name,
          kind: node.type,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          calls: collectCalls(node).filter((c) => c !== name),
        });
      }
      // classes contain methods that are symbols of their own; functions' inner helpers are not
      const descend = depth < 3 && (!isSymbol || /class|impl|module|interface|trait/.test(node.type));
      if (!isSymbol || descend) for (const c of node.namedChildren) visit(c, depth + 1);
    };
    visit(tree.rootNode, 0);
    return { symbols, imports };
  } catch {
    return null;
  } finally {
    parser.delete();
  }
}

const MAX_SYMBOL_LINES = 120;

/**
 * Chunks a file by function / class (pipeline "Indexing": chunk with Tree-sitter by symbol).
 * Falls back to fixed line windows for unsupported languages, parse failures and oversized symbols.
 */
export async function chunkFileBySymbol(path: string, content: string): Promise<Chunk[]> {
  const parsed = await parseFile(path, content);
  if (!parsed || parsed.symbols.length === 0) return chunkFile(path, content);

  const language = languageOf(path);
  const lines = content.split(/\r?\n/);
  const chunks: Chunk[] = [];
  // a class is covered by its methods; keep only the innermost symbols plus the class header
  const sorted = [...parsed.symbols].sort((a, b) => a.startLine - b.startLine || b.endLine - a.endLine);
  const covered = new Array<boolean>(lines.length + 2).fill(false);

  for (const s of sorted) {
    const size = s.endLine - s.startLine + 1;
    const isContainer = /class|impl|module|interface|trait/.test(s.kind) && sorted.some((o) => o !== s && o.startLine > s.startLine && o.endLine <= s.endLine);
    if (isContainer) continue; // its methods become chunks
    if (covered[s.startLine]) continue;
    const text = lines.slice(s.startLine - 1, s.endLine).join('\n');
    if (!text.trim()) continue;
    for (let l = s.startLine; l <= s.endLine; l++) covered[l] = true;
    if (size > MAX_SYMBOL_LINES) {
      // very long function: window it, but keep the symbol name
      for (const c of chunkFile(path, text)) {
        chunks.push({
          ...c,
          symbol: s.name,
          startLine: s.startLine + c.startLine - 1,
          endLine: s.startLine + c.endLine - 1,
          contentHash: hashContent(`${path}\n${s.name}\n${c.content}`),
        });
      }
    } else {
      chunks.push({
        symbol: s.name,
        language,
        startLine: s.startLine,
        endLine: s.endLine,
        content: text,
        contentHash: hashContent(`${path}\n${text}`),
      });
    }
  }

  // everything outside symbols (imports, constants, top-level code) as one header chunk
  const rest = lines.map((l, i) => (covered[i + 1] ? '' : l)).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (rest.length > 0) {
    const head = rest.split('\n').slice(0, MAX_SYMBOL_LINES).join('\n');
    chunks.unshift({
      symbol: null,
      language,
      startLine: 1,
      endLine: lines.length,
      content: head,
      contentHash: hashContent(`${path}\n${head}`),
    });
  }
  return chunks.length > 0 ? chunks : chunkFile(path, content);
}

/** Symbols touched by a diff: those overlapping the given changed (new-side) line numbers. */
export function changedSymbols(parsed: ParsedFile, changedLines: Set<number>): Symbol[] {
  return parsed.symbols.filter((s) => {
    for (let l = s.startLine; l <= s.endLine; l++) if (changedLines.has(l)) return true;
    return false;
  });
}
