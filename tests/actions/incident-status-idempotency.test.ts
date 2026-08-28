import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  runSerializableTransaction: vi.fn(),
  assertCanModifyIncident: vi.fn(),
  assertCanAcknowledgeIncident: vi.fn(),
  getCurrentUser: vi.fn(),
  enqueueLifecycleSideEffects: vi.fn(),
  sendIncidentNotifications: vi.fn(),
  scheduleStatusPageNotification: vi.fn(),
  archiveWarRoomChannel: vi.fn(),
  postWarRoomUpdate: vi.fn(),
  updateWarRoomTopic: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {},
}));

vi.mock('@/lib/db-utils', () => ({
  runSerializableTransaction: mocks.runSerializableTransaction,
}));

vi.mock('@/lib/event-outbox', () => ({
  enqueueLifecycleSideEffects: mocks.enqueueLifecycleSideEffects,
}));

vi.mock('@/lib/rbac', () => ({
  assertCanModifyIncident: mocks.assertCanModifyIncident,
  assertCanAcknowledgeIncident: mocks.assertCanAcknowledgeIncident,
  assertResponderOrAbove: vi.fn(),
  getCurrentUser: mocks.getCurrentUser,
}));

vi.mock('@/lib/user-friendly-errors', () => ({
  getUserFriendlyError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('next/cache', () => ({
  revalidatePath: mocks.revalidatePath,
}));

// These mocks intentionally remain as regression tripwires: lifecycle action
// adapters must no longer dispatch external work directly after commit.
vi.mock('@/lib/user-notifications', () => ({
  sendIncidentNotifications: mocks.sendIncidentNotifications,
}));
vi.mock('@/lib/jobs/queue', () => ({
  scheduleStatusPageNotification: mocks.scheduleStatusPageNotification,
}));
vi.mock('@/lib/chatops/war-room', () => ({
  archiveWarRoomChannel: mocks.archiveWarRoomChannel,
  postWarRoomUpdate: mocks.postWarRoomUpdate,
  updateWarRoomTopic: mocks.updateWarRoomTopic,
}));

import { resolveIncidentWithNote, updateIncidentStatus } from '@/app/(app)/incidents/actions';

describe('incident lifecycle action idempotency', () => {
  const tx = {
    incident: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    customField: {
      findMany: vi.fn(),
    },
    incidentNote: {
      create: vi.fn(),
    },
    incidentEvent: {
      create: vi.fn(),
    },
  };

  type TransactionCallback = (client: typeof tx) => unknown | Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertCanModifyIncident.mockResolvedValue(undefined);
    mocks.getCurrentUser.mockResolvedValue({ id: 'user-1', name: 'Responder' });
    mocks.enqueueLifecycleSideEffects.mockResolvedValue(undefined);
    mocks.runSerializableTransaction.mockImplementation(async (callback: TransactionCallback) =>
      callback(tx)
    );
  });

  it('does not enqueue or dispatch side effects when ACK is retried after it already committed', async () => {
    tx.incident.findUnique.mockResolvedValue({
      status: 'ACKNOWLEDGED',
      acknowledgedAt: new Date(),
      resolvedAt: null,
      currentEscalationStep: 0,
    });

    await updateIncidentStatus('inc-1', 'ACKNOWLEDGED', 'OPEN');

    expect(tx.incident.update).not.toHaveBeenCalled();
    expect(mocks.enqueueLifecycleSideEffects).not.toHaveBeenCalled();
    expect(mocks.sendIncidentNotifications).not.toHaveBeenCalled();
    expect(mocks.scheduleStatusPageNotification).not.toHaveBeenCalled();
    expect(mocks.postWarRoomUpdate).not.toHaveBeenCalled();
    expect(mocks.updateWarRoomTopic).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('does not repeat resolution effects or notes when resolve-with-note is retried', async () => {
    tx.incident.findUnique.mockResolvedValue({
      id: 'inc-1',
      status: 'RESOLVED',
      resolvedAt: new Date(),
    });

    await resolveIncidentWithNote('inc-1', 'Resolved after database failover');

    expect(tx.incident.update).not.toHaveBeenCalled();
    expect(tx.incidentNote.create).not.toHaveBeenCalled();
    expect(tx.incidentEvent.create).not.toHaveBeenCalled();
    expect(mocks.enqueueLifecycleSideEffects).not.toHaveBeenCalled();
    expect(mocks.sendIncidentNotifications).not.toHaveBeenCalled();
    expect(mocks.scheduleStatusPageNotification).not.toHaveBeenCalled();
    expect(mocks.archiveWarRoomChannel).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('persists durable side-effect work for a real status transition without inline network dispatch', async () => {
    tx.incident.findUnique.mockResolvedValue({
      status: 'OPEN',
      acknowledgedAt: null,
      resolvedAt: null,
      currentEscalationStep: 0,
    });
    tx.incident.update.mockResolvedValue({});

    await updateIncidentStatus('inc-1', 'ACKNOWLEDGED', 'OPEN');

    expect(tx.incident.update).toHaveBeenCalledOnce();
    expect(mocks.enqueueLifecycleSideEffects).toHaveBeenCalledOnce();
    expect(mocks.sendIncidentNotifications).not.toHaveBeenCalled();
    expect(mocks.scheduleStatusPageNotification).not.toHaveBeenCalled();
    expect(mocks.postWarRoomUpdate).not.toHaveBeenCalled();
    expect(mocks.updateWarRoomTopic).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).toHaveBeenCalled();
  });
});
