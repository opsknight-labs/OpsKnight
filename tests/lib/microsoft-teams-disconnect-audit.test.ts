import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const counts = { cardLedger: 7, destinations: 3, installations: 2, config: 1 };
  const tx = {
    microsoftTeamsDestination: {
      findMany: vi.fn(async () => [
        { id: 'd1', serviceId: 's1' },
        { id: 'd2', serviceId: 's2' },
        { id: 'd3', serviceId: 's3' },
      ]),
      deleteMany: vi.fn(async () => ({ count: counts.destinations })),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    microsoftTeamsIncidentMessage: { deleteMany: vi.fn(async () => ({ count: counts.cardLedger })) },
    microsoftTeamsInstallation: {
      deleteMany: vi.fn(async () => ({ count: counts.installations })),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    microsoftTeamsConfig: {
      deleteMany: vi.fn(async () => ({ count: counts.config })),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    service: { findMany: vi.fn(async () => []), update: vi.fn() },
  };
  return {
    counts,
    tx,
    emitAuditEvent: vi.fn(async () => undefined),
  };
});

vi.mock('@/lib/prisma', () => ({
  default: { $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(mocks.tx) },
}));
vi.mock('@/lib/audit', () => ({ emitAuditEvent: mocks.emitAuditEvent }));
vi.mock('@/lib/microsoft-teams/client', () => ({ clearMicrosoftTeamsTokenCaches: vi.fn() }));

import * as lifecycle from '@/lib/microsoft-teams/lifecycle';

describe('Microsoft Teams disconnect audit', () => {
  beforeEach(() => {
    mocks.emitAuditEvent.mockClear();
  });

  it('writes one audit row, in the same transaction, naming what a destructive disconnect removed', async () => {
    // The revocation helpers read through the transaction; give them empty result sets.
    const tx = mocks.tx as unknown as Record<string, Record<string, unknown>>;
    tx.externalOperation = { findMany: vi.fn(async () => []), updateMany: vi.fn() };
    tx.incidentWarRoom = { findMany: vi.fn(async () => []), updateMany: vi.fn() };
    tx.backgroundJob = { findMany: vi.fn(async () => []), updateMany: vi.fn() };

    await lifecycle.disconnectMicrosoftTeamsIntegration('admin-1');

    expect(mocks.emitAuditEvent).toHaveBeenCalledTimes(1);
    const [event, auditTx] = mocks.emitAuditEvent.mock.calls[0] as unknown as [
      { action: string; actor: { id: string }; metadata: Record<string, unknown> },
      unknown,
    ];
    expect(auditTx).toBe(mocks.tx);
    expect(event.action).toBe('microsoftTeams.integration.disconnected');
    expect(event.actor.id).toBe('admin-1');
    expect(event.metadata).toMatchObject({
      deleted: true,
      destinationsRemoved: 3,
      installationsRemoved: 2,
      cardLedgerRowsRemoved: 7,
      configRowsRemoved: 1,
    });
  });
});
