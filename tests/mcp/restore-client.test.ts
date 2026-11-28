import { beforeEach, describe, expect, it, vi } from 'vitest';

const tx = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  user: { findUnique: vi.fn() },
  mcpClient: { updateMany: vi.fn(), count: vi.fn() },
  mcpGrant: { updateMany: vi.fn() },
}));
const logAudit = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({
  default: { $transaction: (fn: (client: typeof tx) => unknown) => fn(tx) },
}));
vi.mock('@/lib/audit', () => ({ logAudit }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('@/lib/rbac', () => ({
  getCurrentUser: vi.fn().mockResolvedValue({ id: 'admin-1', tokenVersion: 3 }),
  getUserPermissions: vi.fn().mockResolvedValue({ id: 'admin-1', capabilities: ['admin.manage'] }),
}));
vi.mock('@/lib/mcp/auth/fresh-admin', () => ({
  requireFreshMcpAdmin: vi.fn().mockResolvedValue(true),
}));

import { restoreMcpClient } from '@/app/(app)/settings/integrations/mcp/actions';

function form(id: string) {
  const data = new FormData();
  data.set('id', id);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  tx.user.findUnique.mockResolvedValue({ role: 'ADMIN', status: 'ACTIVE', tokenVersion: 3 });
  tx.mcpGrant.updateMany.mockResolvedValue({ count: 2 });
});

describe('restoreMcpClient', () => {
  it('revokes the grants left from before and audits when it restores a revoked client', async () => {
    tx.mcpClient.updateMany.mockResolvedValue({ count: 1 });

    await expect(restoreMcpClient(form('client-1'))).resolves.toEqual({
      ok: true,
      clientId: 'client-1',
    });

    expect(tx.mcpClient.updateMany).toHaveBeenCalledWith({
      where: { id: 'client-1', revokedAt: { not: null } },
      data: { revokedAt: null },
    });
    expect(tx.mcpGrant.updateMany).toHaveBeenCalledTimes(1);
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'mcp.client.restored', entityId: 'client-1' }),
      tx
    );
  });

  it('revokes nothing and writes no audit row when the client is already active', async () => {
    tx.mcpClient.updateMany.mockResolvedValue({ count: 0 });
    tx.mcpClient.count.mockResolvedValue(1);

    await expect(restoreMcpClient(form('client-1'))).resolves.toEqual({
      ok: true,
      clientId: 'client-1',
    });

    expect(tx.mcpGrant.updateMany).not.toHaveBeenCalled();
    expect(logAudit).not.toHaveBeenCalled();
  });

  it('still reports an unknown client as not found', async () => {
    tx.mcpClient.updateMany.mockResolvedValue({ count: 0 });
    tx.mcpClient.count.mockResolvedValue(0);

    await expect(restoreMcpClient(form('missing'))).resolves.toEqual({
      ok: false,
      code: 'MCP_CLIENT_NOT_FOUND',
    });
    expect(tx.mcpGrant.updateMany).not.toHaveBeenCalled();
  });
});
