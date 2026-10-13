import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { codeAnalyses, codeFiles, codeRelations, codeSymbols, eq, installations, repoSettings, repositories } from '@codereview/db';
import { NON_CODE_LANGUAGES } from '@codereview/shared';
import type { AnalyzeJobData } from '@codereview/shared';
import type { Deps } from '../deps.js';
import { log } from '../deps.js';
import { cloneRepository } from '../git-clone.js';
import { languageOf } from '../index/chunker.js';
import { walk } from '../index/indexer.js';
import { parseFile } from '../index/symbols.js';
import { isIgnoredPath } from '../review/filter.js';
import { readProjectConfig } from './project-config.js';
import { resolveRelations } from './resolve.js';
import type { AnalyzedFile } from './resolve.js';

const MAX_FILE_BYTES = 200_000;
const MAX_FILES = 8_000; // keeps the graph (and the diagrams built from it) usable on very large repositories
const INSERT_CHUNK = 1_000;

/**
 * `analyze-repo` job: shallow clone of one branch (reusing the indexer's clone), Tree-sitter parse of every
 * source file, resolution of imports / inheritance / calls into relations, then a full replacement of the
 * stored graph of that (repo, branch). Needs no AI key and no embeddings: it is purely static analysis.
 * The cloned code is only read, never executed.
 */
export async function runAnalysis(deps: Deps, job: AnalyzeJobData): Promise<void> {
  const { db } = deps;
  const [row] = await db
    .select({ repo: repositories, inst: installations })
    .from(repositories)
    .innerJoin(installations, eq(installations.id, repositories.installationId))
    .where(eq(repositories.id, job.repoId));
  if (!row) return log('analyze', 'repo missing', { repoId: job.repoId });
  const branch = job.branch ?? row.repo.defaultBranch;
  if (!branch) throw new Error('This repository has no default branch to analyse.');

  const [analysis] = await db
    .insert(codeAnalyses)
    .values({ repoId: job.repoId, branch, status: 'analyzing', progress: 'Cloning the branch' })
    .onConflictDoUpdate({
      target: [codeAnalyses.repoId, codeAnalyses.branch],
      set: { status: 'analyzing', progress: 'Cloning the branch', updatedAt: new Date() },
    })
    .returning({ id: codeAnalyses.id });
  const analysisId = analysis!.id;
  const progress = (text: string) =>
    db.update(codeAnalyses).set({ progress: text, updatedAt: new Date() }).where(eq(codeAnalyses.id, analysisId));

  const dir = await mkdtemp(join(tmpdir(), 'codereview-analyze-'));
  try {
    const [settings] = await db.select().from(repoSettings).where(eq(repoSettings.repoId, job.repoId));
    const sha = await cloneRepository(row.inst.githubInstallationId, row.repo.fullName, dir, branch);
    await progress('Reading source files');

    const files: AnalyzedFile[] = [];
    const configFiles: { path: string; content: string }[] = []; // package.json / tsconfig.json: they explain imports
    let skippedForLimit = 0;
    for await (const full of walk(dir)) {
      const path = relative(dir, full).split('\\').join('/');
      const base = path.split('/').pop();
      if ((base === 'package.json' || base === 'tsconfig.json') && !isIgnoredPath(path, settings?.ignoredPaths ?? [])) {
        if ((await stat(full)).size <= MAX_FILE_BYTES) configFiles.push({ path, content: await readFile(full, 'utf8') });
        continue;
      }
      const language = languageOf(path);
      if (!language || NON_CODE_LANGUAGES.has(language) || isIgnoredPath(path, settings?.ignoredPaths ?? [])) continue;
      if (files.length >= MAX_FILES) {
        skippedForLimit++;
        continue;
      }
      if ((await stat(full)).size > MAX_FILE_BYTES) continue;
      const content = await readFile(full, 'utf8');
      if (content.includes('\u0000')) continue;
      files.push({ path, language, lines: content.split(/\r?\n/).length, parsed: await parseFile(path, content) });
    }

    await progress(`Linking ${files.length} files`);
    const relations = resolveRelations(files, readProjectConfig(configFiles));
    const symbols = files.flatMap((f) => (f.parsed?.symbols ?? []).map((s) => ({ f, s })));

    await progress('Saving the graph');
    await db.transaction(async (tx) => {
      // the previous graph of this branch is replaced as a whole
      await tx.delete(codeFiles).where(eq(codeFiles.analysisId, analysisId));
      await tx.delete(codeSymbols).where(eq(codeSymbols.analysisId, analysisId));
      await tx.delete(codeRelations).where(eq(codeRelations.analysisId, analysisId));
      const fileRows = files.map((f) => ({
        analysisId, path: f.path, language: f.language, lines: f.lines, packageName: f.parsed?.packageName ?? null,
      }));
      for (let i = 0; i < fileRows.length; i += INSERT_CHUNK) await tx.insert(codeFiles).values(fileRows.slice(i, i + INSERT_CHUNK));
      const symbolRows = symbols.map(({ f, s }) => ({
        analysisId, filePath: f.path, name: s.name, kind: s.kind, container: s.container, startLine: s.startLine, endLine: s.endLine,
      }));
      for (let i = 0; i < symbolRows.length; i += INSERT_CHUNK) await tx.insert(codeSymbols).values(symbolRows.slice(i, i + INSERT_CHUNK));
      const relationRows = relations.map((r) => ({ analysisId, ...r }));
      for (let i = 0; i < relationRows.length; i += INSERT_CHUNK) await tx.insert(codeRelations).values(relationRows.slice(i, i + INSERT_CHUNK));
      await tx
        .update(codeAnalyses)
        .set({
          status: 'ready',
          commitSha: sha,
          progress: skippedForLimit > 0 ? `Analysis capped at ${MAX_FILES} files (${skippedForLimit} not analysed)` : null,
          filesCount: files.length,
          symbolsCount: symbols.length,
          relationsCount: relations.length,
          updatedAt: new Date(),
        })
        .where(eq(codeAnalyses.id, analysisId));
    });
    log('analyze', 'completed', { repoId: job.repoId, branch, files: files.length, symbols: symbols.length, relations: relations.length });
  } catch (err) {
    const message = (err as Error).message.slice(0, 200);
    await db
      .update(codeAnalyses)
      .set({ status: 'failed', progress: message, updatedAt: new Date() })
      .where(eq(codeAnalyses.id, analysisId));
    throw err;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
