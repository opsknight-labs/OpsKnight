import { describe, expect, it, vi } from 'vitest';
import { shouldEvaluateControl } from '@/lib/compliance/monitoring/schedule';
import type { ComplianceControlEvaluator } from '@/lib/compliance/evaluators/types';
import type { ComplianceControlState } from '@prisma/client';

describe('shouldEvaluateControl', () => {
  const dummyEvaluator: ComplianceControlEvaluator = {
    id: 'eval-enc-01',
    version: '1.0.0',
    evaluate: async () => ({
      status: 'IMPLEMENTED',
      findings: [],
      evidence: [],
      summary: 'Pass',
    }),
  };

  const now = new Date('2026-09-20T12:00:00.000Z');
  const intervalMinutes = 60;

  it('returns due=true when state is null (no previous evaluation)', () => {
    const result = shouldEvaluateControl({
      state: null,
      evaluator: dummyEvaluator,
      now,
      intervalMinutes,
    });
    expect(result.due).toBe(true);
    expect(result.reason).toBe('NO_PREVIOUS_EVALUATION');
  });

  it('returns due=true when evaluator version differs from state', () => {
    const state: Partial<ComplianceControlState> = {
      controlId: 'ENC-01',
      evaluatorVersion: '0.9.0',
      evaluatedAt: new Date('2026-09-20T11:30:00.000Z'),
      validUntil: new Date('2026-09-20T13:00:00.000Z'),
    };

    const result = shouldEvaluateControl({
      state: state as ComplianceControlState,
      evaluator: dummyEvaluator, // version 1.0.0
      now,
      intervalMinutes,
    });
    expect(result.due).toBe(true);
    expect(result.reason).toBe('EVALUATOR_VERSION_CHANGED');
  });

  it('returns due=false when evaluation is fresh and validUntil is in the future', () => {
    const state: Partial<ComplianceControlState> = {
      controlId: 'ENC-01',
      evaluatorVersion: '1.0.0',
      evaluatedAt: new Date('2026-09-20T11:45:00.000Z'), // 15 mins ago
      validUntil: new Date('2026-09-20T13:00:00.000Z'), // expires in 1h
    };

    const result = shouldEvaluateControl({
      state: state as ComplianceControlState,
      evaluator: dummyEvaluator,
      now,
      intervalMinutes,
    });
    expect(result.due).toBe(false);
    expect(result.reason).toBe('CURRENT');
  });

  it('returns due=true when validUntil has expired', () => {
    const state: Partial<ComplianceControlState> = {
      controlId: 'ENC-01',
      evaluatorVersion: '1.0.0',
      evaluatedAt: new Date('2026-09-20T10:00:00.000Z'),
      validUntil: new Date('2026-09-20T11:00:00.000Z'), // expired 1h ago
    };

    const result = shouldEvaluateControl({
      state: state as ComplianceControlState,
      evaluator: dummyEvaluator,
      now,
      intervalMinutes,
    });
    expect(result.due).toBe(true);
    expect(result.reason).toBe('EVALUATION_EXPIRED');
  });

  it('returns due=true when interval has elapsed without validUntil', () => {
    const state: Partial<ComplianceControlState> = {
      controlId: 'ENC-01',
      evaluatorVersion: '1.0.0',
      evaluatedAt: new Date('2026-09-20T10:00:00.000Z'), // 2 hours ago
      validUntil: null,
    };

    const result = shouldEvaluateControl({
      state: state as ComplianceControlState,
      evaluator: dummyEvaluator,
      now,
      intervalMinutes: 60, // 1 hour interval
    });
    expect(result.due).toBe(true);
    expect(result.reason).toBe('INTERVAL_ELAPSED');
  });
});

describe('ensureComplianceMonitoringScheduled', () => {
  it('recreates background job when PENDING run exists without active job', async () => {
    const { ensureComplianceMonitoringScheduled } =
      await import('@/lib/compliance/monitoring/schedule');

    const mockRun = {
      id: 'run-pending-1',
      scheduledFor: new Date('2026-09-20T12:00:00.000Z'),
      status: 'PENDING',
    };

    const mockTx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      complianceMonitoringRun: {
        findFirst: vi.fn().mockResolvedValue(mockRun),
        create: vi.fn(),
        update: vi.fn(),
      },
      backgroundJob: {
        findMany: vi.fn().mockResolvedValue([]), // Job missing!
        create: vi.fn().mockResolvedValue({ id: 'job-recreated' }),
      },
    };

    const mockPrisma = {
      $transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb(mockTx)),
    };

    const result = await ensureComplianceMonitoringScheduled(
      mockPrisma as never,
      new Date('2026-09-20T12:05:00.000Z')
    );

    expect(result.scheduled).toBe(true);
    expect(result.reason).toBe('RECREATED_JOB_FOR_PENDING_RUN');
    expect(mockTx.backgroundJob.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'COMPLIANCE_EVALUATION_SWEEP',
          payload: { monitorRunId: 'run-pending-1' },
        }),
      })
    );
    expect(mockTx.complianceMonitoringRun.create).not.toHaveBeenCalled();
  });

  it('marks orphan RUNNING run as FAILED and creates replacement run when job is missing', async () => {
    const { ensureComplianceMonitoringScheduled } =
      await import('@/lib/compliance/monitoring/schedule');

    const mockRun = {
      id: 'run-abandoned-1',
      scheduledFor: new Date('2026-09-20T11:00:00.000Z'),
      status: 'RUNNING',
    };

    const mockTx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      complianceMonitoringRun: {
        findFirst: vi.fn().mockResolvedValue(mockRun),
        update: vi.fn().mockResolvedValue({ ...mockRun, status: 'FAILED' }),
        create: vi.fn().mockResolvedValue({ id: 'run-replacement' }),
      },
      backgroundJob: {
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockResolvedValue({ id: 'job-replacement' }),
      },
    };

    const mockPrisma = {
      $transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb(mockTx)),
    };

    const result = await ensureComplianceMonitoringScheduled(
      mockPrisma as never,
      new Date('2026-09-20T12:05:00.000Z')
    );

    expect(result.scheduled).toBe(true);
    expect(mockTx.complianceMonitoringRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'run-abandoned-1' },
        data: expect.objectContaining({
          status: 'FAILED',
          errorSummary: { reason: 'ORPHAN_RUN_WITHOUT_ACTIVE_JOB' },
        }),
      })
    );
    expect(mockTx.complianceMonitoringRun.create).toHaveBeenCalled();
    expect(mockTx.backgroundJob.create).toHaveBeenCalled();
  });

  it('recreates background job when PENDING run exists and active job belongs to a different run', async () => {
    const { ensureComplianceMonitoringScheduled } =
      await import('@/lib/compliance/monitoring/schedule');

    const mockRun = {
      id: 'run-pending-A',
      scheduledFor: new Date('2026-09-20T12:00:00.000Z'),
      status: 'PENDING',
    };

    const unrelatedJob = {
      id: 'job-unrelated-B',
      type: 'COMPLIANCE_EVALUATION_SWEEP',
      status: 'PENDING',
      payload: { monitorRunId: 'run-unrelated-B' },
    };

    const mockTx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      complianceMonitoringRun: {
        findFirst: vi.fn().mockResolvedValue(mockRun),
        create: vi.fn(),
        update: vi.fn(),
      },
      backgroundJob: {
        findMany: vi.fn().mockResolvedValue([unrelatedJob]),
        create: vi.fn().mockResolvedValue({ id: 'job-recreated-A' }),
      },
    };

    const mockPrisma = {
      $transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb(mockTx)),
    };

    const result = await ensureComplianceMonitoringScheduled(
      mockPrisma as never,
      new Date('2026-09-20T12:05:00.000Z')
    );

    expect(result.scheduled).toBe(true);
    expect(result.reason).toBe('RECREATED_JOB_FOR_PENDING_RUN');
    expect(mockTx.backgroundJob.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'COMPLIANCE_EVALUATION_SWEEP',
          payload: { monitorRunId: 'run-pending-A' },
        }),
      })
    );
  });

  it('returns ALREADY_SCHEDULED when an active job matches the existing run', async () => {
    const { ensureComplianceMonitoringScheduled } =
      await import('@/lib/compliance/monitoring/schedule');

    const mockRun = {
      id: 'run-active-1',
      scheduledFor: new Date('2026-09-20T12:00:00.000Z'),
      status: 'PENDING',
    };

    const matchingJob = {
      id: 'job-active-1',
      type: 'COMPLIANCE_EVALUATION_SWEEP',
      status: 'PENDING',
      payload: { monitorRunId: 'run-active-1' },
    };

    const mockTx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      complianceMonitoringRun: {
        findFirst: vi.fn().mockResolvedValue(mockRun),
        create: vi.fn(),
        update: vi.fn(),
      },
      backgroundJob: {
        findMany: vi.fn().mockResolvedValue([matchingJob]),
        create: vi.fn(),
      },
    };

    const mockPrisma = {
      $transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb(mockTx)),
    };

    const result = await ensureComplianceMonitoringScheduled(
      mockPrisma as never,
      new Date('2026-09-20T12:05:00.000Z')
    );

    expect(result.scheduled).toBe(false);
    expect(result.reason).toBe('ALREADY_SCHEDULED');
    expect(mockTx.backgroundJob.create).not.toHaveBeenCalled();
  });
});
