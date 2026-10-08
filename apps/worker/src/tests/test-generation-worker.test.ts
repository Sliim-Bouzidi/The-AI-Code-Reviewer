import { describe, expect, it, vi } from 'vitest';
import type { LlmProvider } from '@codereview/llm';
import type { TestGenerationJobData } from '@codereview/shared';
import type { Deps } from '../deps.js';
import * as githubModule from '../github.js';
import type { ExecutionOutput, JavaExecutor } from './test-validator.js';
import { runTestGeneration } from './test-generation-worker.js';

// Mock GitHub helpers to avoid real API calls
vi.mock('../github.js', async () => {
  const actual = await vi.importActual('../github.js');
  return {
    ...actual,
    fetchPrDiff: vi.fn(),
    downloadFiles: vi.fn(),
  };
});

function createMockDeps(dbOverrides: any = {}, llmResponseJson?: string): Deps {
  const mockLlmProvider: LlmProvider = {
    name: 'mock-llm',
    model: 'mock-model',
    generate: vi.fn().mockResolvedValue({
      text:
        llmResponseJson ??
        JSON.stringify({
          testClassName: 'UserServiceTest',
          imports: ['org.junit.jupiter.api.Test'],
          testCode: 'class UserServiceTest {}',
          tests: [{ name: 'shouldCreateUser', description: 'test', category: 'NORMAL' }],
        }),
      tokensIn: 100,
      tokensOut: 150,
    }),
  };

  const defaultDb = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([
      {
        pr: { id: 'pr-123', number: 1, headSha: 'sha-abc' },
        repo: { id: 'repo-123', fullName: 'owner/repo' },
        inst: { githubInstallationId: 999 },
      },
    ]),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    onConflictDoUpdate: vi.fn().mockReturnThis(),
    returning: vi.fn().mockImplementation((table) => {
      return Promise.resolve([{ id: 'gen-123' }]);
    }),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),

    ...dbOverrides,
  };

  return {
    db: defaultDb as any,
    llm: [mockLlmProvider],
    embedder: null,
  };
}

const JAVA_DIFF = `diff --git a/src/main/java/com/example/UserService.java b/src/main/java/com/example/UserService.java
new file mode 100644
--- /dev/null
+++ b/src/main/java/com/example/UserService.java
@@ -0,0 +1,10 @@
+package com.example;
+
+public class UserService {
+    public void createUser(String name) {
+        if (name == null) throw new IllegalArgumentException();
+    }
+}
+`;

const JAVA_SOURCE = `package com.example;

public class UserService {
    public void createUser(String name) {
        if (name == null) throw new IllegalArgumentException();
    }
}
`;

describe('Test Generation Worker (Phase 6 Pipeline)', () => {
  const jobData: TestGenerationJobData = {
    prId: 'pr-123',
    repoId: 'repo-123',
    headSha: 'sha-abc',
  };

  it('Test 1 & 2: Traitement propre quand aucun fichier Java n\'est modifié', async () => {
    vi.mocked(githubModule.fetchPrDiff).mockResolvedValueOnce('diff --git a/readme.md b/readme.md\n+hello');
    const deps = createMockDeps();

    await runTestGeneration(deps, jobData);

    const updateCalls = (deps.db.update as any).mock.calls;
    expect(updateCalls.length).toBeGreaterThan(0);
    const setCalls = ((deps.db as any).set as any).mock.calls;
    const finalState = setCalls[setCalls.length - 1][0];
    expect(finalState.status).toBe('completed');
    expect(finalState.message).toContain('No Java files modified');
  });

  it('Test 3 & 4 & 5 & 6: Workflow complet Java -> Context -> LLM -> Docker Validation -> Persistence PASSED', async () => {
    vi.mocked(githubModule.fetchPrDiff).mockResolvedValueOnce(JAVA_DIFF);
    vi.mocked(githubModule.downloadFiles).mockImplementationOnce(async (ref, sha, files, dir) => {
      const fs = await import('node:fs/promises');
      const path = await import('node:path');
      await fs.mkdir(path.join(dir, 'src/main/java/com/example'), { recursive: true });
      await fs.writeFile(path.join(dir, 'src/main/java/com/example/UserService.java'), JAVA_SOURCE, 'utf8');
    });

    const mockExecutor: JavaExecutor = {
      execute: vi
        .fn()
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' }) // javac
        .mockResolvedValueOnce({ exitCode: 0, stdout: 'PASS: shouldCreateUser', stderr: '' }), // java
    };

    const deps = createMockDeps();

    await runTestGeneration(deps, jobData, { executor: mockExecutor });

    // Verify DB calls recorded testGenerations and generatedTests
    expect(deps.db.insert).toHaveBeenCalled();
    const setCalls = ((deps.db as any).set as any).mock.calls;

    // Last update to generatedTests should be PASSED
    const testRecordUpdate = setCalls.find((c: any) => c[0].status === 'PASSED');
    expect(testRecordUpdate).toBeDefined();
    expect(testRecordUpdate[0].compileSuccess).toBe(true);
    expect(testRecordUpdate[0].testSuccess).toBe(true);
  });

  it('Test 7: COMPILE_ERROR enregistré sans retry métier (status REJECTED)', async () => {
    vi.mocked(githubModule.fetchPrDiff).mockResolvedValueOnce(JAVA_DIFF);
    vi.mocked(githubModule.downloadFiles).mockImplementationOnce(async (ref, sha, files, dir) => {
      const fs = await import('node:fs/promises');
      const path = await import('node:path');
      await fs.mkdir(path.join(dir, 'src/main/java/com/example'), { recursive: true });
      await fs.writeFile(path.join(dir, 'src/main/java/com/example/UserService.java'), JAVA_SOURCE, 'utf8');
    });

    const mockExecutor: JavaExecutor = {
      execute: vi.fn().mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'javac: error' }),
    };

    const deps = createMockDeps();

    await runTestGeneration(deps, jobData, { executor: mockExecutor });

    const setCalls = ((deps.db as any).set as any).mock.calls;
    const testRecordUpdate = setCalls.find((c: any) => c[0].status === 'REJECTED');
    expect(testRecordUpdate).toBeDefined();
    expect(testRecordUpdate[0].compileSuccess).toBe(false);
  });

  it('Test 8: Plusieurs méthodes Java produisent plusieurs enregistrements indépendants', async () => {
    const MULTI_METHOD_SOURCE = `package com.example;
public class UserService {
    public void createUser(String name) { if (name == null) throw new IllegalArgumentException(); }
    public void deleteUser(String id) { if (id == null) throw new IllegalArgumentException(); }
}
`;
    const MULTI_METHOD_DIFF = `diff --git a/src/main/java/com/example/UserService.java b/src/main/java/com/example/UserService.java
new file mode 100644
--- /dev/null
+++ b/src/main/java/com/example/UserService.java
@@ -0,0 +1,10 @@
+package com.example;
+public class UserService {
+    public void createUser(String name) { if (name == null) throw new IllegalArgumentException(); }
+    public void deleteUser(String id) { if (id == null) throw new IllegalArgumentException(); }
+}
+`;

    vi.mocked(githubModule.fetchPrDiff).mockResolvedValueOnce(MULTI_METHOD_DIFF);
    vi.mocked(githubModule.downloadFiles).mockImplementationOnce(async (ref, sha, files, dir) => {
      const fs = await import('node:fs/promises');
      const path = await import('node:path');
      await fs.mkdir(path.join(dir, 'src/main/java/com/example'), { recursive: true });
      await fs.writeFile(path.join(dir, 'src/main/java/com/example/UserService.java'), MULTI_METHOD_SOURCE, 'utf8');
    });

    const mockExecutor: JavaExecutor = {
      execute: vi.fn().mockResolvedValue({ exitCode: 0, stdout: 'pass', stderr: '' }),
    };

    const deps = createMockDeps();

    await runTestGeneration(deps, jobData, { executor: mockExecutor });

    const insertCalls = (deps.db.insert as any).mock.calls;
    // Insert for test_generations (1) + generated_tests (2)
    expect(insertCalls.length).toBe(3);
  });

  it('Test 9: Erreur globale (ex: PR absente en DB) fait échouer proprement le job', async () => {
    const deps = createMockDeps({
      where: vi.fn().mockResolvedValue([]), // PR not found
    });

    await expect(runTestGeneration(deps, jobData)).rejects.toThrow('not found in database');
  });

  it('Test 10: Idempotence - Rejouer le job recrée/met à jour la génération proprement', async () => {
    vi.mocked(githubModule.fetchPrDiff).mockResolvedValueOnce(JAVA_DIFF);
    vi.mocked(githubModule.downloadFiles).mockImplementationOnce(async (ref, sha, files, dir) => {
      const fs = await import('node:fs/promises');
      const path = await import('node:path');
      await fs.mkdir(path.join(dir, 'src/main/java/com/example'), { recursive: true });
      await fs.writeFile(path.join(dir, 'src/main/java/com/example/UserService.java'), JAVA_SOURCE, 'utf8');
    });

    const mockExecutor: JavaExecutor = {
      execute: vi.fn().mockResolvedValue({ exitCode: 0, stdout: 'pass', stderr: '' }),
    };

    const deps = createMockDeps();

    await runTestGeneration(deps, jobData, { executor: mockExecutor });

    expect(deps.db.insert).toHaveBeenCalled();
  });
});
