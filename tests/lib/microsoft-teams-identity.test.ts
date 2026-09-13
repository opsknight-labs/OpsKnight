import { beforeEach, describe, expect, it, vi } from 'vitest';

const linkFindUnique = vi.fn();
const challengeCreate = vi.fn();
const challengeFindUnique = vi.fn();
const challengeUpdateMany = vi.fn();
const linkUpsert = vi.fn();
const prismaMock = {
  chatIdentityLink: { findUnique: linkFindUnique },
  chatIdentityChallenge: { create: challengeCreate },
  $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback({
    chatIdentityChallenge: { findUnique: challengeFindUnique, updateMany: challengeUpdateMany },
    chatIdentityLink: { upsert: linkUpsert },
  })),
};

vi.mock('@/lib/prisma', () => ({ default: prismaMock }));

describe('Microsoft Teams explicit identity linking', () => {
  beforeEach(() => vi.clearAllMocks());

  it('resolves only an active, tenant-scoped matching identity', async () => {
    const row = { id: 'link-1', providerUserId: 'teams-user', revokedAt: null, user: { id: 'user-1', name: 'Alice', status: 'ACTIVE' } };
    linkFindUnique.mockResolvedValue(row);
    const { resolveMicrosoftTeamsUser } = await import('@/lib/microsoft-teams/identity');
    await expect(resolveMicrosoftTeamsUser({ tenantId: 'tenant-1', providerUserId: 'teams-user', aadObjectId: 'aad-1' })).resolves.toEqual({ linkId: 'link-1', userId: 'user-1', displayName: 'Alice' });
    expect(linkFindUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { provider_providerTenantId_providerObjectId: expect.objectContaining({ providerTenantId: 'tenant-1', providerObjectId: 'aad-1' }) } }));
  });

  it('rejects object-id and bot-user-id links that disagree', async () => {
    linkFindUnique.mockResolvedValueOnce({ id: 'link-a', providerUserId: 'teams-user', revokedAt: null, user: { id: 'user-1', name: 'A', status: 'ACTIVE' } });
    linkFindUnique.mockResolvedValueOnce({ id: 'link-b', providerUserId: 'teams-user', revokedAt: null, user: { id: 'user-2', name: 'B', status: 'ACTIVE' } });
    const { resolveMicrosoftTeamsUser } = await import('@/lib/microsoft-teams/identity');
    await expect(resolveMicrosoftTeamsUser({ tenantId: 'tenant-1', providerUserId: 'teams-user', aadObjectId: 'aad-1' })).rejects.toThrow('mismatch');
  });

  it('stores only a hash of a random short-lived challenge', async () => {
    challengeCreate.mockResolvedValue({ id: 'challenge' });
    const { createMicrosoftTeamsIdentityChallenge } = await import('@/lib/microsoft-teams/identity');
    const token = await createMicrosoftTeamsIdentityChallenge({ tenantId: 'tenant-1', providerUserId: 'teams-user' });
    expect(token.length).toBeGreaterThan(32);
    expect(challengeCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ tokenHash: expect.not.stringContaining(token), expiresAt: expect.any(Date) }) });
  });

  it('consumes a valid challenge once inside the link transaction', async () => {
    challengeFindUnique.mockResolvedValue({ id: 'challenge', provider: 'MICROSOFT_TEAMS', providerTenantId: 'tenant-1', providerUserId: 'teams-user', providerObjectId: 'aad-1', displayName: 'Alice', consumedAt: null, expiresAt: new Date(Date.now() + 60_000) });
    challengeUpdateMany.mockResolvedValue({ count: 1 });
    linkUpsert.mockResolvedValue({ id: 'link-1' });
    const { consumeMicrosoftTeamsIdentityChallenge } = await import('@/lib/microsoft-teams/identity');
    await expect(consumeMicrosoftTeamsIdentityChallenge('a'.repeat(43), 'user-1')).resolves.toEqual({ id: 'link-1' });
    expect(challengeUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ consumedAt: null }) }));
  });
});
