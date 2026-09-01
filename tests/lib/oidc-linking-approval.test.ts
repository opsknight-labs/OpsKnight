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
    oidcLinkingApproval: { findUnique: vi.fn(), upsert: vi.fn(), updateMany: vi.fn() },
  },
}));

import prisma from '@/lib/prisma';
import {
  allowOidcLinking,
  getOidcLinkingState,
  revokeOidcLinking,
} from '@/app/(app)/users/oidc-actions';

describe('OIDC linking approval management', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.user.findUnique as any).mockResolvedValue({
      id: 'user-1',
      email: 'User@Example.com',
      status: 'ACTIVE',
    });
    (prisma.oidcIdentity.findFirst as any).mockResolvedValue(null);
    (prisma.oidcLinkingApproval.findUnique as any).mockResolvedValue(null);
    (prisma.oidcLinkingApproval.upsert as any).mockResolvedValue({ id: 'approval-1' });
    (prisma.oidcLinkingApproval.updateMany as any).mockResolvedValue({ count: 1 });
  });

  it('reports not-approved when an active user has no identity or provisioning evidence', async () => {
    const result = await getOidcLinkingState('user-1');
    expect(result).toEqual({ success: true, state: 'not-approved', alreadyLinked: false });
  });

  it('records durable provisioning approval without changing user status', async () => {
    const result = await allowOidcLinking('user-1');

    expect(result).toEqual({ success: true, state: 'approved' });
    expect(prisma.oidcLinkingApproval.upsert).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      create: { userId: 'user-1', approvedById: 'admin-1' },
      update: expect.objectContaining({ approvedById: 'admin-1', revokedAt: null }),
    });
    expect(prisma.user.update).toBeUndefined();
  });

  it('reports approved when provisioning evidence already exists', async () => {
    (prisma.oidcLinkingApproval.findUnique as any).mockResolvedValue({
      id: 'approval-1',
      revokedAt: null,
    });

    const state = await getOidcLinkingState('user-1');
    const allowResult = await allowOidcLinking('user-1');

    expect(state).toEqual({ success: true, state: 'approved', alreadyLinked: false });
    expect(allowResult).toEqual({ success: true, alreadyApproved: true, state: 'approved' });
    expect(prisma.oidcLinkingApproval.upsert).not.toHaveBeenCalled();
  });

  it('reports already-linked users without creating provisioning evidence', async () => {
    (prisma.oidcIdentity.findFirst as any).mockResolvedValue({ id: 'identity-1' });

    const result = await allowOidcLinking('user-1');

    expect(result).toEqual({ success: true, alreadyLinked: true, state: 'linked' });
    expect(prisma.oidcLinkingApproval.findUnique).not.toHaveBeenCalled();
    expect(prisma.oidcLinkingApproval.upsert).not.toHaveBeenCalled();
  });

  it('revokes pending first-link eligibility without changing credentials or status', async () => {
    (prisma.oidcLinkingApproval.findUnique as any).mockResolvedValue({
      id: 'approval-1',
      revokedAt: null,
    });

    const result = await revokeOidcLinking('user-1');

    expect(result).toEqual({ success: true, state: 'not-approved' });
    expect(prisma.oidcLinkingApproval.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(prisma.user.update).toBeUndefined();
  });

  it('does not use revoke approval to unlink an established identity', async () => {
    (prisma.oidcIdentity.findFirst as any).mockResolvedValue({ id: 'identity-1' });

    const result = await revokeOidcLinking('user-1');

    expect(result).toEqual({
      error:
        'This user already has an OIDC identity linked. Revoking approval does not unlink identities.',
      alreadyLinked: true,
      state: 'linked',
    });
    expect(prisma.oidcLinkingApproval.updateMany).not.toHaveBeenCalled();
  });

  it('rejects approval management for disabled users', async () => {
    (prisma.user.findUnique as any).mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      status: 'DISABLED',
    });

    const allowResult = await allowOidcLinking('user-1');
    const revokeResult = await revokeOidcLinking('user-1');

    expect(allowResult).toEqual({
      error: 'OIDC linking approval can only be managed for active users.',
    });
    expect(revokeResult).toEqual({
      error: 'OIDC linking approval can only be managed for active users.',
    });
    expect(prisma.oidcLinkingApproval.upsert).not.toHaveBeenCalled();
    expect(prisma.oidcLinkingApproval.updateMany).not.toHaveBeenCalled();
  });
});
