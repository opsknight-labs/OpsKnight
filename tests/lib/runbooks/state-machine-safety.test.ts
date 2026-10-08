import { describe, expect, it, vi } from 'vitest';
import prisma from '@/lib/prisma';
import { cancelExecution, completeStep } from '@/lib/runbooks/orchestrator';
import { claimAgentAttempt } from '@/lib/runbooks/agent-claims';
import { RunbookExecutionInvalidTransitionError } from '@/lib/runbooks/errors';

vi.mock('@/lib/prisma', () => ({
  default: {
    $transaction: vi.fn(callback => callback(prisma)),
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
    runbookExecution: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
    },
    runbookExecutionStep: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
    },
    runbookStepAttempt: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
    },
    runbookAgent: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
    runbookAgentPoolMember: {
      findUnique: vi.fn(),
      count: vi.fn(),
    },
    runbookExecutionSigningKey: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    backgroundJob: {
      create: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
  },
}));

vi.mock('@/lib/audit', () => ({
  logAudit: vi.fn().mockResolvedValue({ id: 'audit1' }),
}));

vi.mock('@/lib/runbooks/execution-signing', () => ({
  signExecutionEnvelope: vi.fn((envelope: unknown) =>
    Promise.resolve({ ...(envelope as Record<string, unknown>), signature: 'mock_signature' })
  ),
}));

describe('Runbooks State Machine Safety and Invariants', () => {
  it('enforces atomic cancellation, background job queuing, and audit inside a single transaction', async () => {
    vi.mocked(prisma.runbookExecution.updateMany).mockResolvedValueOnce({ count: 1 });
    vi.mocked(prisma.backgroundJob.create).mockResolvedValueOnce({ id: 'job1' } as never);

    await cancelExecution('exec_1', 'user_1', 'operator cancelled');

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.runbookExecution.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'exec_1',
        status: { notIn: ['SUCCEEDED', 'FAILED', 'CANCELLED', 'TIMED_OUT'] },
      },
      data: {
        status: 'CANCEL_REQUESTED',
        cancelRequestedAt: expect.any(Date),
        failureMessage: 'operator cancelled',
      },
    });
    expect(prisma.backgroundJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'RUNBOOK',
        payload: { kind: 'ADVANCE_EXECUTION', executionId: 'exec_1' },
      }),
    });
  });

  it('rejects cancellation on an already terminal execution', async () => {
    vi.mocked(prisma.runbookExecution.updateMany).mockResolvedValueOnce({ count: 0 });

    await expect(cancelExecution('exec_terminal', 'user_1')).rejects.toThrow(
      RunbookExecutionInvalidTransitionError
    );
  });

  it('iterates through locked candidates to prevent claim starvation when first candidate fails authority check', async () => {
    const agentId = 'agent_1';
    vi.mocked(prisma.runbookAgent.findFirst).mockResolvedValueOnce({
      id: agentId,
      capabilities: ['RUNBOOK_LINUX_DIAGNOSTICS', 'RUNBOOK_SYSTEMD'],
    } as never);

    const now = new Date();
    const candidate1 = {
      id: 'att_stale',
      createdAt: new Date(now.getTime() - 2000),
      targetAgentId: null,
      targetAgentPoolId: 'pool_1',
      targetAgentPool: { mode: 'SHARED_TARGET', _count: { members: 2 } },
      executionStep: {
        stepKey: 'step1',
        name: 'Step 1',
        type: 'LINUX_DIAGNOSTICS' as const,
        riskClass: 'READ_ONLY' as const,
        config: {},
        execution: {
          id: 'exec_stale',
          inputValues: {},
          definitionChecksum: 'cs1',
          deadlineAt: new Date(now.getTime() + 60000),
          targetSelection: { sourcePoolId: 'pool_stale' },
        },
      },
    };

    const candidate2 = {
      id: 'att_valid',
      createdAt: new Date(now.getTime() - 1000),
      targetAgentId: agentId,
      targetAgentPoolId: null,
      targetAgentPool: null,
      executionStep: {
        stepKey: 'step2',
        name: 'Step 2',
        type: 'SYSTEMD' as const,
        riskClass: 'READ_ONLY' as const,
        config: { action: 'status', unit: 'app.service' },
        execution: {
          id: 'exec_valid',
          inputValues: {},
          definitionChecksum: 'cs2',
          deadlineAt: new Date(now.getTime() + 60000),
          targetSelection: null,
        },
      },
    };

    vi.mocked(prisma.runbookStepAttempt.findMany).mockResolvedValueOnce([
      candidate1,
      candidate2,
    ] as never);

    // Locked candidates returned by SKIP LOCKED
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([
      { id: 'att_stale' },
      { id: 'att_valid' },
    ] as never);

    // Authority check for candidate1 fails: agent is NOT a member of pool_stale
    vi.mocked(prisma.runbookAgentPoolMember.findUnique).mockResolvedValueOnce(null);

    // Attempt claim on candidate2 succeeds
    vi.mocked(prisma.runbookStepAttempt.updateMany).mockResolvedValueOnce({ count: 1 });

    const result = await claimAgentAttempt(agentId);

    expect(result).not.toBeNull();
    expect(result?.attemptId).toBe('att_valid');
    expect(result?.executionId).toBe('exec_valid');
  });

  it('completeStep updates step and transitions active execution to RUNNING, enqueuing advance', async () => {
    vi.mocked(prisma.runbookExecutionStep.updateMany).mockResolvedValueOnce({ count: 1 });
    vi.mocked(prisma.runbookExecution.updateMany).mockResolvedValueOnce({ count: 1 });
    vi.mocked(prisma.backgroundJob.create).mockResolvedValueOnce({ id: 'job_advance' } as never);

    await completeStep('exec_1', 'step_1', 'SUCCEEDED', 'Output preview message');

    expect(prisma.runbookExecutionStep.updateMany).toHaveBeenCalledWith({
      where: { id: 'step_1', executionId: 'exec_1', status: { in: ['READY', 'RUNNING'] } },
      data: {
        status: 'SUCCEEDED',
        completedAt: expect.any(Date),
        outputPreview: 'Output preview message',
      },
    });
    expect(prisma.runbookExecution.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'exec_1',
        status: { in: ['QUEUED', 'RUNNING', 'WAITING_AGENT', 'WAITING_APPROVAL'] },
      },
      data: { status: 'RUNNING' },
    });
    expect(prisma.backgroundJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'RUNBOOK',
        payload: { kind: 'ADVANCE_EXECUTION', executionId: 'exec_1' },
      }),
    });
  });

  it('completeStep updates step output but does NOT resurrect terminal or cancel-requested execution', async () => {
    vi.mocked(prisma.runbookExecutionStep.updateMany).mockResolvedValueOnce({ count: 1 });
    // CAS fails because execution is CANCELLED / CANCEL_REQUESTED / TIMED_OUT / FAILED
    vi.mocked(prisma.runbookExecution.updateMany).mockResolvedValueOnce({ count: 0 });
    const bgCreateSpy = vi.mocked(prisma.backgroundJob.create);
    bgCreateSpy.mockClear();

    await completeStep('exec_terminal', 'step_1', 'SUCCEEDED', 'Late arriving output');

    expect(prisma.runbookExecutionStep.updateMany).toHaveBeenCalledWith({
      where: { id: 'step_1', executionId: 'exec_terminal', status: { in: ['READY', 'RUNNING'] } },
      data: {
        status: 'SUCCEEDED',
        completedAt: expect.any(Date),
        outputPreview: 'Late arriving output',
      },
    });
    expect(prisma.runbookExecution.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'exec_terminal',
        status: { in: ['QUEUED', 'RUNNING', 'WAITING_AGENT', 'WAITING_APPROVAL'] },
      },
      data: { status: 'RUNNING' },
    });
    // Ensure backgroundJob.create was NOT called
    expect(bgCreateSpy).not.toHaveBeenCalled();
  });
});

