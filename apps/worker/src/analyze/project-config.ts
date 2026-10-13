import { posix } from 'node:path';

/** What the repository's own configuration files say about how imports are resolved. */
export interface ProjectConfig {
  /** Workspace packages: `package.json` name -> directory of that package ('' for the repository root). */
  workspacePackages: Map<string, string>;
  /** `compilerOptions.paths` of each tsconfig.json: alias patterns relative to the tsconfig's own directory. */
  tsconfigs: { dir: string; baseUrl: string | null; paths: Record<string, string[]> }[];
}

export const EMPTY_CONFIG: ProjectConfig = { workspacePackages: new Map(), tsconfigs: [] };

/** tsconfig.json is JSON with comments and trailing commas: strip both without touching string contents. */
export function parseJsonc(text: string): unknown {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    const next = text[i + 1];
    if (inString) {
      out += c;
      if (c === '\\') out += text[++i] ?? '';
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
      out += c;
    } else if (c === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i++;
    } else out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

/**
 * Reads the `package.json` and `tsconfig.json` files found in the repository. Files that cannot be parsed
 * are ignored (the imports they would explain simply stay unresolved). `extends` chains are not followed.
 */
export function readProjectConfig(configFiles: { path: string; content: string }[]): ProjectConfig {
  const config: ProjectConfig = { workspacePackages: new Map(), tsconfigs: [] };
  for (const f of configFiles) {
    const dir = posix.dirname(f.path) === '.' ? '' : posix.dirname(f.path);
    try {
      const json = parseJsonc(f.content) as Record<string, unknown>;
      if (f.path.split('/').pop() === 'package.json') {
        if (typeof json.name === 'string' && json.name) config.workspacePackages.set(json.name, dir);
      } else {
        const options = (json.compilerOptions ?? {}) as { baseUrl?: unknown; paths?: Record<string, unknown> };
        const paths: Record<string, string[]> = {};
        for (const [pattern, targets] of Object.entries(options.paths ?? {})) {
          if (Array.isArray(targets)) paths[pattern] = targets.filter((t): t is string => typeof t === 'string');
        }
        if (Object.keys(paths).length > 0) {
          config.tsconfigs.push({ dir, baseUrl: typeof options.baseUrl === 'string' ? options.baseUrl : null, paths });
        }
      }
    } catch {
      // unreadable configuration: skip it
    }
  }
  return config;
}
