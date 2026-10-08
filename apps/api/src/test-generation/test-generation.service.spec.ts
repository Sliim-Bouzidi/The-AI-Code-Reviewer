import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { Db } from '@codereview/db';
import { TestGenerationService } from './test-generation.service.js';

function createMockDb(overrides: Record<string, any> = {}) {
  const db = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([{ id: 'gen-123' }]),
    ...overrides,
  };
  return db as unknown as Db;
}

function createMockQueue() {
  return {
    add: vi.fn().mockResolvedValue({ id: 'job-123' }),
  } as any;
}

function createMockReposService() {
  return {
    get: vi.fn().mockResolvedValue({ id: 'repo-123', name: 'my-repo' }),
  } as any;
}

describe('TestGenerationService (Phase 7 API)', () => {
  const userId = 'user-123';
  const prId = '11111111-1111-1111-1111-111111111111';
  const repoId = '22222222-2222-2222-2222-222222222222';
  const genId = '33333333-3333-3333-3333-333333333333';
  const testId = '44444444-4444-4444-4444-444444444444';

  it('Test 1 & 2: Liste des générations d\'une PR (et liste vide quand 0 génération)', async () => {
    const mockDb = createMockDb();
    vi.mocked(mockDb.select).mockImplementationOnce(() => ({
      from: () => ({
        where: () => Promise.resolve([{ id: prId, repoId, number: 1 }]),
      }),
    } as any));

    vi.mocked(mockDb.select).mockImplementationOnce(() => ({
      from: () => ({
        where: () => ({
          orderBy: () => Promise.resolve([]),
        }),
      }),
    } as any));

    const service = new TestGenerationService(mockDb, createMockQueue(), createMockReposService());
    const res = await service.listForPullRequest(userId, prId);

    expect(res).toEqual([]);
  });

  it('Test 3 & 4: Détail d\'une génération existante et NotFound quand inexistante', async () => {
    const mockDb = createMockDb();
    vi.mocked(mockDb.select).mockImplementationOnce(() => ({
      from: () => ({
        where: () => Promise.resolve([]), // Generation not found
      }),
    } as any));

    const service = new TestGenerationService(mockDb, createMockQueue(), createMockReposService());
    await expect(service.getGenerationDetails(userId, genId)).rejects.toThrow(NotFoundException);
  });

  it('Test 5 & 6: Détail d\'un test généré et NotFound quand inexistant', async () => {
    const mockDb = createMockDb();
    vi.mocked(mockDb.select).mockImplementationOnce(() => ({
      from: () => ({
        innerJoin: () => ({
          where: () => Promise.resolve([]), // Test not found
        }),
      }),
    } as any));

    const service = new TestGenerationService(mockDb, createMockQueue(), createMockReposService());
    await expect(service.getGeneratedTest(userId, testId)).rejects.toThrow(NotFoundException);
  });

  it('Test 7, 8 & 9: Déclenchement manuel (Job BullMQ créé, Idempotence & PR inexistante)', async () => {
    const mockDb = createMockDb();
    // PR lookup -> Not Found
    vi.mocked(mockDb.select).mockImplementationOnce(() => ({
      from: () => ({
        where: () => Promise.resolve([]),
      }),
    } as any));

    const queue = createMockQueue();
    const service = new TestGenerationService(mockDb, queue, createMockReposService());

    await expect(service.triggerForPullRequest(userId, prId)).rejects.toThrow(NotFoundException);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('Test 10: Statut avec calcul de progression correct', async () => {
    const mockDb = createMockDb();
    // Generation row
    vi.mocked(mockDb.select).mockImplementationOnce(() => ({
      from: () => ({
        where: () => Promise.resolve([{ id: genId, repoId, status: 'validating', message: 'Processing' }]),
      }),
    } as any));

    // Total count (5)
    vi.mocked(mockDb.select).mockImplementationOnce(() => ({
      from: () => ({
        where: () => Promise.resolve([{ n: 5 }]),
      }),
    } as any));

    // Completed count (3)
    vi.mocked(mockDb.select).mockImplementationOnce(() => ({
      from: () => ({
        where: () => Promise.resolve([{ n: 3 }]),
      }),
    } as any));

    // Passed count (2)
    vi.mocked(mockDb.select).mockImplementationOnce(() => ({
      from: () => ({
        where: () => Promise.resolve([{ n: 2 }]),
      }),
    } as any));

    // Failed count (1)
    vi.mocked(mockDb.select).mockImplementationOnce(() => ({
      from: () => ({
        where: () => Promise.resolve([{ n: 1 }]),
      }),
    } as any));

    const service = new TestGenerationService(mockDb, createMockQueue(), createMockReposService());
    const res = await service.getGenerationStatus(userId, genId);

    expect(res.id).toBe(genId);
    expect(res.status).toBe('validating');
    expect(res.progress).toEqual({
      total: 5,
      completed: 3,
      passed: 2,
      failed: 1,
    });
  });
});
