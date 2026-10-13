import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { and, codeAnalyses, codeFiles, codeRelations, codeSymbols, desc, eq, installations, repositories } from '@codereview/db';
import type { Db } from '@codereview/db';
import { ANALYZE_JOB_OPTIONS, QUEUES } from '@codereview/shared';
import type { Analysis, AnalyzeJobData, BranchesResponse, Diagram, DiagramQuery } from '@codereview/shared';
import { DB } from '../common/db.module.js';
import { GithubService } from '../github/github.service.js';
import { ReposService } from '../repos/repos.service.js';
import { buildDiagram } from './diagrams.js';

const STALE_AFTER_MS = 15 * 60_000; // an "analyzing" row older than this belongs to a job that is gone

const toAnalysis = (r: typeof codeAnalyses.$inferSelect): Analysis => ({
  branch: r.branch,
  status: r.status,
  commitSha: r.commitSha,
  progress: r.progress,
  filesCount: r.filesCount,
  symbolsCount: r.symbolsCount,
  relationsCount: r.relationsCount,
  updatedAt: r.updatedAt.toISOString(),
});

/** Structure analysis of a repository branch: starts the job, lists branches, serves diagrams built from the stored graph. */
@Injectable()
export class AnalysisService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @InjectQueue(QUEUES.ANALYZE) private readonly queue: Queue<AnalyzeJobData>,
    private readonly repos: ReposService,
    private readonly github: GithubService,
  ) {}

  async branches(userId: string, repoId: string): Promise<BranchesResponse> {
    const repo = await this.repos.get(userId, repoId); // ownership check, like every repo route
    const [inst] = await this.db
      .select({ githubInstallationId: installations.githubInstallationId })
      .from(repositories)
      .innerJoin(installations, eq(installations.id, repositories.installationId))
      .where(eq(repositories.id, repo.id));
    const { names, truncated } = await this.github.listBranches(inst!.githubInstallationId, repo.fullName);
    return { defaultBranch: repo.defaultBranch, branches: names, truncated };
  }

  async list(userId: string, repoId: string): Promise<Analysis[]> {
    const repo = await this.repos.get(userId, repoId);
    const rows = await this.db.select().from(codeAnalyses).where(eq(codeAnalyses.repoId, repo.id)).orderBy(desc(codeAnalyses.updatedAt));
    return rows.map(toAnalysis);
  }

  async start(userId: string, repoId: string, requested?: string): Promise<Analysis> {
    const repo = await this.repos.get(userId, repoId);
    const branch = requested ?? repo.defaultBranch;
    if (!branch) throw new BadRequestException('This repository has no default branch: choose a branch.');
    const [current] = await this.db
      .select()
      .from(codeAnalyses)
      .where(and(eq(codeAnalyses.repoId, repo.id), eq(codeAnalyses.branch, branch)));
    if (current?.status === 'analyzing' && Date.now() - current.updatedAt.getTime() < STALE_AFTER_MS) {
      throw new ConflictException('This branch is already being analysed.');
    }
    const [row] = await this.db
      .insert(codeAnalyses)
      .values({ repoId: repo.id, branch, status: 'analyzing', progress: 'Waiting for the worker' })
      .onConflictDoUpdate({
        target: [codeAnalyses.repoId, codeAnalyses.branch],
        set: { status: 'analyzing', progress: 'Waiting for the worker', updatedAt: new Date() },
      })
      .returning();
    await this.queue.add('analyze', { repoId: repo.id, branch }, { ...ANALYZE_JOB_OPTIONS, jobId: `analyze-${repo.id}-${Date.now()}` });
    return toAnalysis(row!);
  }

  async diagram(userId: string, repoId: string, query: DiagramQuery): Promise<Diagram> {
    const repo = await this.repos.get(userId, repoId);
    const branch = query.branch ?? repo.defaultBranch;
    if (!branch) throw new BadRequestException('Choose a branch.');
    const [analysis] = await this.db
      .select()
      .from(codeAnalyses)
      .where(and(eq(codeAnalyses.repoId, repo.id), eq(codeAnalyses.branch, branch)));
    if (!analysis) throw new NotFoundException('This branch has not been analysed yet.');
    // a failed re-analysis keeps the previous graph, so only "nothing stored yet" blocks the diagram
    if (analysis.status !== 'ready' && analysis.filesCount === 0) {
      throw new ConflictException(analysis.status === 'analyzing' ? 'The analysis is still running.' : `The analysis failed: ${analysis.progress ?? 'unknown error'}`);
    }
    const [files, symbols, relations] = await Promise.all([
      this.db.select({ path: codeFiles.path, language: codeFiles.language, lines: codeFiles.lines }).from(codeFiles).where(eq(codeFiles.analysisId, analysis.id)),
      this.db
        .select({
          filePath: codeSymbols.filePath, name: codeSymbols.name, kind: codeSymbols.kind, container: codeSymbols.container,
          startLine: codeSymbols.startLine, endLine: codeSymbols.endLine,
        })
        .from(codeSymbols)
        .where(eq(codeSymbols.analysisId, analysis.id)),
      this.db
        .select({
          kind: codeRelations.kind, fromFile: codeRelations.fromFile, fromSymbol: codeRelations.fromSymbol, toFile: codeRelations.toFile,
          toSymbol: codeRelations.toSymbol, toExternal: codeRelations.toExternal, confidence: codeRelations.confidence,
        })
        .from(codeRelations)
        .where(eq(codeRelations.analysisId, analysis.id)),
    ]);
    return buildDiagram(
      query.kind,
      { files, symbols, relations },
      { scope: query.scope, depth: query.depth, external: query.external, limit: query.limit },
      { branch, commitSha: analysis.commitSha },
    );
  }
}
