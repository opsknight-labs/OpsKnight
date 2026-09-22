import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/prisma', () => ({
  default: {
    team: { count: vi.fn() },
    service: { count: vi.fn() },
    incident: { count: vi.fn() },
  },
}));

import prisma from '@/lib/prisma';
import { resolveAccessContext } from '@/lib/access-context';
import type { AuthorizationActor } from '@/lib/authorization-policy';

const user = (teamIds: string[] = []): AuthorizationActor => ({
  id: 'user-1',
  role: 'USER',
  status: 'ACTIVE',
  teamIds,
});

describe('resolveAccessContext', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns NONE when a scoped user has no teams, assignments, or watches', async () => {
    vi.mocked(prisma.service.count).mockResolvedValue(0);
    vi.mocked(prisma.incident.count).mockResolvedValue(0);

    await expect(resolveAccessContext(user())).resolves.toEqual({
      mode: 'NONE',
      canOperate: false,
      teamCount: 0,
      serviceCount: 0,
      incidentCount: 0,
    });
  });

  it('recognizes direct assignment or watch access without team membership', async () => {
    vi.mocked(prisma.service.count).mockResolvedValue(0);
    vi.mocked(prisma.incident.count).mockResolvedValue(1);

    await expect(resolveAccessContext(user())).resolves.toMatchObject({
      mode: 'SCOPED',
      incidentCount: 1,
      teamCount: 0,
    });
  });

  it('gives auditors global read-only context', async () => {
    vi.mocked(prisma.team.count).mockResolvedValue(3);
    vi.mocked(prisma.service.count).mockResolvedValue(5);
    vi.mocked(prisma.incident.count).mockResolvedValue(100);

    await expect(
      resolveAccessContext({ id: 'auditor-1', role: 'AUDITOR', status: 'ACTIVE', teamIds: [] })
    ).resolves.toMatchObject({ mode: 'GLOBAL', canOperate: false, incidentCount: 100 });
  });
});
