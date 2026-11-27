import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';

vi.mock('@/lib/mcp/auth/config', () => ({
  digestMcpSecret: (value: string) => `digest:${value}`,
  mcpResource: () => 'https://ops.example/mcp',
}));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));

import { createMcpOAuthModel } from '@/lib/mcp/auth/oauth-model';

const NOW = new Date('2026-11-27T12:00:00.000Z');

const db = {
  mcpToken: { findUnique: vi.fn(), updateMany: vi.fn() },
  mcpPolicy: { findUnique: vi.fn() },
  mcpGrant: { findUnique: vi.fn() },
  mcpClient: { findUnique: vi.fn() },
  user: { findUnique: vi.fn() },
};

function replayedToken(rotatedSecondsAgo: number) {
  return {
    id: 'token-1',
    grantId: 'grant-1',
    rotatedAt: new Date(NOW.getTime() - rotatedSecondsAgo * 1000),
    successorId: 'token-2',
    refreshExpiresAt: new Date(NOW.getTime() + 86_400_000),
    scopes: ['incidents:read'],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  db.mcpPolicy.findUnique.mockResolvedValue({ refreshReuseGraceSeconds: 30 });
  db.mcpGrant.findUnique.mockResolvedValue({
    id: 'grant-1',
    userId: 'user-1',
    clientId: 'client-1',
    kind: 'OAUTH',
    revokedAt: null,
    expiresAt: new Date(NOW.getTime() + 86_400_000),
    resource: 'https://ops.example/mcp',
    userRevocationVersion: 0,
    client: { revokedAt: null },
  });
  db.user.findUnique.mockResolvedValue({ status: 'ACTIVE', mcpRevocationVersion: 0 });
  db.mcpClient.findUnique.mockResolvedValue({
    id: 'client-1',
    redirectUris: [],
    scopes: ['incidents:read'],
    metadataUrl: null,
    dynamicRegistration: false,
    revokedAt: null,
  });
});

function model(onReuse = vi.fn()) {
  return {
    onReuse,
    model: createMcpOAuthModel(db as unknown as Prisma.TransactionClient, onReuse),
  };
}

describe('refresh token replay inside the grace window', () => {
  it('accepts the previous token again even though its successor was already used, without revoking the grant', async () => {
    db.mcpToken.findUnique.mockResolvedValue(replayedToken(5));
    db.mcpToken.updateMany.mockResolvedValue({ count: 1 });
    const { model: oauth, onReuse } = model();

    const result = await oauth.getRefreshToken('old-refresh-token');

    expect(result).toMatchObject({
      user: { grantId: 'grant-1', replacedTokenIds: ['token-1', 'token-2'], graceReplay: true },
    });
    expect(onReuse).not.toHaveBeenCalled();
    // The successor is withdrawn whether or not its access token was already used.
    expect(db.mcpToken.updateMany).toHaveBeenCalledWith({
      where: { id: 'token-2', grantId: 'grant-1', rotatedAt: null },
      data: { rotatedAt: NOW },
    });
  });

  it('still treats a replay after the window as theft and revokes the grant', async () => {
    db.mcpToken.findUnique.mockResolvedValue(replayedToken(31));
    const { model: oauth, onReuse } = model();

    await expect(oauth.getRefreshToken('old-refresh-token')).resolves.toBe(false);

    expect(onReuse).toHaveBeenCalledWith('grant-1');
    expect(db.mcpToken.updateMany).not.toHaveBeenCalled();
  });

  it('still treats a replay as theft when the successor was already withdrawn', async () => {
    db.mcpToken.findUnique.mockResolvedValue(replayedToken(5));
    db.mcpToken.updateMany.mockResolvedValue({ count: 0 });
    const { model: oauth, onReuse } = model();

    await expect(oauth.getRefreshToken('old-refresh-token')).resolves.toBe(false);

    expect(onReuse).toHaveBeenCalledWith('grant-1');
  });
});
