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
    oidcConfig: { findFirst: vi.fn() },
  },
}));

import prisma from '@/lib/prisma';
import {
  allowOidcLinking,
  getOidcLinkingState,
  revokeOidcLinking,
} from '@/app/(app)/users/oidc-actions';
import { OIDC_LINKING_APPROVAL_TTL_HOURS } from '@/lib/oidc-linking-approval';

describe('OIDC linking approval management', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'user-1',
      email: 'User@Example.com',
      status: 'ACTIVE',
    } as never);
    vi.mocked(prisma.oidcIdentity.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.oidcLinkingApproval.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.oidcLinkingApproval.upsert).mockResolvedValue({ id: 'approval-1' } as never);
    vi.mocked(prisma.oidcLinkingApproval.updateMany).mockResolvedValue({ count: 1 });
    vi.mocked(prisma.oidcConfig.findFirst).mockResolvedValue({
      id: 'default',
      issuer: 'https://idp.example.com',
      clientId: 'client-id',
      configVersion: 1,
      enabled: true,
    } as never);
  });

  it('reports not-approved when no identity or approval exists', async () => {
    const result = await getOidcLinkingState('user-1');
    expect(result).toEqual({ success: true, state: 'not-approved', alreadyLinked: false });
  });

  it('reports approved for an active, unrevoked approval', async () => {
    vi.mocked(prisma.oidcLinkingApproval.findUnique).mockResolvedValue({
      id: 'approval-1',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    } as never);

    const result = await getOidcLinkingState('user-1');
    expect(result).toEqual({ success: true, state: 'approved', alreadyLinked: false });
  });

  it('reports expired when the approval expiry is in the past', async () => {
    vi.mocked(prisma.oidcLinkingApproval.findUnique).mockResolvedValue({
      id: 'approval-1',
      revokedAt: null,
      expiresAt: new Date(Date.now() - 1),
    } as never);

    const result = await getOidcLinkingState('user-1');
    expect(result).toEqual({ success: true, state: 'expired', alreadyLinked: false });
  });

  it('reports revoked before considering expiry', async () => {
    vi.mocked(prisma.oidcLinkingApproval.findUnique).mockResolvedValue({
      id: 'approval-1',
      revokedAt: new Date(),
      expiresAt: new Date(Date.now() - 1),
    } as never);

    const result = await getOidcLinkingState('user-1');
    expect(result).toEqual({ success: true, state: 'revoked', alreadyLinked: false });
  });

  it('records a time-limited approval without changing user status', async () => {
    const now = new Date('2026-09-10T12:00:00.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const result = await allowOidcLinking('user-1');

    expect(result).toEqual({ success: true, state: 'approved', renewed: false });
    const expectedExpiry = new Date(
      now.getTime() + OIDC_LINKING_APPROVAL_TTL_HOURS * 60 * 60 * 1000
    );
    expect(prisma.oidcLinkingApproval.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-1' },
        create: expect.objectContaining({
          userId: 'user-1',
          approvedById: 'admin-1',
          approvedAt: now,
          expiresAt: expectedExpiry,
        }),
      })
    );
    expect(prisma.user.update).toBeUndefined();
  });

  it('keeps an active approval idempotent', async () => {
    vi.mocked(prisma.oidcLinkingApproval.findUnique).mockResolvedValue({
      id: 'approval-1',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    } as never);

    const result = await allowOidcLinking('user-1');

    expect(result).toEqual({ success: true, alreadyApproved: true, state: 'approved' });
    expect(prisma.oidcLinkingApproval.upsert).not.toHaveBeenCalled();
  });

  it('renews an expired approval with a fresh approver, expiry and generation', async () => {
    const now = new Date('2026-09-10T12:00:00.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(now);
    vi.mocked(prisma.oidcLinkingApproval.findUnique).mockResolvedValue({
      id: 'approval-1',
      revokedAt: null,
      expiresAt: new Date('2026-09-09T12:00:00.000Z'),
    } as never);

    const result = await allowOidcLinking('user-1');

    expect(result).toEqual({ success: true, state: 'approved', renewed: true });
    expect(prisma.oidcLinkingApproval.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          approvedById: 'admin-1',
          approvedAt: now,
          revokedAt: null,
          expiresAt: expect.any(Date),
          generation: { increment: 1 },
        }),
      })
    );
    const update = vi.mocked(prisma.oidcLinkingApproval.upsert).mock.calls[0]?.[0].update;
    expect(update.expiresAt).toBeInstanceOf(Date);
    expect((update.expiresAt as Date).getTime()).toBeGreaterThan(now.getTime());
  });

  it('reapproves a revoked approval directly', async () => {
    vi.mocked(prisma.oidcLinkingApproval.findUnique).mockResolvedValue({
      id: 'approval-1',
      revokedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    } as never);

    const result = await allowOidcLinking('user-1');

    expect(result).toEqual({ success: true, state: 'approved', renewed: true });
    expect(prisma.oidcLinkingApproval.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          approvedById: 'admin-1',
          revokedAt: null,
          generation: { increment: 1 },
        }),
      })
    );
  });

  it('allows approval for an INVITED user', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'user-invited',
      email: 'invited@example.com',
      status: 'INVITED',
    } as never);

    const result = await allowOidcLinking('user-invited');

    expect(result).toEqual({ success: true, state: 'approved', renewed: false });
    expect(prisma.oidcLinkingApproval.upsert).toHaveBeenCalled();
  });

  it('reports already-linked users without creating provisioning evidence', async () => {
    vi.mocked(prisma.oidcIdentity.findFirst).mockResolvedValue({ id: 'identity-1' } as never);

    const result = await allowOidcLinking('user-1');

    expect(result).toEqual({ success: true, alreadyLinked: true, state: 'linked' });
    expect(prisma.oidcLinkingApproval.findUnique).not.toHaveBeenCalled();
    expect(prisma.oidcLinkingApproval.upsert).not.toHaveBeenCalled();
  });

  it('revokes pending first-link eligibility without changing credentials or status', async () => {
    vi.mocked(prisma.oidcLinkingApproval.findUnique).mockResolvedValue({
      id: 'approval-1',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    } as never);

    const result = await revokeOidcLinking('user-1');

    expect(result).toEqual({ success: true, state: 'revoked' });
    expect(prisma.oidcLinkingApproval.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', revokedAt: null, consumedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(prisma.user.update).toBeUndefined();
  });

  it('does not use revoke approval to unlink an established identity', async () => {
    vi.mocked(prisma.oidcIdentity.findFirst).mockResolvedValue({ id: 'identity-1' } as never);

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
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      status: 'DISABLED',
    } as never);

    const allowResult = await allowOidcLinking('user-1');
    const revokeResult = await revokeOidcLinking('user-1');

    expect(allowResult).toEqual({
      error: 'OIDC linking approval can only be managed for active or invited users.',
    });
    expect(revokeResult).toEqual({
      error: 'OIDC linking approval can only be managed for active or invited users.',
    });
    expect(prisma.oidcLinkingApproval.upsert).not.toHaveBeenCalled();
    expect(prisma.oidcLinkingApproval.updateMany).not.toHaveBeenCalled();
  });
});
