import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestUser, resetDatabase, testPrisma as db } from '../helpers/test-db';

const actor = vi.hoisted(() => ({ id: '', isAdmin: true, authenticated: true }));
vi.mock('@/lib/rbac', () => ({
  getUserPermissions: vi.fn(async () => ({
    id: actor.id,
    isAdmin: actor.isAdmin,
    authenticated: actor.authenticated,
    capabilities: actor.isAdmin ? ['admin.manage'] : [],
  })),
  getCurrentUser: vi.fn(async () => ({ id: actor.id, tokenVersion: 0, timeZone: 'UTC' })),
}));

const {
  countActiveConnections,
  countPendingApprovals,
  listMcpApprovals,
  listMcpClients,
  listMcpGrants,
  loadMcpViewer,
} = await import('@/app/(app)/settings/integrations/mcp/queries');

const now = new Date('2026-10-31T12:00:00Z');
const day = 24 * 3600_000;
let admin: { id: string };
let jane: { id: string };
let sam: { id: string };
let claude: { id: string };
let cursor: { id: string };

beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (!url.pathname.endsWith('_test') || !['localhost', '127.0.0.1'].includes(url.hostname))
    throw new Error('Owned local test database required');
  await resetDatabase();
}, 60000);

afterAll(async () => {
  await db.mcpOperationApproval.deleteMany();
  await db.mcpGrant.deleteMany();
  await db.mcpClient.deleteMany();
});

beforeEach(async () => {
  actor.isAdmin = true;
  actor.authenticated = true;
  await db.mcpOperationApproval.deleteMany();
  await db.mcpGrant.deleteMany();
  await db.mcpClient.deleteMany();
  admin = await createTestUser({ name: 'Ada Admin', role: 'ADMIN' });
  jane = await createTestUser({ name: 'Jane Doe', email: `jane-${Date.now()}@example.com` });
  sam = await createTestUser({ name: 'Sam Lee' });
  actor.id = admin.id;
  claude = await db.mcpClient.create({
    data: {
      name: 'Claude',
      redirectUris: [],
      scopes: ['incidents:read'],
      dynamicRegistration: true,
    },
  });
  cursor = await db.mcpClient.create({
    data: { name: 'Cursor', redirectUris: [], scopes: ['incidents:read'] },
  });
  await db.mcpClient.create({
    data: {
      // Metadata-document clients are identified by their document URL.
      id: 'https://chatgpt.com/client.json',
      name: 'ChatGPT',
      redirectUris: [],
      scopes: ['incidents:read'],
      metadataUrl: 'https://chatgpt.com/client.json',
      revokedAt: now,
    },
  });
  const grant = (
    userId: string,
    clientId: string,
    index: number,
    extra: { revokedAt?: Date; expiresAt?: Date } = {}
  ) => ({
    userId,
    clientId,
    userTokenVersion: 0,
    scopes: ['incidents:read'],
    resource: 'https://ops.example.test/mcp',
    createdAt: new Date(now.getTime() - index * 60_000),
    expiresAt: extra.expiresAt ?? new Date(now.getTime() + 10 * day),
    revokedAt: extra.revokedAt ?? null,
    lastUsedAt: index === 0 ? new Date(now.getTime() - 3600_000) : null,
  });
  // 23 active grants for Jane through Claude, so the list spans two pages.
  await db.mcpGrant.createMany({
    data: Array.from({ length: 23 }, (_, index) => grant(jane.id, claude.id, index)),
  });
  await db.mcpGrant.createMany({
    data: [
      grant(sam.id, cursor.id, 30),
      grant(sam.id, cursor.id, 31, { revokedAt: now }),
      grant(sam.id, claude.id, 32, { expiresAt: new Date(now.getTime() - day) }),
    ],
  });
});

describe('MCP settings list queries', () => {
  it('requires a signed-in viewer before any query can run', async () => {
    actor.authenticated = false;
    await expect(loadMcpViewer()).rejects.toThrow('MCP_LOGIN_REQUIRED');
  });

  it('pages connections server-side with names, emails and status counts', async () => {
    const viewer = await loadMcpViewer();
    const first = await listMcpGrants(
      viewer,
      { status: 'active', q: '', clientId: null, page: 1 },
      now
    );
    expect(first.total).toBe(24);
    expect(first.rows).toHaveLength(20);
    expect(first.counts).toEqual({ active: 24, expired: 1, revoked: 1, all: 26 });
    // Newest first, with people resolved rather than raw ids.
    expect(first.rows[0]).toMatchObject({
      status: 'active',
      user: { name: 'Jane Doe' },
      client: { name: 'Claude', type: 'automatic' },
    });
    const second = await listMcpGrants(
      viewer,
      { status: 'active', q: '', clientId: null, page: 2 },
      now
    );
    expect(second.rows).toHaveLength(4);
    expect(new Set([...first.rows, ...second.rows].map(row => row.id)).size).toBe(24);
    expect(await countActiveConnections(viewer, now)).toBe(24);
  });

  it('filters connections by status, person, assistant and client', async () => {
    const viewer = await loadMcpViewer();
    const list = (input: Partial<Parameters<typeof listMcpGrants>[1]>) =>
      listMcpGrants(viewer, { status: 'all', q: '', clientId: null, page: 1, ...input }, now);
    expect((await list({ status: 'revoked' })).rows.map(row => row.status)).toEqual(['revoked']);
    expect((await list({ status: 'expired' })).rows.map(row => row.status)).toEqual(['expired']);
    expect((await list({ q: 'sam lee' })).total).toBe(3);
    expect((await list({ q: 'cursor' })).total).toBe(2);
    const byClient = await list({ clientId: cursor.id });
    expect(byClient.total).toBe(2);
    expect(byClient.client).toEqual({ id: cursor.id, name: 'Cursor' });
  });

  it('limits everyone else to their own connections and blocks admin lists', async () => {
    actor.id = sam.id;
    actor.isAdmin = false;
    const viewer = await loadMcpViewer();
    const own = await listMcpGrants(viewer, { status: 'all', q: '', clientId: null, page: 1 }, now);
    expect(own.total).toBe(3);
    expect(own.rows.every(row => row.user.id === sam.id)).toBe(true);
    // Searching by another person's name never reveals their connections.
    expect(
      (await listMcpGrants(viewer, { status: 'all', q: 'Jane', clientId: null, page: 1 }, now))
        .total
    ).toBe(0);
    expect(await countActiveConnections(viewer, now)).toBe(1);
    await expect(
      listMcpGrants(viewer, { status: 'all', q: '', clientId: claude.id, page: 1 }, now)
    ).rejects.toThrow('MCP_ADMIN_REQUIRED');
    await expect(
      listMcpClients(viewer, { status: 'all', type: 'all', q: '', page: 1 }, now)
    ).rejects.toThrow('MCP_ADMIN_REQUIRED');
    await expect(
      listMcpApprovals(viewer, { kind: 'operations', state: 'pending', page: 1 }, now)
    ).rejects.toThrow('MCP_ADMIN_REQUIRED');
    await expect(countPendingApprovals(viewer, now)).rejects.toThrow('MCP_ADMIN_REQUIRED');
  });

  it('lists assistants with type, status filters and active connection counts', async () => {
    const viewer = await loadMcpViewer();
    const all = await listMcpClients(viewer, { status: 'all', type: 'all', q: '', page: 1 }, now);
    expect(all.counts).toEqual({ active: 2, revoked: 1, all: 3 });
    const byName = new Map(all.rows.map(row => [row.name, row]));
    expect(byName.get('Claude')).toMatchObject({ type: 'automatic', activeConnections: 23 });
    expect(byName.get('Cursor')).toMatchObject({ type: 'manual', activeConnections: 1 });
    expect(byName.get('ChatGPT')).toMatchObject({ type: 'metadata', metadataHost: 'chatgpt.com' });
    expect(byName.get('Claude')?.lastUsedAt).toBeInstanceOf(Date);
    const metadata = await listMcpClients(
      viewer,
      { status: 'all', type: 'metadata', q: '', page: 1 },
      now
    );
    expect(metadata.rows.map(row => row.name)).toEqual(['ChatGPT']);
    const revoked = await listMcpClients(
      viewer,
      { status: 'revoked', type: 'all', q: '', page: 1 },
      now
    );
    expect(revoked.rows.map(row => row.name)).toEqual(['ChatGPT']);
    expect(
      (await listMcpClients(viewer, { status: 'all', type: 'all', q: 'curs', page: 1 }, now)).total
    ).toBe(1);
  });

  it('separates pending operation approvals from decided and expired ones', async () => {
    const viewer = await loadMcpViewer();
    const requesterGrant = await db.mcpGrant.findFirstOrThrow({ where: { userId: jane.id } });
    const approval = (status: string, expiresAt: Date) => ({
      operationId: 'updateService',
      riskClass: 'R2',
      operationDigest: 'a'.repeat(64),
      contractDigest: 'b'.repeat(64),
      actorId: jane.id,
      requesterGrantId: requesterGrant.id,
      requesterCredentialId: 'credential',
      summary: {
        operationId: 'updateService',
        method: 'PATCH',
        path: '/api/v2/services/{id}',
        risk: 'R2',
        description: 'Update a service',
        targets: {},
        ifMatch: null,
        changes: [],
        truncated: false,
      },
      status,
      expiresAt,
      ...(status === 'REJECTED' ? { rejectedAt: now } : {}),
    });
    await db.mcpOperationApproval.createMany({
      data: [
        approval('PENDING', new Date(now.getTime() + 600_000)),
        approval('PENDING', new Date(now.getTime() - 600_000)),
        approval('REJECTED', new Date(now.getTime() + 600_000)),
      ],
    });
    const pending = await listMcpApprovals(
      viewer,
      { kind: 'operations', state: 'pending', page: 1 },
      now
    );
    expect(pending.total).toBe(1);
    expect(pending.pending.operations).toBe(1);
    expect(pending.rows[0]).toMatchObject({
      title: 'updateService',
      detail: 'PATCH /api/v2/services/{id}',
      status: 'pending',
      requester: { name: 'Jane Doe' },
      assistant: 'Claude',
    });
    expect(pending.rows[0]?.href).toBe(
      `/settings/integrations/mcp/approvals/operations/${pending.rows[0]?.id}`
    );
    const decided = await listMcpApprovals(
      viewer,
      { kind: 'operations', state: 'decided', page: 1 },
      now
    );
    expect(decided.rows.map(row => row.status).sort()).toEqual(['expired', 'rejected']);
    const runbooks = await listMcpApprovals(
      viewer,
      { kind: 'runbooks', state: 'pending', page: 1 },
      now
    );
    expect(runbooks).toMatchObject({ total: 0, rows: [] });
  });
});
