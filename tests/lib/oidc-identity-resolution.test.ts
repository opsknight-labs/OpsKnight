import { beforeEach, describe, expect, it, vi } from 'vitest';

const tx = {
  oidcIdentity: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
  },
  user: {
    findUnique: vi.fn(),
    create: vi.fn(),
  },
  oidcLinkingApproval: {
    findUnique: vi.fn(),
    updateMany: vi.fn(),
  },
};

vi.mock('@/lib/prisma', () => ({
  default: {
    oidcIdentity: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    user: { findUnique: vi.fn() },
  },
}));

vi.mock('@/lib/db-utils', () => ({
  runSerializableTransaction: vi.fn(async (operation: (client: typeof tx) => Promise<unknown>) =>
    operation(tx)
  ),
}));

import prisma from '@/lib/prisma';
import { runSerializableTransaction } from '@/lib/db-utils';
import { resolveOidcIdentityForSignIn } from '@/lib/oidc-identity-resolution';

const linkedUser = {
  id: 'user-1',
  email: 'alice@example.com',
  status: 'ACTIVE',
  role: 'USER',
  roleSource: 'OIDC',
  name: 'Alice',
  department: null,
  jobTitle: null,
  avatarUrl: null,
};

const baseInput = {
  issuer: 'https://idp.example.com',
  subject: 'subject-1',
  email: 'alice@example.com',
  displayName: 'Alice',
  providerType: 'custom',
  emailVerifiedClaim: true,
  requireEmailVerifiedClaim: true,
  autoProvision: true,
  allowedDomains: ['example.com'],
};

describe('resolveOidcIdentityForSignIn', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.oidcIdentity.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.oidcIdentity.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.oidcIdentity.update).mockResolvedValue({} as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    tx.oidcIdentity.findUnique.mockResolvedValue(null);
    tx.oidcIdentity.findFirst.mockResolvedValue(null);
    tx.oidcIdentity.update.mockResolvedValue({} as never);
    tx.oidcIdentity.create.mockResolvedValue({ id: 'identity-1' });
    tx.user.findUnique.mockResolvedValue(null);
    tx.user.create.mockResolvedValue(linkedUser);
    tx.oidcLinkingApproval.findUnique.mockResolvedValue(null);
    tx.oidcLinkingApproval.updateMany.mockResolvedValue({ count: 1 });
  });

  it('authenticates an established issuer+subject identity without an email claim', async () => {
    vi.mocked(prisma.oidcIdentity.findUnique).mockResolvedValue({ userId: 'user-1' } as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue(linkedUser as never);

    const result = await resolveOidcIdentityForSignIn({
      ...baseInput,
      email: null,
      allowedDomains: [],
    });

    expect(result).toEqual({
      ok: true,
      user: linkedUser,
      identityCreated: false,
      userCreated: false,
      approvalConsumed: false,
    });
    expect(runSerializableTransaction).not.toHaveBeenCalled();
  });

  it('keeps an established identity bound when the current email claim changes', async () => {
    vi.mocked(prisma.oidcIdentity.findUnique).mockResolvedValue({ userId: 'user-1' } as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue(linkedUser as never);

    const result = await resolveOidcIdentityForSignIn({
      ...baseInput,
      email: 'renamed@example.com',
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.user.id).toBe('user-1');
    expect(runSerializableTransaction).not.toHaveBeenCalled();
  });

  it('rejects an unknown identity when no usable email exists', async () => {
    const result = await resolveOidcIdentityForSignIn({
      ...baseInput,
      email: null,
      allowedDomains: [],
    });

    expect(result).toEqual({ ok: false, reason: 'OIDC_EMAIL_REQUIRED' });
    expect(runSerializableTransaction).not.toHaveBeenCalled();
  });

  it('uses the signed Google hd claim instead of the email suffix for Workspace access', async () => {
    const result = await resolveOidcIdentityForSignIn({
      ...baseInput,
      issuer: 'https://accounts.google.com',
      claims: { email: 'alice@example.com' },
    });

    expect(result).toEqual({ ok: false, reason: 'OIDC_ORGANIZATION_REJECTED' });
    expect(tx.user.create).not.toHaveBeenCalled();
  });

  it('accepts a Google Workspace identity only when signed hd matches', async () => {
    const result = await resolveOidcIdentityForSignIn({
      ...baseInput,
      issuer: 'https://accounts.google.com',
      email: 'alice@alias.example',
      claims: { hd: 'EXAMPLE.COM' },
    });

    expect(result.ok).toBe(true);
    expect(tx.user.create).toHaveBeenCalled();
  });

  it('rechecks the Google Workspace boundary for an established identity', async () => {
    vi.mocked(prisma.oidcIdentity.findUnique).mockResolvedValue({ userId: 'user-1' } as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue(linkedUser as never);

    const result = await resolveOidcIdentityForSignIn({
      ...baseInput,
      issuer: 'https://accounts.google.com',
      claims: { hd: 'former-company.example' },
    });

    expect(result).toEqual({ ok: false, reason: 'OIDC_ORGANIZATION_REJECTED' });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('rechecks the Auth0 organization boundary for an established identity', async () => {
    vi.mocked(prisma.oidcIdentity.findUnique).mockResolvedValue({ userId: 'user-1' } as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue(linkedUser as never);

    const result = await resolveOidcIdentityForSignIn({
      ...baseInput,
      issuer: 'https://login.company.example',
      providerType: 'auth0',
      organizationId: 'org_current',
      claims: { org_id: 'org_former' },
    });

    expect(result).toEqual({ ok: false, reason: 'OIDC_ORGANIZATION_REJECTED' });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('scopes Entra tenant verification to authority without email-domain authorization restriction', async () => {
    const acceptedOutsideDomain = await resolveOidcIdentityForSignIn({
      ...baseInput,
      issuer: 'https://login.microsoftonline.com/tenant-id/v2.0',
      email: 'alice@outside.example',
      allowedDomains: ['acme.com'],
      emailVerifiedClaim: undefined,
      requireEmailVerifiedClaim: false,
      claims: { tid: 'tenant-id' },
    });
    expect(acceptedOutsideDomain.ok).toBe(true);

    const acceptedNoRestriction = await resolveOidcIdentityForSignIn({
      ...baseInput,
      issuer: 'https://login.microsoftonline.com/tenant-id/v2.0',
      email: 'alice@outside.example',
      allowedDomains: [],
      emailVerifiedClaim: undefined,
      requireEmailVerifiedClaim: false,
      claims: { tid: 'tenant-id' },
    });
    expect(acceptedNoRestriction.ok).toBe(true);
  });

  it('reconciles legacy identities stored with non-canonical issuers (e.g. trailing slashes) to canonical issuer', async () => {
    // Exact canonical match misses, but findFirst finds legacy trailing slash identity
    vi.mocked(prisma.oidcIdentity.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.oidcIdentity.findFirst).mockResolvedValue({
      id: 'legacy-id-1',
      userId: 'user-1',
    } as never);
    vi.mocked(prisma.oidcIdentity.update).mockResolvedValue({} as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue(linkedUser as never);

    const result = await resolveOidcIdentityForSignIn({
      ...baseInput,
      issuer: 'https://idp.example.com',
      subject: 'subject-1',
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.user.id).toBe('user-1');
    expect(prisma.oidcIdentity.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          issuer: { in: expect.arrayContaining(['https://idp.example.com/']) },
          subject: 'subject-1',
        }),
      })
    );
    expect(prisma.oidcIdentity.update).toHaveBeenCalledWith({
      where: { id: 'legacy-id-1' },
      data: { issuer: 'https://idp.example.com' },
    });
  });

  it('rejects an established identity whose linked OpsKnight user is disabled', async () => {
    vi.mocked(prisma.oidcIdentity.findUnique).mockResolvedValue({ userId: 'user-1' } as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      ...linkedUser,
      status: 'DISABLED',
    } as never);

    const result = await resolveOidcIdentityForSignIn(baseInput);

    expect(result).toEqual({ ok: false, reason: 'OIDC_TARGET_NOT_OPERATIONAL' });
  });

  it('does not let a new subject inherit an existing account from email alone', async () => {
    tx.user.findUnique.mockResolvedValue(linkedUser);
    tx.oidcLinkingApproval.findUnique.mockResolvedValue(null);

    const result = await resolveOidcIdentityForSignIn(baseInput);

    expect(result).toEqual({ ok: false, reason: 'OIDC_LINK_NOT_APPROVED' });
    expect(tx.oidcIdentity.create).not.toHaveBeenCalled();
  });

  it('binds an existing email account exactly once with a usable admin approval', async () => {
    const now = new Date('2026-09-10T12:00:00.000Z');
    tx.user.findUnique.mockResolvedValue(linkedUser);
    tx.oidcLinkingApproval.findUnique.mockResolvedValue({
      id: 'approval-1',
      generation: 4,
      revokedAt: null,
      expiresAt: new Date('2026-09-11T12:00:00.000Z'),
    });

    const result = await resolveOidcIdentityForSignIn(baseInput, now);

    expect(result).toEqual({
      ok: true,
      user: linkedUser,
      identityCreated: true,
      userCreated: false,
      approvalConsumed: true,
    });
    expect(tx.oidcLinkingApproval.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'approval-1',
        generation: 4,
        revokedAt: null,
        consumedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      data: { consumedAt: now },
    });
    expect(tx.oidcIdentity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        issuer: baseInput.issuer,
        subject: baseInput.subject,
        email: baseInput.email,
        userId: 'user-1',
      }),
    });
  });

  it('rejects an approval that expires before the callback consumes it', async () => {
    const now = new Date('2026-09-10T12:00:00.000Z');
    tx.user.findUnique.mockResolvedValue(linkedUser);
    tx.oidcLinkingApproval.findUnique.mockResolvedValue({
      id: 'approval-1',
      generation: 4,
      revokedAt: null,
      expiresAt: new Date('2026-09-10T11:59:59.999Z'),
    });

    const result = await resolveOidcIdentityForSignIn(baseInput, now);

    expect(result).toEqual({ ok: false, reason: 'OIDC_LINK_APPROVAL_EXPIRED' });
    expect(tx.oidcIdentity.create).not.toHaveBeenCalled();
  });

  it('rejects when approval generation is consumed or changed concurrently', async () => {
    tx.user.findUnique.mockResolvedValue(linkedUser);
    tx.oidcLinkingApproval.findUnique.mockResolvedValue({
      id: 'approval-1',
      generation: 4,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    });
    tx.oidcLinkingApproval.updateMany.mockResolvedValue({ count: 0 });

    const result = await resolveOidcIdentityForSignIn(baseInput);

    expect(result).toEqual({ ok: false, reason: 'OIDC_LINK_NOT_APPROVED' });
    expect(tx.oidcIdentity.create).not.toHaveBeenCalled();
  });

  it('rejects an approval issued for a different provider trust configuration', async () => {
    tx.user.findUnique.mockResolvedValue(linkedUser);
    tx.oidcLinkingApproval.findUnique.mockResolvedValue({
      id: 'approval-1',
      generation: 1,
      revokedAt: null,
      consumedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      providerConfigId: 'different-provider',
      issuerFingerprint: null,
      expectedEmail: 'alice@example.com',
      configVersion: 1,
    });

    const result = await resolveOidcIdentityForSignIn({
      ...baseInput,
      providerConfigId: 'default',
      clientId: 'client-id',
      configVersion: 1,
    });

    expect(result).toEqual({ ok: false, reason: 'OIDC_LINK_NOT_APPROVED' });
    expect(tx.oidcIdentity.create).not.toHaveBeenCalled();
  });

  it('lets an identity that appears between the fast path and transaction win safely', async () => {
    tx.oidcIdentity.findUnique.mockResolvedValue({ userId: 'user-1' });
    tx.user.findUnique.mockResolvedValue(linkedUser);

    const result = await resolveOidcIdentityForSignIn(baseInput);

    expect(result).toEqual({
      ok: true,
      user: linkedUser,
      identityCreated: false,
      userCreated: false,
      approvalConsumed: false,
    });
    expect(tx.user.create).not.toHaveBeenCalled();
    expect(tx.oidcIdentity.create).not.toHaveBeenCalled();
  });

  it('creates a JIT user and identity inside the same serializable transaction', async () => {
    tx.user.findUnique.mockResolvedValue(null);
    tx.user.create.mockResolvedValue(linkedUser);

    const result = await resolveOidcIdentityForSignIn(baseInput);

    expect(result).toEqual({
      ok: true,
      user: linkedUser,
      identityCreated: true,
      userCreated: true,
      approvalConsumed: false,
    });
    expect(runSerializableTransaction).toHaveBeenCalledTimes(1);
    expect(tx.user.create).toHaveBeenCalledTimes(1);
    expect(tx.oidcIdentity.create).toHaveBeenCalledTimes(1);
  });

  it('never performs JIT user creation outside the transaction client', async () => {
    tx.user.findUnique.mockResolvedValue(null);
    await resolveOidcIdentityForSignIn(baseInput);

    expect((prisma.user as { create?: unknown }).create).toBeUndefined();
    expect(tx.user.create).toHaveBeenCalled();
  });

  it('requires strict email verification only when creating a new binding', async () => {
    const result = await resolveOidcIdentityForSignIn({
      ...baseInput,
      emailVerifiedClaim: undefined,
      requireEmailVerifiedClaim: true,
    });

    expect(result).toEqual({ ok: false, reason: 'OIDC_EMAIL_ASSURANCE_REQUIRED' });
    expect(tx.user.create).not.toHaveBeenCalled();
  });
});
