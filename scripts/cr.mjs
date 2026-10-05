#!/usr/bin/env node
// Terminal client for the Core API, for testing without the dashboard.
//   pnpm cr repos                      list connected repos
//   pnpm cr connect                    print the "Connect GitHub" URL
//   pnpm cr enable owner/name [off]    turn PR reviews on (or off) for a repo
//   pnpm cr index owner/name           (re)index a repo
//   pnpm cr reviews owner/name         latest reviews of a repo
//   pnpm cr review <file.patch|dir>    review a patch file, or the uncommitted changes of a git repo
//   pnpm cr review <...> owner/name    same, with that repo's codebase context and rules
//   pnpm cr key <name>                 create an API key (for the MCP server)
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
if (existsSync(resolve(root, '.env'))) process.loadEnvFile(resolve(root, '.env'));
const API = (process.env.CODEREVIEW_API_URL ?? 'http://localhost:4000').replace(/\/$/, '');
const KEY = process.env.CODEREVIEW_API_KEY; // required: create one on the dashboard's API keys page

async function api(method, path, body) {
  let res;
  try {
    res = await fetch(API + path, {
      method,
      headers: { 'content-type': 'application/json', ...(KEY ? { authorization: `Bearer ${KEY}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    fail(`Cannot reach the API at ${API}. Is "pnpm dev" running?`);
  }
  if (res.status === 401) fail('401 Unauthorized: set CODEREVIEW_API_KEY in .env (create a key on the dashboard's API keys page)');
  if (!res.ok) fail(`${method} ${path} -> ${res.status} ${(await res.text()).slice(0, 300)}`);
  return res.status === 204 ? null : res.json();
}
function fail(message) {
  console.error(message);
  process.exit(1);
}
async function repoByName(name) {
  const repos = await api('GET', '/api/repos');
  const repo = repos.find((r) => r.fullName.toLowerCase() === String(name).toLowerCase());
  if (!repo) fail(`Repo "${name}" is not connected. Connected: ${repos.map((r) => r.fullName).join(', ') || 'none'}`);
  return repo;
}
function printFindings(review) {
  console.log(`\n${review.summary ?? ''}  [${review.provider ?? '-'} / ${review.model ?? '-'}, ${review.durationMs ?? '?'} ms]`);
  for (const f of review.findings) {
    const line = f.lineEnd ? `${f.lineStart}-${f.lineEnd}` : f.lineStart;
    console.log(`\n[${f.severity.toUpperCase()}] ${f.category}  ${f.filePath}:${line}  (${f.source})`);
    console.log(`  ${f.message}`);
    if (f.suggestion) console.log(`  fix: ${f.suggestion.replace(/\n/g, '\n       ')}`);
  }
}

/** Uncommitted changes of a git repo, including new (untracked) files. */
function workingTreeDiff(dir) {
  const git = (args) => {
    try {
      return execFileSync('git', ['-C', dir, '-c', 'core.safecrlf=false', ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    } catch (err) {
      if (err.stdout) return err.stdout; // `git diff --no-index` exits 1 when there is a difference
      fail(`git failed in ${dir}: ${err.message}`);
    }
  };
  const untracked = git(['ls-files', '--others', '--exclude-standard']).split('\n').filter(Boolean);
  return git(['diff', 'HEAD']) + untracked.map((f) => git(['diff', '--no-index', '--', '/dev/null', f])).join('');
}

const [cmd, a, b] = process.argv.slice(2);
// pnpm runs scripts from the repo root; INIT_CWD is where the user actually typed the command
const from = (p) => resolve(process.env.INIT_CWD ?? process.cwd(), p);

switch (cmd) {
  case 'repos':
    console.table((await api('GET', '/api/repos')).map((r) => ({ repo: r.fullName, enabled: r.enabled, index: r.indexStatus })));
    break;
  case 'connect':
    console.log('Open this URL in your browser and install the app on a repo:\n' + (await api('GET', '/api/github/install-url')).url);
    break;
  case 'enable': {
    const repo = await repoByName(a);
    await api('POST', `/api/repos/${repo.id}/enable`, { enabled: b !== 'off' });
    console.log(`${repo.fullName}: reviews ${b !== 'off' ? 'enabled' : 'disabled'}`);
    break;
  }
  case 'index': {
    const repo = await repoByName(a);
    await api('POST', `/api/repos/${repo.id}/index`);
    console.log(`${repo.fullName}: indexing queued (check "pnpm cr repos")`);
    break;
  }
  case 'reviews': {
    const repo = await repoByName(a);
    const { items } = await api('GET', `/api/repos/${repo.id}/reviews`);
    console.table(items.map((r) => ({ id: r.id, pr: r.prNumber, status: r.status, summary: (r.summary ?? r.error ?? '').slice(0, 70) })));
    break;
  }
  case 'key': {
    const created = await api('POST', '/api/keys', { name: a ?? 'cli' });
    console.log(`API key (shown once, put it in CODEREVIEW_API_KEY):\n${created.key}`);
    break;
  }
  case 'review': {
    const target = from(a ?? '.');
    if (!existsSync(target)) fail(`Not found: ${target}`);
    const diff = statSync(target).isDirectory() ? workingTreeDiff(target) : readFileSync(target, 'utf8');
    if (!diff.trim()) fail('Nothing to review: the diff is empty.');
    const { reviewId } = await api('POST', '/api/reviews/diff', { diff, repo: b });
    process.stdout.write(`review ${reviewId} queued`);
    for (let i = 0; i < 150; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const { status, error } = await api('GET', `/api/reviews/${reviewId}/status`);
      process.stdout.write('.');
      if (status === 'failed') fail(`\nreview failed: ${error} (the worker retries up to 3 times; see its log)`);
      if (status === 'completed') {
        printFindings(await api('GET', `/api/reviews/${reviewId}`));
        process.exit(0);
      }
    }
    fail('\nstill running after 5 minutes; check the worker log');
    break;
  }
  default:
    console.log(readFileSync(import.meta.filename, 'utf8').split('\n').slice(2, 10).map((l) => l.slice(3)).join('\n'));
}
