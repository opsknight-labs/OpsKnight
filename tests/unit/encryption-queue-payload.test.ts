import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  executeMigrationRun: vi.fn(),
  updateMany: vi.fn(),
  update: vi.fn(),
  findUnique: vi.fn(),
  encryptionMigrationRunUpdate: vi.fn(),
  encryptionMigrationRunFindUnique: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    backgroundJob: {
      updateMany: mocks.updateMany,
      update: mocks.update,
      findUnique: mocks.findUnique,
    },
    encryptionMigrationRun: {
      update: mocks.encryptionMigrationRunUpdate,
      findUnique: mocks.encryptionMigrationRunFindUnique,
    },
  },
}));

vi.mock('@/lib/encryption/migration', () => ({
  executeMigrationRun: mocks.executeMigrationRun,
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { processJob } from '@/lib/jobs/queue';
import { settleEncryptionLifecycleFailure } from '@/lib/encryption/worker';
import type { PrismaClient } from '@prisma/client';

describe('encryption lifecycle queue payload and settlement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.update.mockResolvedValue({});
    mocks.findUnique.mockResolvedValue(null);
  });

  it('correctly extracts runId from ENCRYPTION_LIFECYCLE payload and executes migration run', async () => {
    mocks.executeMigrationRun.mockResolvedValue({
      id: 'run-payload-123',
      status: 'COMPLETED',
    });

    const result = await processJob({
      id: 'job-enc-1',
      type: 'ENCRYPTION_LIFECYCLE',
      status: 'PROCESSING',
      attempts: 1,
      maxAttempts: 3,
      payload: { runId: 'run-payload-123' },
    });

    expect(result).toBe(true);
    expect(mocks.executeMigrationRun).toHaveBeenCalledWith({
      runId: 'run-payload-123',
      prisma: expect.anything(),
    });
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: 'job-enc-1' },
      data: { status: 'COMPLETED', completedAt: expect.any(Date) },
    });
  });

  it('settles PENDING run to FAILED upon terminal failure', async () => {
    const mockPrisma = {
      encryptionMigrationRun: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'run-pending-1',
          status: 'PENDING',
        }),
        update: vi.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: 'run-pending-1',
            status: data.status,
            errorMessage: data.errorMessage,
            completedAt: data.completedAt,
          })
        ),
      },
    } as unknown as PrismaClient;

    const settled = await settleEncryptionLifecycleFailure(
      mockPrisma,
      'run-pending-1',
      'Worker execution timed out'
    );

    expect(settled).toBeDefined();
    expect(settled?.status).toBe('FAILED');
    expect(settled?.errorMessage).toBe('Worker execution timed out');
    expect(mockPrisma.encryptionMigrationRun.update).toHaveBeenCalledWith({
      where: { id: 'run-pending-1' },
      data: {
        status: 'FAILED',
        errorMessage: 'Worker execution timed out',
        completedAt: expect.any(Date),
      },
    });
  });

  it('settles RUNNING run to FAILED upon terminal failure', async () => {
    const mockPrisma = {
      encryptionMigrationRun: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'run-running-1',
          status: 'RUNNING',
        }),
        update: vi.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: 'run-running-1',
            status: data.status,
            errorMessage: data.errorMessage,
            completedAt: data.completedAt,
          })
        ),
      },
    } as unknown as PrismaClient;

    const settled = await settleEncryptionLifecycleFailure(
      mockPrisma,
      'run-running-1',
      'Database connection lost during CAS batch'
    );

    expect(settled?.status).toBe('FAILED');
    expect(settled?.errorMessage).toBe('Database connection lost during CAS batch');
  });

  it('never overwrites terminal states (COMPLETED, CANCELLED, FAILED)', async () => {
    const terminalStatuses = ['COMPLETED', 'CANCELLED', 'FAILED'] as const;

    for (const status of terminalStatuses) {
      const mockPrisma = {
        encryptionMigrationRun: {
          findUnique: vi.fn().mockResolvedValue({
            id: `run-${status.toLowerCase()}`,
            status,
          }),
          update: vi.fn(),
        },
      } as unknown as PrismaClient;

      const result = await settleEncryptionLifecycleFailure(
        mockPrisma,
        `run-${status.toLowerCase()}`,
        'Attempted terminal overwrite'
      );

      expect(result?.status).toBe(status);
      expect(mockPrisma.encryptionMigrationRun.update).not.toHaveBeenCalled();
    }
  });
});
