// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestUser, resetDatabase, testPrisma as db } from '../helpers/test-db';

const actor = vi.hoisted(() => ({ id: '', role: 'USER', status: 'ACTIVE', tokenVersion: 0 }));
vi.mock('@/lib/rbac', () => ({
  getCurrentUser: vi.fn(async () => actor),
  getUserPermissions: vi.fn(async () => ({ ...actor, capabilities: [] })),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
const { checkMcpConnection } = await import('@/app/(app)/settings/integrations/mcp/actions');

beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (!url.pathname.endsWith('_test') || !['localhost', '127.0.0.1'].includes(url.hostname))
    throw new Error('Owned local test database required');
  await resetDatabase();
}, 60000);

async function grant(
  userId: string,
  clientName: string,
  options: { minutesAgo: number; revoked?: boolean; expired?: boolean }
) {
  const client = await db.mcpClient.create({
    data: { name: clientName, scopes: ['incidents:read'], redirectUris: ['http://localhost/cb'] },
  });
  const createdAt = new Date(Date.now() - options.minutesAgo * 60_000);
  return db.mcpGrant.create({
    data: {
      clientId: client.id,
      userId,
      userTokenVersion: 0,
      scopes: ['incidents:read'],
      resource: 'http://localhost:3000/mcp',
      createdAt,
      revokedAt: options.revoked ? new Date() : null,
      expiresAt: new Date(Date.now() + (options.expired ? -60_000 : 3600_000)),
    },
  });
}

/** UX-11: "Check connection" reports only the viewer's own fresh, live connection. */
describe('checkMcpConnection', () => {
  it('reports the newest live connection from the last 15 minutes, and nothing else', async () => {
    const me = await createTestUser({ role: 'USER' });
    const other = await createTestUser({ role: 'USER' });
    actor.id = me.id;
    expect(await checkMcpConnection()).toEqual({ connected: false });

    await grant(me.id, 'Too old', { minutesAgo: 20 });
    await grant(me.id, 'Revoked', { minutesAgo: 1, revoked: true });
    await grant(me.id, 'Expired', { minutesAgo: 1, expired: true });
    await grant(other.id, 'Someone else', { minutesAgo: 0 });
    expect(await checkMcpConnection()).toEqual({ connected: false });

    await grant(me.id, 'Older live', { minutesAgo: 10 });
    const newest = await grant(me.id, 'Claude Code', { minutesAgo: 2 });
    const result = await checkMcpConnection();
    expect(result).toEqual({
      connected: true,
      client: 'Claude Code',
      createdAt: newest.createdAt.toISOString(),
    });
    // Client name and time only: no ids, scopes or tokens.
    expect(Object.keys(result).sort()).toEqual(['client', 'connected', 'createdAt']);
  });
});
