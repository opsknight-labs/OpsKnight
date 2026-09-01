import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  runSerializableTransaction: vi.fn(),
  txIncidentFindUnique: vi.fn(),
  txIncidentUpdate: vi.fn(),
  txIncidentUpdateMany: vi.fn(),
  txIncidentEventCreate: vi.fn(),
  txBackgroundJobFindFirst: vi.fn(),
  txBackgroundJobCreate: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    incident: { findUnique: vi.fn(), updateMany: vi.fn() },
    backgroundJob: { updateMany: vi.fn() },
  },
}));

vi.mock('@/lib/db-utils', () => ({
  runSerializableTransaction: mocks.runSerializableTransaction,
}));

import prisma from '@/lib/prisma';
import {
  claimEscalationStep,
  commitEscalationPlan,
  finalizeEscalationExecution,
  initializeEscalationExecution,
  scheduleDelayedEscalationStep,
} from '@/lib/escalation/repository';
import type { EscalationPlan } from '@/lib/escalation/planner';

const TOKEN = new Date('2026-05-01T10:00:00.000Z');

type ClaimWhere = {
  status: string;
  escalationGeneration?: number;
  AND: Array<Record<string, unknown>>;
};

/** The `where` clause of the claim CAS, as issued. */
function claimArgs(): { where: ClaimWhere } {
  return vi.mocked(prisma.incident.updateMany).mock.calls[0][0] as unknown as {
    where: ClaimWhere;
  };
}
const DUE_AT = new Date('2026-05-01T10:10:00.000Z');

function plan(overrides: Partial<EscalationPlan> = {}): EscalationPlan {
  return {
    outcome: 'STEP_EXECUTED',
    assignment: { type: 'USER', userId: 'alice' },
    notificationRecipients: ['alice'],
    timelineEvents: [{ type: 'ESCALATED', message: 'Escalated to Alice (Level 1)' }],
    nextState: { status: 'ESCALATING', currentStep: 1, nextEscalationAt: DUE_AT },
    nextJob: { stepIndex: 1, scheduledAt: DUE_AT },
    ...overrides,
  };
}

function incidentRow(overrides: Record<string, unknown> = {}) {
  return {
    status: 'OPEN',
    assigneeId: null,
    teamId: null,
    escalationStatus: 'ESCALATING',
    escalationProcessingAt: TOKEN,
    currentEscalationStep: 0,
    ...overrides,
  };
}

/** A transaction double that fails on the write named by `failOn`. */
function transactionDouble(failOn?: 'incident' | 'event' | 'job') {
  const writes: string[] = [];
  mocks.runSerializableTransaction.mockImplementation(async callback =>
    callback({
      incident: {
        findUnique: mocks.txIncidentFindUnique,
        updateMany: mocks.txIncidentUpdateMany,
        update: mocks.txIncidentUpdate.mockImplementation(async (args: unknown) => {
          if (failOn === 'incident') throw new Error('incident write failed');
          writes.push('incident');
          return args;
        }),
      },
      incidentEvent: {
        create: mocks.txIncidentEventCreate.mockImplementation(async () => {
          if (failOn === 'event') throw new Error('timeline write failed');
          writes.push('event');
          return {};
        }),
      },
      backgroundJob: {
        findFirst: mocks.txBackgroundJobFindFirst,
        create: mocks.txBackgroundJobCreate.mockImplementation(async () => {
          if (failOn === 'job') throw new Error('job insert failed');
          writes.push('job');
          return { id: 'job-next' };
        }),
      },
    })
  );
  return writes;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.txIncidentFindUnique.mockResolvedValue(incidentRow());
  mocks.txIncidentUpdateMany.mockResolvedValue({ count: 1 });
  mocks.txBackgroundJobFindFirst.mockResolvedValue(null);
});

describe('generation-fenced state transitions', () => {
  it('arms a delayed step and job only while the lifecycle generation is still current', async () => {
    transactionDouble();

    await expect(
      scheduleDelayedEscalationStep({
        incidentId: 'inc-1',
        generation: 4,
        stepIndex: 0,
        delayMinutes: 10,
        dueAt: DUE_AT,
      })
    ).resolves.toBe(true);

    expect(mocks.txIncidentUpdateMany).toHaveBeenCalledWith({
      where: {
        id: 'inc-1',
        status: 'OPEN',
        escalationGeneration: 4,
        escalationProcessingAt: null,
        nextEscalationAt: null,
        AND: [
          { OR: [{ currentEscalationStep: null }, { currentEscalationStep: 0 }] },
          { OR: [{ escalationStatus: null }, { escalationStatus: 'ESCALATING' }] },
        ],
      },
      data: {
        escalationStatus: 'ESCALATING',
        currentEscalationStep: 0,
        nextEscalationAt: DUE_AT,
        escalationProcessingAt: null,
      },
    });
    expect(mocks.txIncidentEventCreate).toHaveBeenCalledTimes(1);
    expect(mocks.txBackgroundJobCreate).toHaveBeenCalledTimes(1);
  });

  it('does not schedule delayed work after acknowledgment or generation rollover', async () => {
    transactionDouble();
    mocks.txIncidentUpdateMany.mockResolvedValue({ count: 0 });

    await expect(
      scheduleDelayedEscalationStep({
        incidentId: 'inc-1',
        generation: 4,
        stepIndex: 0,
        delayMinutes: 10,
        dueAt: DUE_AT,
      })
    ).resolves.toBe(false);

    expect(mocks.txIncidentEventCreate).not.toHaveBeenCalled();
    expect(mocks.txBackgroundJobCreate).not.toHaveBeenCalled();
  });

  it('finalizes only the generation and cursor the caller observed', async () => {
    transactionDouble();

    await expect(
      finalizeEscalationExecution({
        incidentId: 'inc-1',
        expectedGeneration: 4,
        expectedStep: 2,
        status: 'COMPLETED',
        timelineMessage: 'Policy exhausted',
      })
    ).resolves.toBe(true);

    expect(mocks.txIncidentUpdateMany).toHaveBeenCalledWith({
      where: {
        id: 'inc-1',
        status: 'OPEN',
        escalationGeneration: 4,
        currentEscalationStep: 2,
      },
      data: {
        escalationStatus: 'COMPLETED',
        nextEscalationAt: null,
        currentEscalationStep: null,
        escalationProcessingAt: null,
      },
    });
    expect(mocks.txIncidentEventCreate).toHaveBeenCalledTimes(1);
  });

  it('does not finalize or narrate a superseded lifecycle generation', async () => {
    transactionDouble();
    mocks.txIncidentUpdateMany.mockResolvedValue({ count: 0 });

    await expect(
      finalizeEscalationExecution({
        incidentId: 'inc-1',
        expectedGeneration: 4,
        expectedStep: 2,
        status: 'COMPLETED',
        timelineMessage: 'Policy exhausted',
      })
    ).resolves.toBe(false);

    expect(mocks.txIncidentEventCreate).not.toHaveBeenCalled();
  });
});

describe('commitEscalationPlan', () => {
  it('commits assignment, timeline, state, and the next job together', async () => {
    const writes = transactionDouble();

    const result = await commitEscalationPlan({
      incidentId: 'inc-1',
      generation: 4,
      expectedStep: 0,
      workerToken: TOKEN,
      plan: plan(),
    });

    expect(result).toEqual({
      committed: true,
      gate: 'ACTIVE',
      appliedStatus: 'ESCALATING',
      nextJobId: 'job-next',
      intentsCreated: 0,
    });
    // One transaction, and the follow-up job is inside it.
    expect(mocks.runSerializableTransaction).toHaveBeenCalledTimes(1);
    expect(writes).toEqual(['event', 'incident', 'job']);
    expect(mocks.txIncidentUpdate).toHaveBeenCalledWith({
      where: { id: 'inc-1' },
      data: {
        escalationStatus: 'ESCALATING',
        currentEscalationStep: 1,
        nextEscalationAt: DUE_AT,
        escalationProcessingAt: null,
        assignee: { connect: { id: 'alice' } },
        team: { disconnect: true },
      },
    });
    expect(mocks.txBackgroundJobCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'ESCALATION',
          scheduledAt: DUE_AT,
          payload: {
            incidentId: 'inc-1',
            stepIndex: 1,
            generation: 4,
            logicalKey: 'ESCALATION:inc-1:4:1',
          },
        }),
      })
    );
  });

  it.each(['incident', 'event', 'job'] as const)(
    'rolls the whole step back when the %s write fails',
    async failOn => {
      transactionDouble(failOn);

      await expect(
        commitEscalationPlan({
          incidentId: 'inc-1',
          generation: 4,
          expectedStep: 0,
          workerToken: TOKEN,
          plan: plan(),
        })
      ).rejects.toThrow(/failed/);
    }
  );

  it('refuses to write anything once a newer generation invalidated the worker', async () => {
    const writes = transactionDouble();
    // A lifecycle transition cleared the lease this worker was holding.
    mocks.txIncidentFindUnique.mockResolvedValue(incidentRow({ escalationProcessingAt: null }));

    const result = await commitEscalationPlan({
      incidentId: 'inc-1',
      generation: 4,
      expectedStep: 0,
      workerToken: TOKEN,
      plan: plan(),
    });

    expect(result).toEqual({ committed: false });
    expect(writes).toEqual([]);
  });

  it('refuses to write when another worker reclaimed the lease', async () => {
    const writes = transactionDouble();
    mocks.txIncidentFindUnique.mockResolvedValue(
      incidentRow({ escalationProcessingAt: new Date('2026-05-01T10:05:00.000Z') })
    );

    const result = await commitEscalationPlan({
      incidentId: 'inc-1',
      generation: 4,
      expectedStep: 0,
      workerToken: TOKEN,
      plan: plan(),
    });

    expect(result).toEqual({ committed: false });
    expect(writes).toEqual([]);
  });

  it('refuses to write when the step cursor moved to another execution', async () => {
    const writes = transactionDouble();
    mocks.txIncidentFindUnique.mockResolvedValue(incidentRow({ currentEscalationStep: 2 }));

    const result = await commitEscalationPlan({
      incidentId: 'inc-1',
      generation: 4,
      expectedStep: 0,
      workerToken: TOKEN,
      plan: plan(),
    });

    expect(result).toEqual({ committed: false });
    expect(writes).toEqual([]);
  });

  it('still commits when a terminal transition already cleared the cursor', async () => {
    transactionDouble();
    mocks.txIncidentFindUnique.mockResolvedValue(
      incidentRow({ status: 'ACKNOWLEDGED', currentEscalationStep: null })
    );

    const result = await commitEscalationPlan({
      incidentId: 'inc-1',
      generation: 4,
      expectedStep: 0,
      workerToken: TOKEN,
      plan: plan(),
    });

    expect(result).toMatchObject({ committed: true, gate: 'STOPPED' });
  });

  it('refuses to write when the incident is gone', async () => {
    const writes = transactionDouble();
    mocks.txIncidentFindUnique.mockResolvedValue(null);

    const result = await commitEscalationPlan({
      incidentId: 'inc-1',
      generation: 4,
      expectedStep: 0,
      workerToken: TOKEN,
      plan: plan(),
    });

    expect(result).toEqual({ committed: false });
    expect(writes).toEqual([]);
  });

  it.each(['ACKNOWLEDGED', 'RESOLVED'] as const)(
    'stops escalation and schedules nothing when the incident became %s mid-step',
    async status => {
      const writes = transactionDouble();
      mocks.txIncidentFindUnique.mockResolvedValue(incidentRow({ status }));

      const result = await commitEscalationPlan({
        incidentId: 'inc-1',
        generation: 4,
        expectedStep: 0,
        workerToken: TOKEN,
        plan: plan(),
      });

      expect(result).toMatchObject({
        committed: true,
        gate: 'STOPPED',
        appliedStatus: 'COMPLETED',
      });
      expect(writes).not.toContain('job');
      expect(mocks.txIncidentUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            escalationStatus: 'COMPLETED',
            currentEscalationStep: null,
            nextEscalationAt: null,
          }),
        })
      );
    }
  );

  it.each(['SNOOZED', 'SUPPRESSED'] as const)(
    'pauses escalation but keeps the resume step when the incident became %s mid-step',
    async status => {
      const writes = transactionDouble();
      mocks.txIncidentFindUnique.mockResolvedValue(incidentRow({ status }));

      const result = await commitEscalationPlan({
        incidentId: 'inc-1',
        generation: 4,
        expectedStep: 0,
        workerToken: TOKEN,
        plan: plan(),
      });

      expect(result).toMatchObject({ committed: true, gate: 'PAUSED', appliedStatus: 'PAUSED' });
      expect(writes).not.toContain('job');
      // The already-paged step must not be replayed on resume, so the cursor
      // keeps pointing at the step after it.
      expect(mocks.txIncidentUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            escalationStatus: 'PAUSED',
            currentEscalationStep: 1,
            nextEscalationAt: null,
          }),
        })
      );
    }
  );

  it('never overwrites an owner the incident already has', async () => {
    transactionDouble();
    mocks.txIncidentFindUnique.mockResolvedValue(incidentRow({ assigneeId: 'manual-owner' }));

    await commitEscalationPlan({
      incidentId: 'inc-1',
      generation: 4,
      expectedStep: 0,
      workerToken: TOKEN,
      plan: plan(),
    });

    const data = mocks.txIncidentUpdate.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('assignee');
    expect(data).not.toHaveProperty('team');
  });

  it('creates no job for a terminal plan', async () => {
    const writes = transactionDouble();

    const result = await commitEscalationPlan({
      incidentId: 'inc-1',
      generation: 4,
      expectedStep: 0,
      workerToken: TOKEN,
      plan: plan({
        outcome: 'NO_ELIGIBLE_RESPONDERS',
        assignment: null,
        notificationRecipients: [],
        nextState: { status: 'FAILED', currentStep: null, nextEscalationAt: null },
        nextJob: null,
      }),
    });

    expect(result).toMatchObject({
      committed: true,
      appliedStatus: 'FAILED',
      nextJobId: null,
      intentsCreated: 0,
    });
    expect(writes).not.toContain('job');
  });
});

describe('initializeEscalationExecution', () => {
  function txWithPolicy(firstStepDelayMinutes: number | null) {
    return {
      service: {
        findUnique: vi
          .fn()
          .mockResolvedValue(
            firstStepDelayMinutes === null
              ? { policy: null }
              : { policy: { steps: [{ delayMinutes: firstStepDelayMinutes }] } }
          ),
      },
      incident: {
        updateMany: mocks.txIncidentUpdateMany.mockResolvedValue({ count: 1 }),
        findUnique: mocks.txIncidentFindUnique.mockResolvedValue({ escalationGeneration: 2 }),
      },
      backgroundJob: {
        findFirst: mocks.txBackgroundJobFindFirst.mockResolvedValue(null),
        create: mocks.txBackgroundJobCreate.mockResolvedValue({ id: 'job-first' }),
      },
    };
  }

  it('arms step 0 and its due job inside the caller transaction', async () => {
    const tx = txWithPolicy(5);

    const result = await initializeEscalationExecution(tx as never, {
      incidentId: 'inc-1',
      serviceId: 'svc-1',
      now: TOKEN,
    });

    expect(result).toEqual({ initialized: true, dueAt: new Date('2026-05-01T10:05:00.000Z') });
    expect(mocks.txIncidentUpdateMany).toHaveBeenCalledWith({
      where: {
        id: 'inc-1',
        serviceId: 'svc-1',
        status: 'OPEN',
        escalationStatus: null,
      },
      data: {
        escalationStatus: 'ESCALATING',
        currentEscalationStep: 0,
        nextEscalationAt: new Date('2026-05-01T10:05:00.000Z'),
        escalationProcessingAt: null,
      },
    });
    expect(mocks.txBackgroundJobCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'ESCALATION',
          scheduledAt: new Date('2026-05-01T10:05:00.000Z'),
          payload: {
            incidentId: 'inc-1',
            stepIndex: 0,
            generation: 2,
            logicalKey: 'ESCALATION:inc-1:2:0',
          },
        }),
      })
    );
  });

  it('makes a zero-delay first step due immediately', async () => {
    const tx = txWithPolicy(0);

    const result = await initializeEscalationExecution(tx as never, {
      incidentId: 'inc-1',
      serviceId: 'svc-1',
      now: TOKEN,
    });

    expect(result).toEqual({ initialized: true, dueAt: TOKEN });
  });

  it('does not re-arm a stale recovery candidate after its lifecycle changed', async () => {
    const tx = txWithPolicy(5);
    mocks.txIncidentUpdateMany.mockResolvedValue({ count: 0 });

    const result = await initializeEscalationExecution(tx as never, {
      incidentId: 'inc-1',
      serviceId: 'svc-1',
      now: TOKEN,
    });

    expect(result).toEqual({ initialized: false, dueAt: null });
    expect(mocks.txIncidentFindUnique).not.toHaveBeenCalled();
    expect(mocks.txBackgroundJobCreate).not.toHaveBeenCalled();
  });

  it('reuses an active job with the same logical escalation identity', async () => {
    const tx = txWithPolicy(5);
    mocks.txBackgroundJobFindFirst.mockResolvedValue({ id: 'job-existing' });

    const result = await initializeEscalationExecution(tx as never, {
      incidentId: 'inc-1',
      serviceId: 'svc-1',
      now: TOKEN,
    });

    expect(result.initialized).toBe(true);
    expect(mocks.txBackgroundJobFindFirst).toHaveBeenCalledWith({
      where: {
        type: 'ESCALATION',
        status: { in: ['PENDING', 'PROCESSING'] },
        payload: { path: ['logicalKey'], equals: 'ESCALATION:inc-1:2:0' },
      },
      select: { id: true },
    });
    expect(mocks.txBackgroundJobCreate).not.toHaveBeenCalled();
  });

  it('writes nothing when the service has no policy', async () => {
    const tx = txWithPolicy(null);

    const result = await initializeEscalationExecution(tx as never, {
      incidentId: 'inc-1',
      serviceId: 'svc-1',
      now: TOKEN,
    });

    expect(result).toEqual({ initialized: false, dueAt: null });
    expect(mocks.txIncidentUpdate).not.toHaveBeenCalled();
    expect(mocks.txBackgroundJobCreate).not.toHaveBeenCalled();
  });
});

describe('claimEscalationStep', () => {
  it('returns the claim token when the CAS wins', async () => {
    vi.mocked(prisma.incident.updateMany).mockResolvedValue({ count: 1 } as never);

    await expect(
      claimEscalationStep({
        incidentId: 'inc-1',
        stepIndex: 2,
        now: TOKEN,
        lockTimeoutMs: 60_000,
      })
    ).resolves.toEqual({ claimed: true, token: TOKEN });
  });

  it('reports a live competing worker as held, not superseded', async () => {
    vi.mocked(prisma.incident.updateMany).mockResolvedValue({ count: 0 } as never);
    vi.mocked(prisma.incident.findUnique).mockResolvedValue({
      status: 'OPEN',
      escalationStatus: 'ESCALATING',
      escalationGeneration: 4,
    } as never);

    await expect(
      claimEscalationStep({
        incidentId: 'inc-1',
        stepIndex: 2,
        expectedGeneration: 4,
        now: TOKEN,
        lockTimeoutMs: 60_000,
      })
    ).resolves.toEqual({ claimed: false, reason: 'HELD' });
  });

  it('reports a moved-on generation as superseded', async () => {
    vi.mocked(prisma.incident.updateMany).mockResolvedValue({ count: 0 } as never);
    vi.mocked(prisma.incident.findUnique).mockResolvedValue({
      status: 'OPEN',
      escalationStatus: 'ESCALATING',
      escalationGeneration: 5,
    } as never);

    await expect(
      claimEscalationStep({
        incidentId: 'inc-1',
        stepIndex: 2,
        expectedGeneration: 4,
        now: TOKEN,
        lockTimeoutMs: 60_000,
      })
    ).resolves.toEqual({ claimed: false, reason: 'SUPERSEDED' });
  });

  it.each(['ACKNOWLEDGED', 'RESOLVED', 'SNOOZED'] as const)(
    'reports a %s incident as superseded',
    async status => {
      vi.mocked(prisma.incident.updateMany).mockResolvedValue({ count: 0 } as never);
      vi.mocked(prisma.incident.findUnique).mockResolvedValue({
        status,
        escalationStatus: 'PAUSED',
        escalationGeneration: 4,
      } as never);

      await expect(
        claimEscalationStep({
          incidentId: 'inc-1',
          stepIndex: 2,
          expectedGeneration: 4,
          now: TOKEN,
          lockTimeoutMs: 60_000,
        })
      ).resolves.toEqual({ claimed: false, reason: 'SUPERSEDED' });
    }
  );

  it('fences the claim on the lifecycle generation', async () => {
    vi.mocked(prisma.incident.updateMany).mockResolvedValue({ count: 1 } as never);

    await claimEscalationStep({
      incidentId: 'inc-1',
      stepIndex: 2,
      expectedGeneration: 7,
      now: TOKEN,
      lockTimeoutMs: 60_000,
    });

    expect(claimArgs().where.escalationGeneration).toBe(7);
  });

  it('omits the generation fence for an unverifiable legacy job', async () => {
    vi.mocked(prisma.incident.updateMany).mockResolvedValue({ count: 1 } as never);

    await claimEscalationStep({
      incidentId: 'inc-1',
      stepIndex: 2,
      now: TOKEN,
      lockTimeoutMs: 60_000,
    });

    expect(claimArgs().where).not.toHaveProperty('escalationGeneration');
  });

  it('only claims an OPEN incident whose cursor matches, and respects the lease timeout', async () => {
    vi.mocked(prisma.incident.updateMany).mockResolvedValue({ count: 1 } as never);

    await claimEscalationStep({
      incidentId: 'inc-1',
      stepIndex: 2,
      now: TOKEN,
      lockTimeoutMs: 60_000,
    });

    const args = claimArgs();
    expect(args.where.status).toBe('OPEN');
    expect(args.where.AND[0]).toEqual({ currentEscalationStep: 2 });
    expect(args.where.AND[1]).toEqual({ escalationStatus: 'ESCALATING' });
    expect(args.where.AND[2]).toEqual({
      OR: [
        { escalationProcessingAt: null },
        { escalationProcessingAt: { lt: new Date('2026-05-01T09:59:00.000Z') } },
      ],
    });
  });

  it('accepts an uninitialised cursor for step 0', async () => {
    vi.mocked(prisma.incident.updateMany).mockResolvedValue({ count: 1 } as never);

    await claimEscalationStep({
      incidentId: 'inc-1',
      stepIndex: 0,
      now: TOKEN,
      lockTimeoutMs: 60_000,
    });

    const args = claimArgs();
    expect(args.where.AND[0]).toEqual({
      OR: [{ currentEscalationStep: null }, { currentEscalationStep: 0 }],
    });
    expect(args.where.AND[1]).toEqual({
      OR: [{ escalationStatus: null }, { escalationStatus: 'ESCALATING' }],
    });
  });
});
