import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { promisify } from 'node:util';
import { codeChunks, eq, installations, repoSettings, repositories } from '@codereview/db';
import type { IndexJobData } from '@codereview/shared';
import type { Deps } from '../deps.js';
import { log } from '../deps.js';
import { getInstallationToken } from '../github.js';
import { isIgnoredPath } from '../review/filter.js';
import { chunkFile, languageOf } from './chunker.js';

const exec = promisify(execFile);
const MAX_FILE_BYTES = 200_000;

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === '.git') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) yield full;
  }
}

/**
 * `index-repo` job: shallow clone, chunk, embed, store. Chunks whose content hash is already stored
 * keep their embedding, so a re-index only embeds what changed.
 */
export async function runIndex(deps: Deps, job: IndexJobData): Promise<void> {
  const { db, embedder } = deps;
  const [row] = await db
    .select({ repo: repositories, inst: installations })
    .from(repositories)
    .innerJoin(installations, eq(installations.id, repositories.installationId))
    .where(eq(repositories.id, job.repoId));
  if (!row) return log('index', 'repo missing', { repoId: job.repoId });
  if (!embedder) {
    await db.update(repositories).set({ indexStatus: 'failed' }).where(eq(repositories.id, job.repoId));
    throw new Error('embeddings are not configured (GEMINI_API_KEY / EMBEDDING_MODEL)');
  }

  await db.update(repositories).set({ indexStatus: 'indexing' }).where(eq(repositories.id, job.repoId));
  const dir = await mkdtemp(join(tmpdir(), 'codereview-index-'));
  try {
    const [settings] = await db.select().from(repoSettings).where(eq(repoSettings.repoId, job.repoId));
    const token = await getInstallationToken(row.inst.githubInstallationId);
    // the token is passed as a header, so it never lands in the clone's .git/config
    const basic = Buffer.from(`x-access-token:${token}`).toString('base64');
    await exec(
      'git',
      ['-c', `http.extraHeader=Authorization: Basic ${basic}`, 'clone', '--depth', '1', `https://github.com/${row.repo.fullName}.git`, dir],
      { timeout: 300_000 },
    );
    const sha = (await exec('git', ['-C', dir, 'rev-parse', 'HEAD'])).stdout.trim();

    // reuse embeddings of unchanged chunks
    const existing = await db
      .select({ contentHash: codeChunks.contentHash, embedding: codeChunks.embedding })
      .from(codeChunks)
      .where(eq(codeChunks.repoId, job.repoId));
    const known = new Map(existing.map((e) => [e.contentHash, e.embedding]));

    const rows: (typeof codeChunks.$inferInsert)[] = [];
    for await (const full of walk(dir)) {
      const path = relative(dir, full).split('\\').join('/');
      if (!languageOf(path) || isIgnoredPath(path, settings?.ignoredPaths ?? [])) continue;
      if ((await stat(full)).size > MAX_FILE_BYTES) continue;
      const content = await readFile(full, 'utf8');
      if (content.includes('\u0000')) continue;
      for (const c of chunkFile(path, content)) {
        rows.push({ ...c, repoId: job.repoId, filePath: path, commitSha: sha, embedding: known.get(c.contentHash) ?? null });
      }
    }

    const toEmbed = rows.filter((r) => !r.embedding);
    const vectors = await embedder.embed(toEmbed.map((r) => `${r.filePath}\n${r.content}`), 'document');
    toEmbed.forEach((r, i) => (r.embedding = vectors[i]!));

    await db.transaction(async (tx) => {
      await tx.delete(codeChunks).where(eq(codeChunks.repoId, job.repoId));
      for (let i = 0; i < rows.length; i += 200) await tx.insert(codeChunks).values(rows.slice(i, i + 200));
      await tx.update(repositories).set({ indexStatus: 'ready', lastIndexedSha: sha }).where(eq(repositories.id, job.repoId));
    });
    log('index', 'completed', { repoId: job.repoId, chunks: rows.length, embedded: toEmbed.length });
  } catch (err) {
    await db.update(repositories).set({ indexStatus: 'failed' }).where(eq(repositories.id, job.repoId));
    throw err;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
