import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findRoom: vi.fn(),
  findParticipant: vi.fn(),
  updateParticipant: vi.fn(),
  findConfig: vi.fn(),
  findDestination: vi.fn(),
  listTeamMembers: vi.fn(),
  listChannelMembers: vi.fn(),
  removeChannelMember: vi.fn(),
  updateChannelMemberRoles: vi.fn(),
  scheduleJob: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    incidentWarRoom: { findUnique: mocks.findRoom },
    warRoomParticipant: { findUnique: mocks.findParticipant, updateMany: mocks.updateParticipant },
    microsoftTeamsConfig: { findFirst: mocks.findConfig },
    microsoftTeamsDestination: { findUnique: mocks.findDestination },
  },
}));
vi.mock('@/lib/microsoft-teams/graph/members', () => ({
  addChannelMember: vi.fn(),
  listChannelMembers: mocks.listChannelMembers,
  listTeamMembers: mocks.listTeamMembers,
  removeChannelMember: mocks.removeChannelMember,
  updateChannelMemberRoles: mocks.updateChannelMemberRoles,
}));
vi.mock('@/lib/jobs/queue', () => ({ scheduleJob: mocks.scheduleJob }));
vi.mock('@/lib/war-room/microsoft-teams', () => ({
  WarRoomRetryableError: class WarRoomRetryableError extends Error {},
}));

import { syncMicrosoftTeamsWarRoomParticipants } from '@/lib/war-room/participants';

const target = {
  id: 'participant-target',
  providerObjectId: 'target-object',
  providerUserId: null,
  state: 'REMOVED',
  desiredVersion: 5,
};

function room(participants = [target]) {
  return {
    id: 'room-1',
    provider: 'MICROSOFT_TEAMS',
    state: 'READY',
    destinationId: 'destination-1',
    installationId: null,
    providerTenantId: 'tenant-1',
    providerContainerId: 'team-1',
    providerChannelId: 'channel-1',
    membershipType: 'PRIVATE',
    participants,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // The projection pre-pass is intentionally a no-op; the sync load is next.
  mocks.findRoom.mockResolvedValueOnce(null);
  mocks.findConfig.mockResolvedValue({ id: 'config-1' });
  mocks.findDestination.mockResolvedValue({
    enabled: true,
    warRoomEnabled: true,
    installationId: null,
    tenantId: 'tenant-1',
    teamId: 'team-1',
  });
  mocks.listTeamMembers.mockResolvedValue({ ok: true, value: new Map() });
  mocks.updateParticipant.mockResolvedValue({ count: 0 });
  mocks.scheduleJob.mockResolvedValue(undefined);
});

describe('Microsoft Teams participant race fences', () => {
  it('does not persist REMOVED after a successful delete races with re-add, and schedules compensation', async () => {
    mocks.findRoom.mockResolvedValueOnce(room());
    mocks.listChannelMembers.mockResolvedValue({
      ok: true,
      value: new Map([['target-object', { id: 'membership-target', userId: 'target-object', roles: [] }]]),
    });
    mocks.findParticipant
      .mockResolvedValueOnce({ state: 'REMOVED', desiredVersion: 5 })
      .mockResolvedValueOnce({ state: 'REMOVED', desiredVersion: 5 });
    mocks.removeChannelMember.mockResolvedValue({ ok: true });

    await syncMicrosoftTeamsWarRoomParticipants('room-1');

    expect(mocks.removeChannelMember).toHaveBeenCalledWith(expect.objectContaining({ membershipId: 'membership-target' }));
    expect(mocks.updateParticipant).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ desiredVersion: 5 }),
      data: expect.objectContaining({ state: 'REMOVED' }),
    }));
    expect(mocks.scheduleJob).toHaveBeenCalledWith('WAR_ROOM_PARTICIPANT_SYNC', expect.any(Date), { warRoomId: 'room-1' }, 5);
  });

  it('refuses to promote an owner candidate whose desired generation changed', async () => {
    const candidate = {
      id: 'participant-candidate',
      providerObjectId: 'candidate-object',
      providerUserId: null,
      state: 'PRESENT',
      desiredVersion: 7,
    };
    mocks.findRoom.mockResolvedValueOnce(room([target, candidate]));
    mocks.listChannelMembers.mockResolvedValue({
      ok: true,
      value: new Map([
        ['target-object', { id: 'membership-target', userId: 'target-object', roles: ['owner'] }],
        ['candidate-object', { id: 'membership-candidate', userId: 'candidate-object', roles: [] }],
      ]),
    });
    mocks.findParticipant
      .mockResolvedValueOnce({ state: 'REMOVED', desiredVersion: 5 })
      .mockResolvedValueOnce({ state: 'REMOVED', desiredVersion: 8 });

    await syncMicrosoftTeamsWarRoomParticipants('room-1');

    expect(mocks.updateChannelMemberRoles).not.toHaveBeenCalled();
    expect(mocks.removeChannelMember).not.toHaveBeenCalled();
  });
});
