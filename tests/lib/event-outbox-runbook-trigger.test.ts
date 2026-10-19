import { describe, expect, it, vi } from 'vitest';
import {
  enqueueEventSideEffects,
  enqueueIncidentCreatedRunbookEvaluation,
} from '@/lib/event-outbox';

type BackgroundJobData = {
  type: string;
  status: string;
  maxAttempts: number;
  payload: Record<string, unknown>;
};

describe('enqueueEventSideEffects Runbook Trigger Regression', () => {
  function createMockTx() {
    const createdJobs: BackgroundJobData[] = [];
    const createdManyJobs: BackgroundJobData[] = [];

    const mockTx = {
      $queryRaw: vi.fn().mockResolvedValue([{ now: new Date() }]),
      incident: {
        findUnique: vi.fn().mockResolvedValue({ escalationGeneration: 1, status: 'OPEN' }),
      },
      backgroundJob: {
        create: vi.fn().mockImplementation(async ({ data }: { data: BackgroundJobData }) => {
          createdJobs.push(data);
          return { id: 'job-1', ...data };
        }),
        createMany: vi.fn().mockImplementation(async ({ data }: { data: BackgroundJobData[] }) => {
          createdManyJobs.push(...data);
          return { count: data.length };
        }),
      },
    } as unknown as Parameters<typeof enqueueEventSideEffects>[0];

    return { mockTx, createdJobs, createdManyJobs };
  }

  it('leaves runbook evaluation to enqueueIncidentCreatedRunbookEvaluation for triggered events', async () => {
    const { mockTx, createdJobs, createdManyJobs } = createMockTx();

    await enqueueEventSideEffects(mockTx, 'triggered', 'inc-test-123');

    expect(createdJobs.filter(j => j.type === 'RUNBOOK')).toHaveLength(0);
    expect(createdManyJobs.length).toBeGreaterThan(0);
    expect(createdManyJobs.every(j => j.type === 'SCHEDULED_TASK')).toBe(true);
  });

  it('queues exactly one EVALUATE_TRIGGER job for an open incident', async () => {
    const { mockTx, createdJobs } = createMockTx();

    await expect(
      enqueueIncidentCreatedRunbookEvaluation(mockTx, {
        incidentId: 'inc-test-123',
        status: 'OPEN',
        source: 'MONITORING',
      })
    ).resolves.toBe(true);

    const runbookJobs = createdJobs.filter(j => j.type === 'RUNBOOK');
    expect(runbookJobs).toHaveLength(1);
    expect(runbookJobs[0]).toMatchObject({
      status: 'PENDING',
      maxAttempts: 8,
      payload: expect.objectContaining({
        kind: 'EVALUATE_TRIGGER',
        incidentId: 'inc-test-123',
        source: 'MONITORING',
      }),
    });
  });

  it('does not enqueue a RUNBOOK background job when action is resolved or acknowledged', async () => {
    const { mockTx, createdJobs } = createMockTx();

    await enqueueEventSideEffects(mockTx, 'resolved', 'inc-test-123');
    await enqueueEventSideEffects(mockTx, 'acknowledged', 'inc-test-123');

    const runbookJobs = createdJobs.filter(j => j.type === 'RUNBOOK');
    expect(runbookJobs).toHaveLength(0);
  });
});
