import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  service: vi.fn(),
  members: vi.fn(),
  users: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({
  default: {
    service: { findUnique: h.service },
    teamMember: { findMany: h.members },
    user: { findMany: h.users },
    chatOpsConfig: { findUnique: vi.fn() },
    escalationRule: { findMany: vi.fn() },
  },
}));
vi.mock('@/lib/escalation/target-resolution', () => ({ resolveEscalationTarget: vi.fn() }));

import { resolveServiceWarRoomResponders } from '@/lib/war-room/oncall-responders';

beforeEach(() => {
  vi.clearAllMocks();
  h.users.mockImplementation(async (args: { where: { id: { in: string[] } } }) =>
    args.where.id.in.map(id => ({ id }))
  );
});

describe('resolveServiceWarRoomResponders', () => {
  it('adds nobody when nothing is configured', async () => {
    h.service.mockResolvedValue({
      teamId: 't1',
      warRoomAutoAddTeam: 'NONE',
      warRoomAutoAddUserIds: [],
    });
    expect(await resolveServiceWarRoomResponders('s1')).toEqual([]);
    expect(h.members).not.toHaveBeenCalled();
  });

  it('adds only team owners and admins in MANAGERS mode, plus named people outside the team', async () => {
    h.service.mockResolvedValue({
      teamId: 't1',
      warRoomAutoAddTeam: 'MANAGERS',
      warRoomAutoAddUserIds: ['outsider', 'mgr'],
    });
    h.members.mockResolvedValue([{ userId: 'mgr' }, { userId: 'lead' }]);
    const ids = await resolveServiceWarRoomResponders('s1');
    expect(h.members.mock.calls[0][0].where).toEqual({
      teamId: 't1',
      role: { in: ['OWNER', 'ADMIN'] },
    });
    expect(ids.sort()).toEqual(['lead', 'mgr', 'outsider']);
  });

  it('adds the whole team in ALL mode and keeps only active users', async () => {
    h.service.mockResolvedValue({
      teamId: 't1',
      warRoomAutoAddTeam: 'ALL',
      warRoomAutoAddUserIds: [],
    });
    h.members.mockResolvedValue([{ userId: 'a' }, { userId: 'b' }]);
    h.users.mockResolvedValue([{ id: 'a' }]);
    expect(await resolveServiceWarRoomResponders('s1')).toEqual(['a']);
    expect(h.users.mock.calls[0][0].where.status).toBe('ACTIVE');
    expect(h.members.mock.calls[0][0].where).toEqual({ teamId: 't1' });
  });

  it('still adds named people when the service has no team', async () => {
    h.service.mockResolvedValue({
      teamId: null,
      warRoomAutoAddTeam: 'ALL',
      warRoomAutoAddUserIds: ['x'],
    });
    expect(await resolveServiceWarRoomResponders('s1')).toEqual(['x']);
    expect(h.members).not.toHaveBeenCalled();
  });

  it('returns nothing for an unknown service', async () => {
    h.service.mockResolvedValue(null);
    expect(await resolveServiceWarRoomResponders('nope')).toEqual([]);
  });
});
