import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  updateMany: vi.fn(),
  executeMeetingProvision: vi.fn(),
  settleMeetingProvisionFailure: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
    backgroundJob: { findUnique: mocks.findUnique, updateMany: mocks.updateMany, update: vi.fn() },
  },
}));
vi.mock('@/lib/incident-collaboration/meeting-store', () => ({
  executeMeetingProvision: mocks.executeMeetingProvision,
  settleMeetingProvisionFailure: mocks.settleMeetingProvisionFailure,
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { processJob } from '@/lib/jobs/queue';

const job = (attempts: number) => ({
  id: 'job-1',
  claimToken: '00000000-0000-4000-8000-000000000001',
  type: 'MEETING_PROVISION' as const,
  status: 'PROCESSING' as const,
  attempts,
  maxAttempts: 5,
  payload: {
    incidentId: 'inc-1',
    provisioningToken: 'tok-1',
    provider: 'MICROSOFT_TEAMS',
    generation: 2,
  },
});

describe('MEETING_PROVISION terminal settlement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateMany.mockResolvedValue({ count: 1 });
    // A failure outside executeMeetingProvision's own try block (e.g. a DB error) just throws.
    mocks.executeMeetingProvision.mockRejectedValue(new Error('database unavailable'));
  });

  it('fails the meeting once the job has no attempts left', async () => {
    mocks.findUnique.mockResolvedValue({
      attempts: 5,
      maxAttempts: 5,
      claimToken: '00000000-0000-4000-8000-000000000001',
    });

    await processJob(job(5));

    expect(mocks.settleMeetingProvisionFailure).toHaveBeenCalledWith(
      'inc-1',
      'database unavailable',
      { provisioningToken: 'tok-1', generation: 2, provider: 'MICROSOFT_TEAMS' }
    );
  });

  it('leaves the meeting PROVISIONING while the job will still retry', async () => {
    mocks.findUnique.mockResolvedValue({
      attempts: 2,
      maxAttempts: 5,
      claimToken: '00000000-0000-4000-8000-000000000001',
    });

    await processJob(job(2));

    expect(mocks.settleMeetingProvisionFailure).not.toHaveBeenCalled();
  });
});
