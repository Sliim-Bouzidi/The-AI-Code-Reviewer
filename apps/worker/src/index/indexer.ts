import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { promisify } from 'node:util';
import { and, codeChunks, eq, inArray, installations, notInArray, repoSettings, repositories } from '@codereview/db';
import { embedderId } from '@codereview/llm';
import type { IndexJobData } from '@codereview/shared';
import type { Deps } from '../deps.js';
import { log } from '../deps.js';
import { getInstallationToken } from '../github.js';
import { isIgnoredPath } from '../review/filter.js';
import { languageOf } from './chunker.js';
import { notifyIndex } from '../notify.js';
import { chunkFileBySymbol } from './symbols.js';

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
    throw new Error(`Embeddings are not set up for this account: add a Gemini (free) or OpenAI key on the dashboard's "AI providers" page.`);
  }

  // Vectors from different embedding models cannot be compared. When the user switched model, the
  // old index is dropped and rebuilt in full (older indexes without a recorded model were Gemini's).
  const modelId = embedderId(embedder);
  const sameModel = row.repo.embeddingModel ? row.repo.embeddingModel === modelId : embedder.name === 'gemini';
  if (!sameModel) {
    await db.delete(codeChunks).where(eq(codeChunks.repoId, job.repoId));
    log('index', 'embedding model changed: full re-index', { repoId: job.repoId, model: modelId });
  }
  await db.update(repositories).set({ embeddingModel: modelId }).where(eq(repositories.id, job.repoId));
  const paths = sameModel ? job.paths : undefined;

  // shown under the status badge on the Repositories page
  const progress = (text: string | null) =>
    db.update(repositories).set({ indexProgress: text }).where(eq(repositories.id, job.repoId));

  await db.update(repositories).set({ indexStatus: 'indexing', indexProgress: 'Cloning the repository' }).where(eq(repositories.id, job.repoId));
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
    await progress('Splitting files into functions and classes');

    // reuse embeddings of unchanged chunks
    const existing = await db
      .select({ contentHash: codeChunks.contentHash, embedding: codeChunks.embedding })
      .from(codeChunks)
      .where(eq(codeChunks.repoId, job.repoId));
    const known = new Map(existing.map((e) => [e.contentHash, e.embedding]));

    // incremental (after a push): only the listed files; full: every file in the repo
    const incremental = !!paths;
    const candidates: string[] = [];
    if (paths) {
      for (const p of paths) candidates.push(join(dir, p));
    } else {
      for await (const full of walk(dir)) candidates.push(full);
    }

    const rows: (typeof codeChunks.$inferInsert)[] = [];
    for (const full of candidates) {
      const path = relative(dir, full).split('\\').join('/');
      if (path.startsWith('..') || !languageOf(path) || isIgnoredPath(path, settings?.ignoredPaths ?? [])) continue;
      let size: number;
      try {
        size = (await stat(full)).size;
      } catch {
        continue; // deleted or renamed after the push event
      }
      if (size > MAX_FILE_BYTES) continue;
      const content = await readFile(full, 'utf8');
      if (content.includes('\u0000')) continue;
      for (const c of await chunkFileBySymbol(path, content)) {
        rows.push({ ...c, repoId: job.repoId, filePath: path, commitSha: sha, embedding: known.get(c.contentHash) ?? null });
      }
    }

    // Embed in slices and save each slice straight away. Embeddings cost free-tier quota (1,000 a day),
    // so if a run fails halfway, the next run finds these by content hash and does not pay for them again.
    const toEmbed = rows.filter((r) => !r.embedding);
    const reused = rows.length - toEmbed.length;
    const keep: string[] = []; // ids of this run's chunks; everything else of the repo is stale at the end
    const SLICE = 20;
    for (let i = 0; i < toEmbed.length; i += SLICE) {
      await progress(`Embedding ${i}/${toEmbed.length} chunks${reused > 0 ? ` (${reused} reused)` : ''}`);
      const slice = toEmbed.slice(i, i + SLICE);
      const vectors = await embedder.embed(slice.map((r) => `${r.filePath}\n${r.content}`), 'document');
      slice.forEach((r, j) => (r.embedding = vectors[j]!));
      const saved = await db.insert(codeChunks).values(slice).returning({ id: codeChunks.id });
      keep.push(...saved.map((s) => s.id));
      if ((i / SLICE) % 5 === 0) log('index', 'embedding', { repoId: job.repoId, done: i + slice.length, total: toEmbed.length });
    }
    await progress('Saving to the database');

    await db.transaction(async (tx) => {
      // chunks whose embedding was reused get a fresh row for this commit
      const reusedRows = rows.filter((r) => !toEmbed.includes(r));
      for (let i = 0; i < reusedRows.length; i += 200) {
        const saved = await tx.insert(codeChunks).values(reusedRows.slice(i, i + 200)).returning({ id: codeChunks.id });
        keep.push(...saved.map((s) => s.id));
      }
      // drop the previous rows: all of the repo (full) or only the touched files (incremental)
      const scope = incremental
        ? inArray(codeChunks.filePath, [...new Set([...(paths ?? []), ...(job.removed ?? [])])])
        : undefined;
      const notKept = keep.length > 0 ? notInArray(codeChunks.id, keep) : undefined;
      if (!incremental || (paths?.length ?? 0) + (job.removed?.length ?? 0) > 0) {
        await tx.delete(codeChunks).where(and(eq(codeChunks.repoId, job.repoId), scope, notKept));
      }
      await tx
        .update(repositories)
        .set({ indexStatus: 'ready', lastIndexedSha: sha, indexProgress: `${rows.length} chunks indexed` })
        .where(eq(repositories.id, job.repoId));
    });
    await notifyIndex(db, job.repoId, 'ready', `${rows.length} chunks indexed`);
    log('index', 'completed', { repoId: job.repoId, mode: incremental ? 'incremental' : 'full', chunks: rows.length, embedded: toEmbed.length });
  } catch (err) {
    const message = (err as Error).message;
    const reason = /daily free-tier/.test(message)
      ? 'Gemini daily embedding quota (1,000/day) used up. Chunks done so far are saved; click Index again tomorrow to finish.'
      : / 429 /.test(message)
        ? 'Gemini rate limit (HTTP 429). Try again in a few minutes.'
        : message.slice(0, 160);
    await db.update(repositories).set({ indexStatus: 'failed', indexProgress: reason }).where(eq(repositories.id, job.repoId));
    throw err;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
