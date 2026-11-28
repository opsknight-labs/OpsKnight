import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => {
  const tx = {
    warRoomParticipant: {
      updateMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    backgroundJob: { create: vi.fn() },
  };
  return {
    tx,
    incidentWarRoom: { findUnique: vi.fn() },
    chatIdentityLink: { findMany: vi.fn(), findFirst: vi.fn() },
    user: { findMany: vi.fn() },
    chatOpsConfig: { findUnique: vi.fn() },
    service: { findUnique: vi.fn().mockResolvedValue(null) },
    $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
  };
});

vi.mock('@/lib/prisma', () => ({ default: db }));
vi.mock('@/lib/slack', () => ({ getSlackBotToken: vi.fn().mockResolvedValue('xoxb-test') }));

import {
  projectIncidentWarRoomParticipants,
  requestWarRoomParticipant,
} from '@/lib/war-room/participant-desired-state';

describe('Slack war-room participants resolve by email when no identity link exists', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.chatOpsConfig.findUnique.mockResolvedValue(null);
    db.chatIdentityLink.findMany.mockResolvedValue([]);
    db.chatIdentityLink.findFirst.mockResolvedValue(null);
    db.user.findMany.mockResolvedValue([{ id: 'u1', email: 'dev@example.com' }]);
    db.tx.warRoomParticipant.findFirst.mockResolvedValue(null);
    global.fetch = vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, user: { id: 'USLACK1', deleted: false } }),
    }) as unknown as typeof fetch;
  });

  it('projects the assignee as DESIRED with the Slack user id', async () => {
    db.incidentWarRoom.findUnique.mockResolvedValue({
      id: 'room-1',
      provider: 'SLACK',
      providerTenantId: 'T1',
      incident: { serviceId: 'svc-1', assigneeId: 'u1', roleAssignments: [], watchers: [] },
    });

    await projectIncidentWarRoomParticipants('room-1');

    expect(String(vi.mocked(global.fetch).mock.calls[0][0])).toContain(
      'users.lookupByEmail?email=dev%40example.com'
    );
    expect(db.tx.warRoomParticipant.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'u1',
        providerUserId: 'USLACK1',
        state: 'DESIRED',
      }),
    });
  });

  it('projects incident role holders as ROLE participants and keeps the assignee source', async () => {
    db.user.findMany.mockResolvedValue([
      { id: 'u1', email: 'dev@example.com' },
      { id: 'u2', email: 'ic@example.com' },
    ]);
    db.incidentWarRoom.findUnique.mockResolvedValue({
      id: 'room-1',
      provider: 'SLACK',
      providerTenantId: 'T1',
      incident: {
        serviceId: 'svc-1',
        assigneeId: 'u1',
        roleAssignments: [{ userId: 'u1' }, { userId: 'u2' }],
        watchers: [{ userId: 'u2' }],
      },
    });

    await projectIncidentWarRoomParticipants('room-1');

    const sources = Object.fromEntries(
      db.tx.warRoomParticipant.create.mock.calls.map(([arg]) => [arg.data.userId, arg.data.source])
    );
    expect(sources).toEqual({ u1: 'ASSIGNEE', u2: 'ROLE' });
  });

  it('accepts a manual invite for an unlinked user found by email', async () => {
    db.incidentWarRoom.findUnique.mockResolvedValue({
      id: 'room-1',
      provider: 'SLACK',
      providerTenantId: 'T1',
      state: 'READY',
      incident: { serviceId: 'svc-1' },
    });

    await expect(requestWarRoomParticipant('room-1', 'u1', 'MANUAL')).resolves.toEqual({
      accepted: true,
    });
  });

  it('still skips users Slack does not know', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      json: async () => ({ ok: false, error: 'users_not_found' }),
    }) as unknown as typeof fetch;
    db.incidentWarRoom.findUnique.mockResolvedValue({
      id: 'room-1',
      provider: 'SLACK',
      providerTenantId: 'T1',
      incident: { serviceId: 'svc-1', assigneeId: 'u1', roleAssignments: [], watchers: [] },
    });

    await projectIncidentWarRoomParticipants('room-1');

    expect(db.tx.warRoomParticipant.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ state: 'SKIPPED', lastErrorCode: 'IDENTITY_NOT_LINKED' }),
    });
  });

  describe('re-projection', () => {
    const room = {
      id: 'room-1',
      provider: 'SLACK',
      providerTenantId: 'T1',
      incident: { serviceId: 'svc-1', assigneeId: 'u1', roleAssignments: [], watchers: [] },
    };
    const existing = (state: string) => ({
      id: 'p1',
      userId: 'u1',
      source: 'ASSIGNEE',
      providerUserId: 'USLACK1',
      providerObjectId: 'USLACK1',
      state,
    });

    it.each(['PRESENT', 'PENDING', 'PROCESSING'])(
      'keeps a %s person in that state when nothing about them changed',
      async state => {
        db.incidentWarRoom.findUnique.mockResolvedValue(room);
        db.tx.warRoomParticipant.findFirst.mockResolvedValue(existing(state));
        await projectIncidentWarRoomParticipants('room-1');
        const data = db.tx.warRoomParticipant.update.mock.calls[0][0].data;
        expect(data.state).toBe(state);
        expect(data.desiredVersion).toBeUndefined();
      }
    );

    it('still retries a FAILED person', async () => {
      db.incidentWarRoom.findUnique.mockResolvedValue(room);
      db.tx.warRoomParticipant.findFirst.mockResolvedValue(existing('FAILED'));
      await projectIncidentWarRoomParticipants('room-1');
      expect(db.tx.warRoomParticipant.update.mock.calls[0][0].data.state).toBe('DESIRED');
    });

    it('removes people who are no longer wanted, including ones that were skipped as unlinked', async () => {
      db.incidentWarRoom.findUnique.mockResolvedValue(room);
      await projectIncidentWarRoomParticipants('room-1');
      const where = db.tx.warRoomParticipant.updateMany.mock.calls[0][0].where;
      expect(where.state.in).toEqual(expect.arrayContaining(['SKIPPED', 'PRESENT']));
    });
  });
});
