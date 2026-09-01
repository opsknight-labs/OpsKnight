import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  runSerializableTransaction: vi.fn(),
  initializeEscalationExecution: vi.fn(),
  recreateDueEscalationJob: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    incident: { findMany: vi.fn(), updateMany: vi.fn() },
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
  },
}));

vi.mock('@/lib/db-utils', () => ({
  runSerializableTransaction: mocks.runSerializableTransaction,
}));

vi.mock('@/lib/escalation/repository', () => ({
  initializeEscalationExecution: mocks.initializeEscalationExecution,
  recreateDueEscalationJob: mocks.recreateDueEscalationJob,
}));

import prisma from '@/lib/prisma';
import { reconcileEscalations } from '@/lib/escalation/recovery';

const NOW = new Date('2026-06-01T12:00:00.000Z');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.runSerializableTransaction.mockImplementation(async callback => callback({}));
  mocks.initializeEscalationExecution.mockResolvedValue({ initialized: true, dueAt: NOW });
  mocks.recreateDueEscalationJob.mockResolvedValue('job-new');
  vi.mocked(prisma.incident.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.incident.updateMany).mockResolvedValue({ count: 0 } as never);
  vi.mocked(prisma.$queryRaw).mockResolvedValue([] as never);
  vi.mocked(prisma.$executeRaw).mockResolvedValue(0 as never);
});

describe('reconcileEscalations', () => {
  it('reports nothing to repair on a healthy system', async () => {
    await expect(reconcileEscalations({ now: NOW })).resolves.toEqual({
      executionsInitialized: 0,
      dueJobsRecreated: 0,
      staleJobsCancelled: 0,
      leasesReleased: 0,
      errors: [],
    });
  });

  it('arms an OPEN incident whose service has a policy but no execution', async () => {
    vi.mocked(prisma.incident.findMany)
      // Case A: unarmed executions.
      .mockResolvedValueOnce([{ id: 'inc-1', serviceId: 'svc-1' }] as never)
      // Case B: nothing due.
      .mockResolvedValueOnce([] as never);

    const report = await reconcileEscalations({ now: NOW });

    expect(report.executionsInitialized).toBe(1);
    expect(mocks.initializeEscalationExecution).toHaveBeenCalledWith(expect.anything(), {
      incidentId: 'inc-1',
      serviceId: 'svc-1',
      now: NOW,
    });
  });

  it('only looks for unarmed executions on services that actually have steps', async () => {
    await reconcileEscalations({ now: NOW });

    const where = (
      vi.mocked(prisma.incident.findMany).mock.calls[0][0] as never as {
        where: Record<string, unknown>;
      }
    ).where;
    expect(where).toMatchObject({
      status: 'OPEN',
      escalationStatus: null,
      service: { policy: { steps: { some: {} } } },
    });
  });

  it('recreates the job for a due execution that has none', async () => {
    vi.mocked(prisma.incident.findMany)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([
        {
          id: 'inc-2',
          currentEscalationStep: 2,
          escalationGeneration: 5,
          nextEscalationAt: new Date('2026-06-01T11:59:00.000Z'),
        },
      ] as never);

    const report = await reconcileEscalations({ now: NOW });

    expect(report.dueJobsRecreated).toBe(1);
    expect(mocks.recreateDueEscalationJob).toHaveBeenCalledWith({
      incidentId: 'inc-2',
      generation: 5,
      stepIndex: 2,
      scheduledAt: new Date('2026-06-01T11:59:00.000Z'),
    });
  });

  it('leaves a due execution alone when its job is already queued', async () => {
    vi.mocked(prisma.incident.findMany)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([
        {
          id: 'inc-2',
          currentEscalationStep: 0,
          escalationGeneration: 1,
          nextEscalationAt: NOW,
        },
      ] as never);
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ incidentId: 'inc-2' }] as never);

    const report = await reconcileEscalations({ now: NOW });

    expect(report.dueJobsRecreated).toBe(0);
    expect(mocks.recreateDueEscalationJob).not.toHaveBeenCalled();
  });

  it('counts cancelled stale-generation jobs', async () => {
    vi.mocked(prisma.$executeRaw).mockResolvedValue(3 as never);

    const report = await reconcileEscalations({ now: NOW });

    expect(report.staleJobsCancelled).toBe(3);
  });

  it('releases leases whose owner died, using the configured timeout', async () => {
    vi.mocked(prisma.incident.updateMany).mockResolvedValue({ count: 2 } as never);

    const report = await reconcileEscalations({ now: NOW });

    expect(report.leasesReleased).toBe(2);
    const args = vi.mocked(prisma.incident.updateMany).mock.calls[0][0] as never as {
      where: { escalationProcessingAt: { lt: Date } };
      data: Record<string, unknown>;
    };
    expect(args.where.escalationProcessingAt.lt.getTime()).toBeLessThan(NOW.getTime());
    expect(args.data).toEqual({ escalationProcessingAt: null });
  });

  it('never resurrects a FAILED execution', async () => {
    await reconcileEscalations({ now: NOW });

    // Both scans are restricted to states that still owe work.
    for (const call of vi.mocked(prisma.incident.findMany).mock.calls) {
      const where = (call[0] as never as { where: Record<string, unknown> }).where;
      expect(where.escalationStatus === null || where.escalationStatus === 'ESCALATING').toBe(true);
    }
    expect(vi.mocked(prisma.incident.updateMany).mock.calls[0][0]).toMatchObject({
      where: { escalationStatus: 'ESCALATING' },
    });
  });

  it('keeps repairing after one incident fails, and reports the failure', async () => {
    vi.mocked(prisma.incident.findMany)
      .mockResolvedValueOnce([
        { id: 'inc-bad', serviceId: 'svc-1' },
        { id: 'inc-good', serviceId: 'svc-1' },
      ] as never)
      .mockResolvedValueOnce([] as never);
    mocks.runSerializableTransaction
      .mockRejectedValueOnce(new Error('serialization failure'))
      .mockImplementationOnce(async callback => callback({}));

    const report = await reconcileEscalations({ now: NOW });

    expect(report.executionsInitialized).toBe(1);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]).toContain('inc-bad');
  });

  it('bounds how much it repairs in one pass', async () => {
    await reconcileEscalations({ now: NOW, limit: 5000 });

    for (const call of vi.mocked(prisma.incident.findMany).mock.calls) {
      expect((call[0] as never as { take: number }).take).toBe(1000);
    }
  });
});
