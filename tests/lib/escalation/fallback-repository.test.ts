import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  runSerializableTransaction: vi.fn(),
  incidentFindUnique: vi.fn(),
  incidentUpdate: vi.fn(),
  incidentEventCreate: vi.fn(),
}));

vi.mock('@/lib/db-utils', () => ({
  runSerializableTransaction: mocks.runSerializableTransaction,
}));

import { settleEscalationFallbackOutcome } from '@/lib/escalation/fallback-repository';

const RETRY_AT = new Date('2026-09-01T12:00:30.000Z');

function installTransaction() {
  mocks.runSerializableTransaction.mockImplementation(async callback =>
    callback({
      incident: {
        findUnique: mocks.incidentFindUnique,
        update: mocks.incidentUpdate,
      },
      incidentEvent: { create: mocks.incidentEventCreate },
    })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  installTransaction();
  mocks.incidentFindUnique.mockResolvedValue({
    status: 'OPEN',
    escalationGeneration: 4,
    currentEscalationStep: 2,
  });
  mocks.incidentUpdate.mockResolvedValue({ id: 'inc-1' });
  mocks.incidentEventCreate.mockResolvedValue({ id: 'event-1' });
});

describe('escalation fallback persistence', () => {
  it('generation-fences fallback retry scheduling', async () => {
    await expect(
      settleEscalationFallbackOutcome({
        incidentId: 'inc-1',
        expectedGeneration: 4,
        expectedStep: 2,
        disposition: { kind: 'RETRY_SCHEDULED', retryAt: RETRY_AT },
      })
    ).resolves.toBe(true);

    expect(mocks.incidentUpdate).toHaveBeenCalledWith({
      where: { id: 'inc-1' },
      data: {
        escalationStatus: 'ESCALATING',
        nextEscalationAt: RETRY_AT,
        escalationProcessingAt: null,
      },
    });
  });

  it('releases a retryable failure without changing cursor or due state', async () => {
    await expect(
      settleEscalationFallbackOutcome({
        incidentId: 'inc-1',
        expectedGeneration: 4,
        expectedStep: 2,
        disposition: { kind: 'RETRYABLE_FAILURE' },
      })
    ).resolves.toBe(true);

    expect(mocks.incidentUpdate).toHaveBeenCalledWith({
      where: { id: 'inc-1' },
      data: { escalationProcessingAt: null },
    });
    expect(mocks.incidentEventCreate).not.toHaveBeenCalled();
  });

  it('parks fatal fallback failures and their timeline record atomically', async () => {
    await expect(
      settleEscalationFallbackOutcome({
        incidentId: 'inc-1',
        expectedGeneration: 4,
        expectedStep: 2,
        disposition: { kind: 'TERMINAL_FAILURE', message: 'bad\nstate' },
      })
    ).resolves.toBe(true);

    expect(mocks.incidentUpdate).toHaveBeenCalledWith({
      where: { id: 'inc-1' },
      data: {
        escalationStatus: 'FAILED',
        nextEscalationAt: null,
        escalationProcessingAt: null,
      },
    });
    expect(mocks.incidentEventCreate).toHaveBeenCalledWith({
      data: {
        incidentId: 'inc-1',
        message: 'Escalation processing failed (FATAL): bad state',
      },
    });
  });

  it('does not mutate a stale generation or cursor', async () => {
    mocks.incidentFindUnique.mockResolvedValue({
      status: 'OPEN',
      escalationGeneration: 5,
      currentEscalationStep: 2,
    });

    await expect(
      settleEscalationFallbackOutcome({
        incidentId: 'inc-1',
        expectedGeneration: 4,
        expectedStep: 2,
        disposition: { kind: 'RETRYABLE_FAILURE' },
      })
    ).resolves.toBe(false);

    expect(mocks.incidentUpdate).not.toHaveBeenCalled();
    expect(mocks.incidentEventCreate).not.toHaveBeenCalled();
  });
});
