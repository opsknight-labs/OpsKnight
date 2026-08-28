import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  runSerializableTransaction: vi.fn(),
  applyIncidentLifecycleCommand: vi.fn(),
  sendIncidentNotifications: vi.fn(),
  notifyStatusPageSubscribers: vi.fn(),
  triggerWebhooksForService: vi.fn(),
  loggerError: vi.fn(),
}));

const prismaMock = vi.hoisted(() => ({
  incident: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
  },
}));

vi.mock('@/lib/db-utils', () => ({
  runSerializableTransaction: mocks.runSerializableTransaction,
}));

vi.mock('@/lib/incidents/lifecycle', () => ({
  applyIncidentLifecycleCommand: mocks.applyIncidentLifecycleCommand,
}));

vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: prismaMock,
}));

vi.mock('@/lib/user-notifications', () => ({
  sendIncidentNotifications: mocks.sendIncidentNotifications,
}));

vi.mock('@/lib/status-page-notifications', () => ({
  notifyStatusPageSubscribers: mocks.notifyStatusPageSubscribers,
}));

vi.mock('@/lib/status-page-webhooks', () => ({
  triggerWebhooksForService: mocks.triggerWebhooksForService,
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: mocks.loggerError },
}));

import {
  attemptAutoUnsnoozeInternal,
  processAutoUnsnoozeIncidentInternal,
} from '@/lib/unsnooze';

const NOW = new Date('2026-08-28T04:30:00.000Z');

function createTx() {
  return {
    incident: {
      findUnique: vi.fn(),
    },
  };
}

describe('system auto-unsnooze lifecycle adapter', () => {
  let tx: ReturnType<typeof createTx>;

  beforeEach(() => {
    vi.clearAllMocks();
    tx = createTx();
    mocks.runSerializableTransaction.mockImplementation(
      async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)
    );
    mocks.applyIncidentLifecycleCommand.mockResolvedValue({
      incidentId: 'inc-1',
      command: 'UNSNOOZE',
      source: 'SYSTEM',
      previousStatus: 'SNOOZED',
      status: 'OPEN',
      changed: true,
    });
  });

  it('checks expiry and applies UNSNOOZE inside the same serializable transaction', async () => {
    tx.incident.findUnique.mockResolvedValue({
      status: 'SNOOZED',
      snoozedUntil: new Date('2026-08-28T04:00:00.000Z'),
    });

    const result = await attemptAutoUnsnoozeInternal('inc-1', NOW);

    expect(result).toEqual({ outcome: 'changed' });
    expect(mocks.runSerializableTransaction).toHaveBeenCalledOnce();
    expect(mocks.applyIncidentLifecycleCommand).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        incidentId: 'inc-1',
        command: 'UNSNOOZE',
        source: 'SYSTEM',
        expectedStatus: 'SNOOZED',
        eventMessage: 'Incident auto-unsnoozed (snooze duration expired)',
        now: NOW,
      })
    );
  });

  it('returns the authoritative deadline when the snooze was extended', async () => {
    const snoozedUntil = new Date('2026-08-28T05:30:00.000Z');
    tx.incident.findUnique.mockResolvedValue({ status: 'SNOOZED', snoozedUntil });

    await expect(attemptAutoUnsnoozeInternal('inc-1', NOW)).resolves.toEqual({
      outcome: 'not_due',
      snoozedUntil,
    });

    expect(mocks.applyIncidentLifecycleCommand).not.toHaveBeenCalled();
  });

  it('treats stale jobs as idempotent no-ops', async () => {
    tx.incident.findUnique.mockResolvedValue({ status: 'OPEN', snoozedUntil: null });

    await expect(attemptAutoUnsnoozeInternal('inc-1', NOW)).resolves.toEqual({ outcome: 'noop' });
    expect(mocks.applyIncidentLifecycleCommand).not.toHaveBeenCalled();
  });

  it('emits post-commit effects only after a real lifecycle change', async () => {
    tx.incident.findUnique.mockResolvedValue({
      status: 'SNOOZED',
      snoozedUntil: new Date('2026-08-28T04:00:00.000Z'),
    });
    prismaMock.incident.findUnique.mockResolvedValue({
      id: 'inc-1',
      title: 'Database latency',
      description: 'p99 elevated',
      status: 'OPEN',
      urgency: 'HIGH',
      priority: 'P1',
      serviceId: 'svc-1',
      service: { id: 'svc-1', name: 'Database' },
      assignee: null,
      createdAt: new Date('2026-08-28T03:00:00.000Z'),
      acknowledgedAt: null,
      resolvedAt: null,
    });
    mocks.sendIncidentNotifications.mockResolvedValue({ success: true });
    mocks.notifyStatusPageSubscribers.mockResolvedValue(undefined);
    mocks.triggerWebhooksForService.mockResolvedValue(undefined);

    await expect(processAutoUnsnoozeIncidentInternal('inc-1', NOW)).resolves.toEqual({
      outcome: 'changed',
    });

    expect(mocks.sendIncidentNotifications).toHaveBeenCalledWith('inc-1', 'updated');
    expect(mocks.notifyStatusPageSubscribers).toHaveBeenCalledWith('inc-1', 'investigating');
    expect(mocks.triggerWebhooksForService).toHaveBeenCalledWith(
      'svc-1',
      'incident.updated',
      expect.objectContaining({ id: 'inc-1', status: 'OPEN' })
    );
  });

  it('does not repeat effects for an already-applied retry', async () => {
    tx.incident.findUnique.mockResolvedValue({ status: 'OPEN', snoozedUntil: null });

    await expect(processAutoUnsnoozeIncidentInternal('inc-1', NOW)).resolves.toEqual({
      outcome: 'noop',
    });

    expect(prismaMock.incident.findUnique).not.toHaveBeenCalled();
    expect(mocks.sendIncidentNotifications).not.toHaveBeenCalled();
    expect(mocks.notifyStatusPageSubscribers).not.toHaveBeenCalled();
    expect(mocks.triggerWebhooksForService).not.toHaveBeenCalled();
  });

  it('suppresses stale OPEN effects if the incident changed again after commit', async () => {
    tx.incident.findUnique.mockResolvedValue({
      status: 'SNOOZED',
      snoozedUntil: new Date('2026-08-28T04:00:00.000Z'),
    });
    prismaMock.incident.findUnique.mockResolvedValue({ status: 'SNOOZED' });

    await processAutoUnsnoozeIncidentInternal('inc-1', NOW);

    expect(mocks.sendIncidentNotifications).not.toHaveBeenCalled();
    expect(mocks.notifyStatusPageSubscribers).not.toHaveBeenCalled();
    expect(mocks.triggerWebhooksForService).not.toHaveBeenCalled();
  });
});
