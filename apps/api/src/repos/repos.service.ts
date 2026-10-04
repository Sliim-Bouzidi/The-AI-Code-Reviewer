import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, installations, repoSettings, repositories } from '@codereview/db';
import type { Db } from '@codereview/db';
import { DEFAULT_REPO_SETTINGS } from '@codereview/shared';
import type { Repo, RepoSettings } from '@codereview/shared';
import { DB } from '../common/db.module.js';

const repoColumns = {
  id: repositories.id,
  fullName: repositories.fullName,
  defaultBranch: repositories.defaultBranch,
  enabled: repositories.enabled,
  indexStatus: repositories.indexStatus,
  lastIndexedSha: repositories.lastIndexedSha,
};

/** Every repo lookup goes through here so a user only ever sees repos of their own installations. */
@Injectable()
export class ReposService {
  constructor(@Inject(DB) private readonly db: Db) {}

  list(userId: string): Promise<Repo[]> {
    return this.db
      .select(repoColumns)
      .from(repositories)
      .innerJoin(installations, eq(installations.id, repositories.installationId))
      .where(eq(installations.userId, userId))
      .orderBy(repositories.fullName);
  }

  async get(userId: string, repoId: string): Promise<Repo> {
    if (!/^[0-9a-f-]{36}$/i.test(repoId)) throw new NotFoundException('Repo not found');
    const [repo] = await this.db
      .select(repoColumns)
      .from(repositories)
      .innerJoin(installations, eq(installations.id, repositories.installationId))
      .where(and(eq(installations.userId, userId), eq(repositories.id, repoId)));
    if (!repo) throw new NotFoundException('Repo not found');
    return repo;
  }

  async findByFullName(userId: string, fullName: string): Promise<Repo | null> {
    const [repo] = await this.db
      .select(repoColumns)
      .from(repositories)
      .innerJoin(installations, eq(installations.id, repositories.installationId))
      .where(and(eq(installations.userId, userId), eq(repositories.fullName, fullName)));
    return repo ?? null;
  }

  async settings(repoId: string): Promise<RepoSettings> {
    const [s] = await this.db.select().from(repoSettings).where(eq(repoSettings.repoId, repoId));
    if (!s) return DEFAULT_REPO_SETTINGS;
    return { strictness: s.strictness, customRules: s.customRules, ignoredPaths: s.ignoredPaths, maxComments: s.maxComments };
  }

  async updateSettings(repoId: string, patch: Partial<RepoSettings>): Promise<RepoSettings> {
    const next = { ...(await this.settings(repoId)), ...patch };
    await this.db
      .insert(repoSettings)
      .values({ repoId, ...next })
      .onConflictDoUpdate({ target: repoSettings.repoId, set: next });
    return next;
  }

  async setEnabled(repoId: string, enabled: boolean): Promise<void> {
    await this.db.update(repositories).set({ enabled }).where(eq(repositories.id, repoId));
  }
}
