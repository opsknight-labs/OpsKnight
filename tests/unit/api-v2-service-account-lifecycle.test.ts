/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import prisma from '@/lib/prisma';

const auditMocks = vi.hoisted(() => ({ logAudit: vi.fn() }));
vi.mock('@/lib/audit', () => ({ logAudit: auditMocks.logAudit }));

import {
  createServiceAccount,
  issueServiceAccountToken,
  listServiceAccounts,
  revokeServiceAccountToken,
  SERVICE_ACCOUNT_TOKEN_PREVIEW,
} from '@/lib/api-v2/service-accounts';
import { SERVICE_ACCOUNT_DOMAIN } from '@/lib/service-account-identity';

const account = (status: string) => ({
  id: 'sa_1',
  name: 'CI',
  email: `sa_1@${SERVICE_ACCOUNT_DOMAIN}`,
  role: 'RESPONDER',
  status,
  department: null,
  jobTitle: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  teamMemberships: [],
  apiKeys: [],
});

describe('service account token lifecycle', () => {
  const tx = {
    user: { findUnique: vi.fn() },
    apiKey: { create: vi.fn(), updateMany: vi.fn() },
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    auditMocks.logAudit.mockResolvedValue(undefined);
    vi.mocked(prisma.$transaction as any).mockImplementation(async (fn: any) => fn(tx));
  });

  const input = {
    serviceAccountId: 'sa_1',
    name: 'deploy',
    scopes: ['incidents:read'],
    expiresInDays: 30,
    actorId: 'admin_1',
  };

  it('revokes a live token once, then treats a retried revoke as a no-op', async () => {
    const key = { id: 'tok_1', name: 'deploy', prefix: 'ok_', tokenHash: 'h', revokedAt: null };
    vi.mocked(prisma.apiKey.findFirst as any).mockResolvedValueOnce(key);
    tx.apiKey.updateMany.mockResolvedValue({ count: 1 });
    await expect(revokeServiceAccountToken('sa_1', 'tok_1', 'admin_1')).resolves.toEqual({
      success: true,
    });
    expect(tx.apiKey.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'tok_1', revokedAt: null } })
    );
    expect(auditMocks.logAudit).toHaveBeenCalledTimes(1);

    vi.mocked(prisma.apiKey.findFirst as any).mockResolvedValueOnce({
      ...key,
      revokedAt: new Date('2026-01-01T00:00:00Z'),
    });
    await expect(revokeServiceAccountToken('sa_1', 'tok_1', 'admin_1')).resolves.toEqual({
      success: true,
    });
    expect(tx.apiKey.updateMany).toHaveBeenCalledTimes(1);
    expect(auditMocks.logAudit).toHaveBeenCalledTimes(1);
  });

  it('refuses to issue a token for a disabled service account, generating no secret', async () => {
    vi.mocked(prisma.user.findUnique as any).mockResolvedValue(account('DISABLED'));

    await expect(issueServiceAccountToken(input)).rejects.toMatchObject({
      code: 'SERVICE_ACCOUNT_DISABLED',
      status: 409,
    });
    expect(tx.apiKey.create).not.toHaveBeenCalled();
  });

  it('re-checks status inside the transaction, so a disable racing the issue still wins', async () => {
    vi.mocked(prisma.user.findUnique as any).mockResolvedValue(account('ACTIVE'));
    tx.user.findUnique.mockResolvedValue({ status: 'DISABLED' });

    await expect(issueServiceAccountToken(input)).rejects.toMatchObject({
      code: 'SERVICE_ACCOUNT_DISABLED',
    });
    expect(tx.apiKey.create).not.toHaveBeenCalled();
  });

  it('issues a token for an active account', async () => {
    vi.mocked(prisma.user.findUnique as any).mockResolvedValue(account('ACTIVE'));
    tx.user.findUnique.mockResolvedValue({ status: 'ACTIVE' });
    tx.apiKey.create.mockResolvedValue({
      id: 'key_1',
      name: 'deploy',
      prefix: 'ok_test_abcd',
      scopes: ['incidents:read'],
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 86_400_000),
    });

    const result = await issueServiceAccountToken(input);
    expect(tx.apiKey.create).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).toContain('ok_');
  });

  it('takes token counts from database aggregates and bounds the nested list', async () => {
    const day = 86_400_000;
    vi.mocked(prisma.user.findMany as any).mockResolvedValue([
      {
        ...account('ACTIVE'),
        apiKeys: [
          { id: 'a', expiresAt: null },
          { id: 'b', expiresAt: new Date(Date.now() + day) },
          { id: 'c', expiresAt: new Date(Date.now() - day) },
        ],
      },
    ]);
    (prisma.apiKey as any).groupBy = vi
      .fn()
      .mockResolvedValueOnce([{ userId: 'sa_1', _count: { _all: 4000 } }]) // non-revoked
      .mockResolvedValueOnce([{ userId: 'sa_1', _count: { _all: 2 } }]); // active

    const [listed] = await listServiceAccounts();
    expect(listed.activeTokensCount).toBe(2);
    expect(listed.tokensTotal).toBe(4000);
    expect(listed.tokensTruncated).toBe(true);
    expect(listed.tokens.map((t: { status: string }) => t.status)).toEqual([
      'ACTIVE',
      'ACTIVE',
      'EXPIRED',
    ]);
    // The query itself is bounded and ordered, not unbounded.
    expect(vi.mocked(prisma.user.findMany as any).mock.calls[0][0].select.apiKeys).toMatchObject({
      take: SERVICE_ACCOUNT_TOKEN_PREVIEW,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  });
});

it('persists the readable production identity when creating a service account', async () => {
  const create = vi.fn(async () => ({ ...account('ACTIVE'), name: 'Production Deploy' }));
  const tx = { user: { create } };
  await createServiceAccount({
    name: '  Production Deploy  ',
    role: 'RESPONDER',
    actorId: 'admin_1',
    tx: tx as unknown as import('@prisma/client').Prisma.TransactionClient,
  });
  expect(create).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        name: 'Production Deploy',
        email: expect.stringMatching(
          /^sa-production-deploy-[a-f0-9]{24}@serviceaccount\.opsknight\.local$/
        ),
      }),
    })
  );
});

describe('administrator service accounts need the console', () => {
  const adminAccount = { ...account('ACTIVE'), role: 'ADMIN' };
  const tokenInput = {
    serviceAccountId: 'sa_1',
    name: 'deploy',
    scopes: ['incidents:read'],
    actorId: 'admin_1',
  };

  it('refuses an API caller creating an ADMIN service account', async () => {
    await expect(
      createServiceAccount({ name: 'root bot', role: 'ADMIN', actorId: 'admin_1' })
    ).rejects.toMatchObject({ code: 'INVALID_SERVICE_ACCOUNT_ROLE' });
  });

  it('allows the console to create an ADMIN service account', async () => {
    const create = vi.fn(async () => ({ ...adminAccount, name: 'root bot' }));
    await createServiceAccount({
      name: 'root bot',
      role: 'ADMIN',
      actorId: 'admin_1',
      consoleSession: true,
      tx: { user: { create } } as unknown as import('@prisma/client').Prisma.TransactionClient,
    });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('refuses an API caller minting a non-expiring token for an ADMIN account', async () => {
    vi.mocked(prisma.user.findUnique as any).mockResolvedValue(adminAccount);
    await expect(
      issueServiceAccountToken({ ...tokenInput, neverExpires: true })
    ).rejects.toMatchObject({ code: 'INVALID_TOKEN_EXPIRY' });
  });

  it('still lets an API caller mint an expiring ADMIN token and a non-expiring non-admin one', async () => {
    const tx = {
      user: { findUnique: vi.fn().mockResolvedValue({ status: 'ACTIVE' }) },
      apiKey: {
        create: vi.fn().mockResolvedValue({
          id: 'key_1',
          name: 'deploy',
          prefix: 'ok_test_abcd',
          scopes: ['incidents:read'],
          createdAt: new Date(),
          expiresAt: null,
        }),
      },
    } as any;
    vi.mocked(prisma.$transaction as any).mockImplementation(async (fn: any) => fn(tx));
    vi.mocked(prisma.user.findUnique as any).mockResolvedValue(adminAccount);
    await issueServiceAccountToken({ ...tokenInput, expiresInDays: 30 });
    vi.mocked(prisma.user.findUnique as any).mockResolvedValue(account('ACTIVE'));
    await issueServiceAccountToken({ ...tokenInput, neverExpires: true });
    expect(tx.apiKey.create).toHaveBeenCalledTimes(2);
  });

  it('lets the console mint a non-expiring ADMIN token', async () => {
    const tx = {
      user: { findUnique: vi.fn().mockResolvedValue({ status: 'ACTIVE' }) },
      apiKey: {
        create: vi.fn().mockResolvedValue({
          id: 'key_1',
          name: 'deploy',
          prefix: 'ok_test_abcd',
          scopes: ['incidents:read'],
          createdAt: new Date(),
          expiresAt: null,
        }),
      },
    } as any;
    vi.mocked(prisma.$transaction as any).mockImplementation(async (fn: any) => fn(tx));
    vi.mocked(prisma.user.findUnique as any).mockResolvedValue(adminAccount);
    await issueServiceAccountToken({ ...tokenInput, neverExpires: true, consoleSession: true });
    expect(tx.apiKey.create).toHaveBeenCalledTimes(1);
  });
});
