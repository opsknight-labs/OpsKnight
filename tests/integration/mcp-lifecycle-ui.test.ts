// @vitest-environment node
import { randomBytes } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestUser, resetDatabase, testPrisma as db } from '../helpers/test-db';
import { MCP_PAT_CLIENT_ID } from '@/lib/mcp/auth/effective-access';
import type { McpViewer } from '@/app/(app)/settings/integrations/mcp/queries';

const actor = vi.hoisted(() => ({ id: '', capabilities: ['admin.manage'] as string[] }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/rbac', () => ({
  getUserPermissions: vi.fn(async () => ({ id: actor.id, capabilities: actor.capabilities })),
  getCurrentUser: vi.fn(async () => ({ id: actor.id, tokenVersion: 0 })),
}));

beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (!url.pathname.endsWith('_test') || !['localhost', '127.0.0.1'].includes(url.hostname))
    throw new Error('Owned local test database required');
  process.env.MCP_PUBLIC_ORIGIN = 'http://localhost:3000';
  process.env.ENCRYPTION_KEY = randomBytes(32).toString('hex');
  await resetDatabase();
}, 60000);

beforeEach(async () => {
  await db.mcpGrant.deleteMany();
  await db.mcpClient.deleteMany();
  await db.mcpPolicy.upsert({
    where: { id: 'default' },
    create: { enabled: true, cimdEnabled: true, cimdAllowedHosts: ['claude.ai'] },
    update: { enabled: true, cimdEnabled: true, cimdAllowedHosts: ['claude.ai'] },
  });
});

const viewerOf = (id: string, isAdmin: boolean) =>
  ({
    id,
    isAdmin,
    canApproveRunbooks: isAdmin,
    readsAllTargets: isAdmin,
    timeZone: 'UTC',
  }) as unknown as McpViewer;

async function grantFor(userId: string, clientId: string, kind: 'OAUTH' | 'PAT' = 'OAUTH') {
  return db.mcpGrant.create({
    data: {
      clientId,
      userId,
      userTokenVersion: 0,
      scopes: ['incidents:read'],
      resource: 'http://localhost:3000/mcp',
      expiresAt: new Date(Date.now() + 3_600_000),
      kind,
    },
  });
}

describe('assistant detail query', () => {
  it('returns one assistant with its trust, and nothing for the personal-token client or unknown ids', async () => {
    const { getMcpClient } = await import('@/app/(app)/settings/integrations/mcp/queries');
    const trusted = await db.mcpClient.create({
      data: {
        id: 'https://claude.ai/oauth/metadata.json',
        name: 'Claude',
        scopes: ['incidents:read'],
        redirectUris: [],
        metadataUrl: 'https://claude.ai/oauth/metadata.json',
        firstAuthorizedAt: new Date('2026-11-01T00:00:00Z'),
      },
    });
    const untrusted = await db.mcpClient.create({
      data: {
        id: 'https://evil.example/m.json',
        name: 'Other',
        scopes: ['incidents:read'],
        redirectUris: [],
        metadataUrl: 'https://evil.example/m.json',
      },
    });
    await db.mcpClient.upsert({
      where: { id: MCP_PAT_CLIENT_ID },
      create: {
        id: MCP_PAT_CLIENT_ID,
        name: 'Personal access tokens',
        scopes: [],
        redirectUris: [],
      },
      update: {},
    });
    const admin = viewerOf('a', true);

    const one = await getMcpClient(admin, trusted.id);
    expect(one).toMatchObject({
      id: trusted.id,
      metadataHost: 'claude.ai',
      trusted: true,
      blockedReason: null,
      firstAuthorizedAt: new Date('2026-11-01T00:00:00Z'),
    });
    expect(await getMcpClient(admin, untrusted.id)).toMatchObject({
      trusted: false,
      blockedReason: 'client_untrusted',
    });
    expect(await getMcpClient(admin, MCP_PAT_CLIENT_ID)).toBeNull();
    expect(await getMcpClient(admin, 'nope')).toBeNull();
    await expect(getMcpClient(viewerOf('u', false), trusted.id)).rejects.toThrow(
      'MCP_ADMIN_REQUIRED'
    );
  });
});

describe("one person's connections", () => {
  it('filters the connections list to one person, administrators only', async () => {
    const { listMcpGrants } = await import('@/app/(app)/settings/integrations/mcp/queries');
    const jane = await createTestUser({ role: 'USER' });
    const bob = await createTestUser({ role: 'USER' });
    const client = await db.mcpClient.create({
      data: { name: 'Claude', scopes: ['incidents:read'], redirectUris: ['http://localhost/cb'] },
    });
    await grantFor(jane.id, client.id);
    await grantFor(bob.id, client.id);
    const input = { status: 'all' as const, q: '', clientId: null, page: 1, userId: jane.id };
    const result = await listMcpGrants(viewerOf('a', true), input);
    expect(result.rows.map(row => row.user.id)).toEqual([jane.id]);
    expect(result.counts.all).toBe(1);
    await expect(listMcpGrants(viewerOf(bob.id, false), input)).rejects.toThrow(
      'MCP_ADMIN_REQUIRED'
    );
  });

  it("disconnects all of one person's assistants and tokens, audited, and nobody else's", async () => {
    const { revokeMcpConnectionsForUser } =
      await import('@/app/(app)/settings/integrations/mcp/actions');
    const admin = await createTestUser({ role: 'ADMIN' });
    const jane = await createTestUser({ role: 'USER' });
    const bob = await createTestUser({ role: 'USER' });
    const client = await db.mcpClient.create({
      data: { name: 'Claude', scopes: ['incidents:read'], redirectUris: ['http://localhost/cb'] },
    });
    await db.mcpClient.upsert({
      where: { id: MCP_PAT_CLIENT_ID },
      create: {
        id: MCP_PAT_CLIENT_ID,
        name: 'Personal access tokens',
        scopes: [],
        redirectUris: [],
      },
      update: {},
    });
    await grantFor(jane.id, client.id);
    await grantFor(jane.id, MCP_PAT_CLIENT_ID, 'PAT');
    await grantFor(bob.id, client.id);
    const form = (fields: Record<string, string>) => {
      const data = new FormData();
      for (const [key, value] of Object.entries(fields)) data.append(key, value);
      return data;
    };

    // Not an administrator.
    actor.id = bob.id;
    actor.capabilities = [];
    await expect(
      revokeMcpConnectionsForUser(form({ userId: jane.id, confirm: 'on' }))
    ).rejects.toThrow('MCP_ADMIN_REQUIRED');

    actor.id = admin.id;
    actor.capabilities = ['admin.manage'];
    // Confirmation is required, and nothing extra may ride along.
    await expect(revokeMcpConnectionsForUser(form({ userId: jane.id }))).rejects.toThrow(
      'MCP_CONFIRMATION_REQUIRED'
    );
    await expect(
      revokeMcpConnectionsForUser(form({ userId: jane.id, confirm: 'on', extra: 'x' }))
    ).rejects.toThrow('MCP_CONFIRMATION_REQUIRED');

    await revokeMcpConnectionsForUser(form({ userId: jane.id, confirm: 'on' }));
    const live = (userId: string) => db.mcpGrant.count({ where: { userId, revokedAt: null } });
    expect(await live(jane.id)).toBe(0);
    expect(await live(bob.id)).toBe(1);
    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: 'mcp.grants.revoked_for_user', actorId: admin.id },
    });
    expect(audit).toMatchObject({ entityType: 'USER', entityId: jane.id });
    expect(audit.details).toMatchObject({ metadata: { revokedGrants: 2 } });
  });
});

describe('assistant recent activity', () => {
  it("lists one assistant's latest requests, newest first, for administrators", async () => {
    const { listMcpClientRecentCalls } =
      await import('@/app/(app)/settings/integrations/mcp/activity');
    const jane = await createTestUser({ role: 'USER' });
    const client = await db.mcpClient.create({
      data: { name: 'Claude', scopes: ['incidents:read'], redirectUris: ['http://localhost/cb'] },
    });
    const grant = await grantFor(jane.id, client.id);
    await db.mcpCallLog.createMany({
      data: [1, 2, 3].map(minutes => ({
        grantId: grant.id,
        clientId: minutes === 3 ? 'other' : client.id,
        userId: jane.id,
        tool: `tool_${minutes}`,
        outcome: 'served',
        durationMs: 5,
        requestId: `r${minutes}`,
        at: new Date(Date.now() - minutes * 60_000),
      })),
    });
    const calls = await listMcpClientRecentCalls(viewerOf('a', true), client.id);
    expect(calls.map(call => call.tool)).toEqual(['tool_1', 'tool_2']);
    await expect(listMcpClientRecentCalls(viewerOf('u', false), client.id)).rejects.toThrow(
      'MCP_ADMIN_REQUIRED'
    );
  });
});
