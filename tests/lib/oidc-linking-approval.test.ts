import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/rbac', () => ({
  assertAdmin: vi.fn().mockResolvedValue({ id: 'admin-1', email: 'admin@example.com' }),
}));

vi.mock('@/lib/audit', () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    user: { findUnique: vi.fn() },
    oidcIdentity: { findFirst: vi.fn() },
    userToken: { findFirst: vi.fn(), create: vi.fn() },
  },
}));

import prisma from '@/lib/prisma';
import { allowOidcLinking } from '@/app/(app)/users/oidc-actions';

describe('allowOidcLinking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.user.findUnique as any).mockResolvedValue({
      id: 'user-1',
      email: 'User@Example.com',
      status: 'ACTIVE',
    });
    (prisma.oidcIdentity.findFirst as any).mockResolvedValue(null);
    (prisma.userToken.findFirst as any).mockResolvedValue(null);
    (prisma.userToken.create as any).mockResolvedValue({ id: 'marker-1' });
  });

  it('records non-redeemable provisioning evidence without changing user status', async () => {
    const result = await allowOidcLinking('user-1');

    expect(result).toEqual({ success: true });
    expect(prisma.userToken.create).toHaveBeenCalledTimes(1);
    expect(prisma.userToken.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        identifier: 'user@example.com',
        type: 'INVITE',
        tokenHash: expect.any(String),
        expiresAt: expect.any(Date),
        usedAt: expect.any(Date),
      }),
    });
    expect(prisma.user.update).toBeUndefined();
  });

  it('does not create duplicate evidence when provisioning evidence already exists', async () => {
    (prisma.userToken.findFirst as any).mockResolvedValue({ id: 'existing-invite' });

    const result = await allowOidcLinking('user-1');

    expect(result).toEqual({ success: true });
    expect(prisma.userToken.create).not.toHaveBeenCalled();
  });

  it('reports already-linked users without creating provisioning evidence', async () => {
    (prisma.oidcIdentity.findFirst as any).mockResolvedValue({ id: 'identity-1' });

    const result = await allowOidcLinking('user-1');

    expect(result).toEqual({ success: true, alreadyLinked: true });
    expect(prisma.userToken.findFirst).not.toHaveBeenCalled();
    expect(prisma.userToken.create).not.toHaveBeenCalled();
  });

  it('rejects disabled users', async () => {
    (prisma.user.findUnique as any).mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      status: 'DISABLED',
    });

    const result = await allowOidcLinking('user-1');

    expect(result).toEqual({ error: 'Reactivate the user before allowing OIDC linking.' });
    expect(prisma.userToken.create).not.toHaveBeenCalled();
  });
});
