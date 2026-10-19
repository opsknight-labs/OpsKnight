import { describe, expect, it, vi } from 'vitest';
import { enqueueEventSideEffects } from '@/lib/event-outbox';

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

  it('enqueues a RUNBOOK EVALUATE_TRIGGER background job when an incoming event action is triggered', async () => {
    const { mockTx, createdJobs, createdManyJobs } = createMockTx();

    await enqueueEventSideEffects(mockTx, 'triggered', 'inc-test-123');

    // Verify RUNBOOK job is enqueued with kind: 'EVALUATE_TRIGGER'
    const runbookJob = createdJobs.find(j => j.type === 'RUNBOOK');
    expect(runbookJob).toBeDefined();
    expect(runbookJob).toMatchObject({
      type: 'RUNBOOK',
      status: 'PENDING',
      maxAttempts: 8,
      payload: expect.objectContaining({
        kind: 'EVALUATE_TRIGGER',
        incidentId: 'inc-test-123',
        sourceEventId: expect.any(String),
      }),
    });

    // Verify standard event side effects were also queued as SCHEDULED_TASK
    expect(mockTx.backgroundJob.createMany).toHaveBeenCalled();
    expect(createdManyJobs.length).toBeGreaterThan(0);
    expect(createdManyJobs.every(j => j.type === 'SCHEDULED_TASK')).toBe(true);
  });

  it('does not enqueue a RUNBOOK background job when action is resolved or acknowledged', async () => {
    const { mockTx, createdJobs } = createMockTx();

    await enqueueEventSideEffects(mockTx, 'resolved', 'inc-test-123');
    await enqueueEventSideEffects(mockTx, 'acknowledged', 'inc-test-123');

    const runbookJobs = createdJobs.filter(j => j.type === 'RUNBOOK');
    expect(runbookJobs).toHaveLength(0);
  });
});
