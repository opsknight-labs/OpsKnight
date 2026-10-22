import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
vi.mock('@/lib/prisma', () => ({
  default: {
    scimGroup: { findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock('@/lib/scim/security/credentials', () => ({
  authorize: vi.fn(),
  recheck: vi.fn(),
  authenticate: vi.fn(),
  scopes: [],
  createCredential: vi.fn(),
}));
vi.mock('@/lib/auth-control/actor', () => ({
  getControlActor: vi.fn(),
  lockControlActor: vi.fn(),
}));
import prisma from '@/lib/prisma';
import { authorize } from '@/lib/scim/security/credentials';
import { GET } from '@/app/api/scim/v2/Groups/route';
import { GET as resource } from '@/app/api/scim/v2/Groups/[id]/route';
describe('SCIM Groups directory boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authorize).mockResolvedValue({
      connectorId: 'source-a',
      credentialId: 'key-a',
      scopes: ['groups:read'],
    });
  });
  it('does not expose an operational team by its ID', async () => {
    vi.mocked(prisma.scimGroup.findFirst).mockResolvedValue(null);
    const response = await resource(
      new NextRequest('https://ops.test/api/scim/v2/Groups/operational-team'),
      { params: Promise.resolve({ id: 'operational-team' }) }
    );
    expect(response.status).toBe(404);
    expect(prisma.scimGroup.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'operational-team', connectorId: 'source-a' } })
    );
  });
  it('does not load or serialize excluded membership collections', async () => {
    vi.mocked(prisma.$transaction).mockResolvedValue([
      [{ id: 'g1', name: 'Directory group', createdAt: new Date(), updatedAt: new Date() }],
      1,
    ] as never);
    const response = await GET(
      new NextRequest('https://ops.test/api/scim/v2/Groups?excludedAttributes=members')
    );
    expect(response.status).toBe(200);
    expect(prisma.scimGroup.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: { memberships: false },
        where: { connectorId: 'source-a' },
      })
    );
    expect((await response.json()).Resources[0]).not.toHaveProperty('members');
  });
  it.each(['count=-1', 'count=1.5', 'startIndex=0', 'filter=displayName%20co%20%22ops%22'])(
    'rejects unsupported collection query %s',
    async query => {
      expect(
        (await GET(new NextRequest(`https://ops.test/api/scim/v2/Groups?${query}`))).status
      ).toBe(400);
    }
  );
});
