import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  updateMany: vi.fn(),
  txUpdateMany: vi.fn(),
  jobCreate: vi.fn(),
  createOrGetMeeting: vi.fn(),
  emitAudit: vi.fn(),
}));

vi.mock('@/lib/prisma', () => {
  const prisma = {
    incidentMeeting: { findFirst: mocks.findFirst, updateMany: mocks.updateMany },
    backgroundJob: { create: mocks.jobCreate },
    $transaction: async (fn: (tx: unknown) => unknown) =>
      fn({
        incidentMeeting: { updateMany: mocks.txUpdateMany },
        backgroundJob: { create: mocks.jobCreate },
      }),
  };
  return { __esModule: true, default: prisma };
});
vi.mock('@/lib/incident-collaboration/meeting-audit', () => ({
  emitMeetingAuditEvent: mocks.emitAudit,
}));
vi.mock('@/lib/incident-collaboration/meeting-registry', () => ({
  MeetingProviderRegistry: { createOrGetMeeting: mocks.createOrGetMeeting },
}));

import { executeMeetingProvision } from '@/lib/incident-collaboration/meeting-store';

const provisioningRow = {
  id: 'meet_inc-1_1',
  incidentId: 'inc-1',
  generation: 1,
  provider: 'MICROSOFT_TEAMS',
  state: 'PROVISIONING',
  health: 'HEALTHY',
  externalId: 'opsknight:inc-1:1',
  joinUrl: '',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  provisioningToken: 'tok-1',
};

describe('executeMeetingProvision when the bridge is closed during provisioning', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findFirst.mockResolvedValue(provisioningRow);
    mocks.createOrGetMeeting.mockResolvedValue({
      externalId: 'opsknight:inc-1:1',
      joinUrl: 'https://teams.example/join',
      providerMeetingId: 'graph-meeting-1',
      organizerEmail: 'organizer@example.com',
    });
    // The READY update loses to the close that settled the row.
    mocks.updateMany.mockResolvedValue({ count: 0 });
    mocks.txUpdateMany.mockResolvedValue({ count: 1 });
  });

  it('records the created Teams meeting as cleanup debt and queues its removal', async () => {
    await executeMeetingProvision({
      incidentId: 'inc-1',
      provisioningToken: 'tok-1',
      provider: 'MICROSOFT_TEAMS',
      generation: 1,
    });

    expect(mocks.txUpdateMany).toHaveBeenCalledWith({
      where: { incidentId: 'inc-1', generation: 1, state: 'CLOSED', providerMeetingId: null },
      data: expect.objectContaining({
        providerMeetingId: 'graph-meeting-1',
        organizerEmail: 'organizer@example.com',
        externalCleanupPending: true,
      }),
    });
    expect(mocks.jobCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'MEETING_CLOSE',
        payload: expect.objectContaining({
          incidentId: 'inc-1',
          cleanupRepair: true,
          providerMeetingId: 'graph-meeting-1',
        }),
      }),
    });
  });

  it('queues nothing when the row is not a closed meeting without a provider id', async () => {
    mocks.txUpdateMany.mockResolvedValue({ count: 0 });

    await executeMeetingProvision({
      incidentId: 'inc-1',
      provisioningToken: 'tok-1',
      provider: 'MICROSOFT_TEAMS',
      generation: 1,
    });

    expect(mocks.jobCreate).not.toHaveBeenCalled();
  });

  it('has nothing to clean up for a bridge without a provider meeting id', async () => {
    mocks.createOrGetMeeting.mockResolvedValue({
      externalId: 'opsknight:inc-1:1',
      joinUrl: 'https://meet.jit.si/x',
    });

    await executeMeetingProvision({
      incidentId: 'inc-1',
      provisioningToken: 'tok-1',
      provider: 'JITSI',
      generation: 1,
    });

    expect(mocks.txUpdateMany).not.toHaveBeenCalled();
    expect(mocks.jobCreate).not.toHaveBeenCalled();
  });
});
