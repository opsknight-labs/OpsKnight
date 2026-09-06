import { beforeEach, describe, expect, it, vi } from 'vitest';
import prisma from '@/lib/prisma';
import { resolveApiKeyActor, resolveUserActor } from '@/lib/authorization-actors';

vi.mock('@/lib/prisma', () => ({
  default: { user: { findUnique: vi.fn() } },
}));

describe('authorization actor adapters', () => {
  beforeEach(() => vi.clearAllMocks());

  it('normalizes a database user and team memberships', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'user-1',
      role: 'USER',
      status: 'ACTIVE',
      teamMemberships: [{ teamId: 'team-1' }],
    } as never);

    await expect(resolveUserActor('user-1')).resolves.toEqual({
      id: 'user-1',
      role: 'USER',
      status: 'ACTIVE',
      teamIds: ['team-1'],
    });
  });

  it('intersects API scopes with the current database identity', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'user-1',
      role: 'RESPONDER',
      status: 'ACTIVE',
      teamMemberships: [],
    } as never);

    await expect(
      resolveApiKeyActor({ id: 'key-1', userId: 'user-1', scopes: ['incidents:read'] })
    ).resolves.toMatchObject({
      role: 'RESPONDER',
      apiKey: { id: 'key-1', scopes: ['incidents:read'] },
    });
  });

  it('returns null for missing identities', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    await expect(resolveUserActor('missing')).resolves.toBeNull();
  });
});
