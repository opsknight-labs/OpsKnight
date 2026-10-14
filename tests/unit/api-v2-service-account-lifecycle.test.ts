/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import prisma from '@/lib/prisma';

const auditMocks = vi.hoisted(() => ({ logAudit: vi.fn() }));
vi.mock('@/lib/audit', () => ({ logAudit: auditMocks.logAudit }));

import { issueServiceAccountToken, listServiceAccounts } from '@/lib/api-v2/service-accounts';
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
  const tx = { user: { findUnique: vi.fn() }, apiKey: { create: vi.fn() } } as any;

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

  it('counts only unexpired tokens as active', async () => {
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

    const [listed] = await listServiceAccounts();
    expect(listed.activeTokensCount).toBe(2);
    expect(listed.tokens).toHaveLength(3);
  });
});
