import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const tx = vi.hoisted(() => ({
  runbookAgent: { findFirst: vi.fn() },
  runbookStepAttempt: { findUnique: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
  runbookExecutionStep: { updateMany: vi.fn(), update: vi.fn() },
  runbookArtifact: { findFirst: vi.fn() },
  backgroundJob: { create: vi.fn() },
}));

vi.mock('@/lib/prisma', () => ({
  default: { $transaction: (fn: (client: typeof tx) => unknown) => fn(tx) },
}));
vi.mock('@/lib/audit', () => ({ emitAuditEvent: vi.fn(), logAudit: vi.fn() }));

import { submitAgentResult } from '@/lib/runbooks/agent-claims';
import { sha256 } from '@/lib/runbooks/agent-auth';
import {
  RunbookAgentLeaseExpiredError,
  RunbookPreExecutionFenceError,
} from '@/lib/runbooks/errors';

const NOW = new Date('2026-11-27T12:00:00.000Z');
const ATTEMPT_ID = 'ckattempt0000000000000001';
const TOKEN = 'lease-token';

function runningAttempt(leaseExpiresAt: Date) {
  return {
    id: ATTEMPT_ID,
    status: 'RUNNING',
    claimedAgentId: 'agent-1',
    leaseToken: sha256(TOKEN),
    leaseExpiresAt,
    attemptNumber: 1,
    executionStepId: 'step-1',
    targetAgentPool: null,
    executionStep: {
      id: 'step-1',
      executionId: 'exec-1',
      name: 'Restart',
      riskClass: 'READ_ONLY',
      status: 'RUNNING',
      maxRetries: 0,
      execution: {
        status: 'RUNNING',
        cancelRequestedAt: null,
        deadlineAt: new Date(NOW.getTime() + 3_600_000),
      },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  tx.runbookAgent.findFirst.mockResolvedValue({ id: 'agent-1' });
  tx.runbookStepAttempt.updateMany.mockResolvedValue({ count: 1 });
  tx.runbookExecutionStep.updateMany.mockResolvedValue({ count: 1 });
});

describe('submitAgentResult while the lease has just lapsed', () => {
  it('accepts a result the Agent produced before the lease expired but posted after it', async () => {
    const expiredAt = new Date(NOW.getTime() - 10_000);
    tx.runbookStepAttempt.findUnique.mockResolvedValue(runningAttempt(expiredAt));

    await expect(
      submitAgentResult('agent-1', {
        attemptId: ATTEMPT_ID,
        leaseToken: TOKEN,
        status: 'SUCCEEDED',
        producedAt: new Date(expiredAt.getTime() - 5_000).toISOString(),
      })
    ).resolves.toMatchObject({ accepted: true, status: 'SUCCEEDED' });
    expect(tx.runbookStepAttempt.updateMany).toHaveBeenCalledTimes(1);
  });

  it('still refuses a result produced well after the lease expired', async () => {
    const expiredAt = new Date(NOW.getTime() - 300_000);
    tx.runbookStepAttempt.findUnique.mockResolvedValue(runningAttempt(expiredAt));

    await expect(
      submitAgentResult('agent-1', {
        attemptId: ATTEMPT_ID,
        leaseToken: TOKEN,
        status: 'SUCCEEDED',
        producedAt: new Date(NOW.getTime() - 60_000).toISOString(),
      })
    ).rejects.toBeInstanceOf(RunbookAgentLeaseExpiredError);
    expect(tx.runbookStepAttempt.updateMany).not.toHaveBeenCalled();
  });
});

describe('submitAgentResult race with the reconciler', () => {
  it('reports a lost race as an attempt-state fence error', async () => {
    tx.runbookStepAttempt.findUnique.mockResolvedValue(
      runningAttempt(new Date(NOW.getTime() - 10_000))
    );
    tx.runbookStepAttempt.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      submitAgentResult('agent-1', {
        attemptId: ATTEMPT_ID,
        leaseToken: TOKEN,
        status: 'SUCCEEDED',
        producedAt: new Date(NOW.getTime() - 20_000).toISOString(),
      })
    ).rejects.toBeInstanceOf(RunbookPreExecutionFenceError);
  });
});
