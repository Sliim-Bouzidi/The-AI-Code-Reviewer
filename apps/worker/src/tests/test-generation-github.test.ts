import { describe, expect, it, vi } from 'vitest';
import type { SummaryGenerationRecord, SummaryTestItemRecord } from './test-generation-github.js';
import {
  TEST_GEN_COMMENT_MARKER,
  formatStatusBadge,
  formatTestGenerationMarkdown,
  publishTestGenerationToGithub,
} from './test-generation-github.js';
import * as githubModule from '../github.js';

vi.mock('../github.js', async () => {
  const actual = await vi.importActual('../github.js');
  return {
    ...actual,
    postOrUpdatePrComment: vi.fn(),
  };
});

describe('TestGenerationGithubService (Phase 9 - GitHub Integration)', () => {
  describe('Markdown Formatter & Badges', () => {
    it('1. Correctly formats status badges for all statuses', () => {
      expect(formatStatusBadge('PASSED')).toBe('✅ PASSED');
      expect(formatStatusBadge('FAILED')).toBe('❌ FAILED');
      expect(formatStatusBadge('TEST_FAILURE')).toBe('❌ FAILED');
      expect(formatStatusBadge('REJECTED')).toBe('⚠️ COMPILE ERROR');
      expect(formatStatusBadge('COMPILE_ERROR')).toBe('⚠️ COMPILE ERROR');
      expect(formatStatusBadge('TIMEOUT')).toBe('⌛ TIMEOUT');
      expect(formatStatusBadge('ERROR')).toBe('🚨 ERROR');
    });

    it('2. Formats COMPLETED generation markdown with statistics table', () => {
      const mockGen: SummaryGenerationRecord = {
        id: 'gen-123',
        status: 'completed',
        message: 'Processed 2 methods',
      };

      const mockTests: SummaryTestItemRecord[] = [
        {
          sourceFile: 'src/UserService.java',
          className: 'UserService',
          methodName: 'createUser',
          testClassName: 'UserServiceTest',
          status: 'PASSED',
        },
        {
          sourceFile: 'src/UserService.java',
          className: 'UserService',
          methodName: 'deleteUser',
          testClassName: 'UserServiceTest',
          status: 'REJECTED',
        },
      ];

      const markdown = formatTestGenerationMarkdown(mockGen, mockTests);

      expect(markdown).toContain(TEST_GEN_COMMENT_MARKER);
      expect(markdown).toContain('## 🤖 Automatic Test Generation');
      expect(markdown).toContain('* **Methods analyzed:** 2');
      expect(markdown).toContain('* **Passed:** 1');
      expect(markdown).toContain('* **Compile errors:** 1');
      expect(markdown).toContain('| `src/UserService.java` | `UserService` | `createUser()` | `UserServiceTest` | ✅ PASSED |');
      expect(markdown).toContain('| `src/UserService.java` | `UserService` | `deleteUser()` | `UserServiceTest` | ⚠️ COMPILE ERROR |');
    });

    it('3. Formats FAILED generation markdown with clear cause and ID', () => {
      const mockGen: SummaryGenerationRecord = {
        id: 'gen-999',
        status: 'failed',
        message: 'Tree-sitter parse error in Calculator.java',
      };

      const markdown = formatTestGenerationMarkdown(mockGen, []);

      expect(markdown).toContain(TEST_GEN_COMMENT_MARKER);
      expect(markdown).toContain('## 🤖 Automatic Test Generation — Failed');
      expect(markdown).toContain('`gen-999`');
      expect(markdown).toContain('Tree-sitter parse error in Calculator.java');
    });
  });

  describe('Idempotence & Error Isolation', () => {
    it('4. Returns false for pending or active non-terminal statuses', async () => {
      const mockDb = {
        select: () => ({
          from: () => ({
            where: vi.fn().mockResolvedValue([{ id: 'gen-1', status: 'generating' }]),
          }),
        }),
      } as any;

      const mockDeps = { db: mockDb } as any;

      const res = await publishTestGenerationToGithub(mockDeps, {
        ref: { installationId: 1, owner: 'owner', repo: 'repo' },
        prNumber: 42,
        generationId: 'gen-1',
      });

      expect(res).toBe(false);
    });

    it('5. Handles GitHub API error cleanly without throwing (Error Isolation)', async () => {
      const mockGen = { id: 'gen-1', status: 'completed', prId: 'pr-1' };
      const mockDb = {
        select: () => ({
          from: () => ({
            where: vi.fn().mockImplementation(() => {
              return Promise.resolve([mockGen]);
            }),
          }),
        }),
      } as any;

      const mockDeps = { db: mockDb } as any;

      vi.mocked(githubModule.postOrUpdatePrComment).mockRejectedValueOnce(
        new Error('GitHub API Rate Limit Exceeded (403)'),
      );

      const res = await publishTestGenerationToGithub(mockDeps, {
        ref: { installationId: 1, owner: 'owner', repo: 'repo' },
        prNumber: 42,
        generationId: 'gen-1',
      });

      // Isolates error: Returns false instead of crashing the job!
      expect(res).toBe(false);
    });

    it('6. Idempotently calls postOrUpdatePrComment for completed generation', async () => {
      const mockGen = { id: 'gen-1', status: 'completed', prId: 'pr-1' };
      const mockTests = [
        {
          id: 'test-1',
          generationId: 'gen-1',
          sourceFile: 'src/UserService.java',
          className: 'UserService',
          methodName: 'createUser',
          testClassName: 'UserServiceTest',
          status: 'PASSED',
        },
      ];

      const updateSetFn = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) });
      const mockDb = {
        select: () => ({
          from: () => ({
            where: vi.fn().mockImplementation(() => {
              return Promise.resolve([mockGen]);
            }),
          }),
        }),
        update: () => ({
          set: updateSetFn,
        }),
      } as any;

      // Override second select for generatedTests
      let selectCount = 0;
      mockDb.select = () => ({
        from: () => ({
          where: vi.fn().mockImplementation(() => {
            selectCount++;
            if (selectCount === 1) return Promise.resolve([mockGen]);
            return Promise.resolve(mockTests);
          }),
        }),
      });

      const mockDeps = { db: mockDb } as any;

      vi.mocked(githubModule.postOrUpdatePrComment).mockResolvedValueOnce(12345);

      const res = await publishTestGenerationToGithub(mockDeps, {
        ref: { installationId: 1, owner: 'owner', repo: 'repo' },
        prNumber: 42,
        generationId: 'gen-1',
      });

      expect(res).toBe(true);
      expect(githubModule.postOrUpdatePrComment).toHaveBeenCalledWith(
        { installationId: 1, owner: 'owner', repo: 'repo' },
        42,
        TEST_GEN_COMMENT_MARKER,
        expect.stringContaining('## 🤖 Automatic Test Generation'),
      );
      expect(updateSetFn).toHaveBeenCalledWith(expect.objectContaining({ postedToGithub: true }));
    });

    it('7. Security Verification: Ensures no tokens or secrets in markdown', () => {
      const mockGen: SummaryGenerationRecord = {
        id: 'gen-sec',
        status: 'completed',
        message: null,
      };

      const mockTests: SummaryTestItemRecord[] = [
        {
          sourceFile: 'src/Security.java',
          className: 'Security',
          methodName: 'login',
          testClassName: 'SecurityTest',
          status: 'PASSED',
        },
      ];

      const markdown = formatTestGenerationMarkdown(mockGen, mockTests);

      expect(markdown).not.toContain('ghp_');
      expect(markdown).not.toContain('CLERK_SECRET');
      expect(markdown).not.toContain('DATABASE_URL');
      expect(markdown).not.toContain('REDIS_URL');
      expect(markdown).not.toContain('AIzaSy');
    });
  });
});
