import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => {
  const tx = {
    postmortem: { findUnique: vi.fn(), create: vi.fn() },
    incident: { findUnique: vi.fn() },
    incidentNote: { findMany: vi.fn() },
    incidentEvent: { create: vi.fn() },
    actionItem: { createMany: vi.fn() },
  };
  return { tx, logAudit: vi.fn().mockResolvedValue(undefined) };
});

vi.mock('@/lib/db-utils', () => ({
  runSerializableTransaction: (fn: (tx: typeof m.tx) => unknown) => fn(m.tx),
}));
vi.mock('@/lib/idempotency', () => ({
  executeIdempotentOperation: async (
    _tx: unknown,
    { execute }: { execute: () => Promise<unknown> }
  ) => ({ value: await execute() }),
}));
vi.mock('@/lib/env-validation', () => ({ getBaseUrl: () => 'https://ops.example.com' }));
vi.mock('@/lib/incidents/chatops-lifecycle', () => ({
  authorizeChatOpsIncidentInTransaction: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/incidents/event-filters', () => ({ loadPostmortemEvents: vi.fn() }));
vi.mock('@/lib/audit', () => ({ logAudit: m.logAudit }));

import { executeChatOpsPostmortemCommand } from '@/lib/incidents/chatops-postmortem';
import { loadPostmortemEvents } from '@/lib/incidents/event-filters';

const input = { incidentId: 'inc-1', actor: { id: 'user-1', name: 'Ada' }, channelName: 'inc-1' };

describe('executeChatOpsPostmortemCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.tx.postmortem.findUnique.mockResolvedValue(null);
    m.tx.incidentNote.findMany.mockResolvedValue([]);
    vi.mocked(loadPostmortemEvents).mockResolvedValue([]);
    m.tx.postmortem.create.mockResolvedValue({
      id: 'pm-1',
      incidentId: 'inc-1',
      title: 'Postmortem: DB down',
      status: 'DRAFT',
    });
  });

  it('refuses an incident that is not resolved, as the editor and API do', async () => {
    m.tx.incident.findUnique.mockResolvedValue({
      title: 'DB down',
      status: 'OPEN',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      resolvedAt: null,
      service: { name: 'Database' },
    });

    await expect(executeChatOpsPostmortemCommand(input)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    expect(m.tx.postmortem.create).not.toHaveBeenCalled();
  });

  it('creates the draft with the impact shape the editor reads, and audits it in the transaction', async () => {
    m.tx.incident.findUnique.mockResolvedValue({
      title: 'DB down',
      status: 'RESOLVED',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      resolvedAt: new Date('2026-01-01T01:30:00Z'),
      service: { name: 'Database' },
    });

    const result = await executeChatOpsPostmortemCommand(input);

    expect(result).toMatchObject({
      created: true,
      url: 'https://ops.example.com/postmortems/inc-1',
    });
    expect(m.tx.postmortem.create.mock.calls[0]![0].data.impact).toEqual({
      servicesAffected: ['Database'],
      downtimeMinutes: 90,
    });
    expect(m.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'postmortem.created',
        entityType: 'INCIDENT',
        entityId: 'inc-1',
        actorId: 'user-1',
      }),
      m.tx
    );
  });
});
