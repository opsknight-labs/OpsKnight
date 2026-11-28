import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  logAudit: vi.fn(),
  teamUpdate: vi.fn(),
  memberFindFirst: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/prisma', () => ({ default: {} }));
vi.mock('@/lib/audit', () => ({ logAudit: mocks.logAudit }));
vi.mock('@/lib/access/settings', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/access/settings')>()),
  getAccessControlSettings: vi.fn().mockResolvedValue({}),
}));
vi.mock('@/lib/in-app-notifications', () => ({ createInAppNotifications: vi.fn() }));
vi.mock('@/lib/session-security-projection', () => ({
  invalidateSessionSecurityProjection: vi.fn(),
}));
vi.mock('@/lib/db-utils', () => ({ runSerializableTransaction: vi.fn() }));

import { setTeamLead } from '@/lib/teams/administration';

const TEAM_ID = 'ckteam000000000000000001';
const LEAD_ID = 'ckuser000000000000000001';
const OTHER_ID = 'ckuser000000000000000002';

function fakeTx(teamLeadId: string | null) {
  return {
    user: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'admin-1',
        role: 'ADMIN',
        status: 'ACTIVE',
        teamMemberships: [],
        customRole: null,
        accessGrants: [],
      }),
    },
    team: {
      findUnique: vi.fn().mockResolvedValue({ id: TEAM_ID, revision: 3, teamLeadId }),
      update: mocks.teamUpdate,
    },
    teamMember: { findFirst: mocks.memberFindFirst },
  } as never;
}

describe('setTeamLead with a disabled lead', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The lead has been disabled since being appointed: no ACTIVE member row matches.
    mocks.memberFindFirst.mockResolvedValue(null);
  });

  it('treats resubmitting the unchanged lead as a no-op instead of failing the edit', async () => {
    await expect(
      setTeamLead(TEAM_ID, { userId: LEAD_ID }, { id: 'admin-1' }, { client: fakeTx(LEAD_ID) })
    ).resolves.toMatchObject({ teamLeadId: LEAD_ID, revision: 3 });
    expect(mocks.teamUpdate).not.toHaveBeenCalled();
  });

  it('still refuses to appoint a disabled member as the new lead', async () => {
    await expect(
      setTeamLead(TEAM_ID, { userId: OTHER_ID }, { id: 'admin-1' }, { client: fakeTx(LEAD_ID) })
    ).rejects.toMatchObject({ userMessage: 'Team lead must be an active member of this team.' });
    expect(mocks.teamUpdate).not.toHaveBeenCalled();
  });
});
