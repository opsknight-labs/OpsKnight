import { createHmac, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestUser, resetDatabase, testPrisma as db } from '../helpers/test-db';
import {
  digestMcpSecret,
  getMcpConfigurationStatus,
  mcpResource,
  resetMcpRuntimeForTests,
} from '@/lib/mcp/auth/config';

const actor = vi.hoisted(() => ({ id: '', capabilities: ['admin.manage'] as string[] }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/rbac', () => ({
  getUserPermissions: vi.fn(async () => ({ id: actor.id, capabilities: actor.capabilities })),
  getCurrentUser: vi.fn(async () => ({ id: actor.id, tokenVersion: 0 })),
}));

// This suite proves MCP works with no MCP-specific environment variables at all.
const keys = ['MCP_PUBLIC_ORIGIN', 'NEXTAUTH_URL', 'NEXT_PUBLIC_APP_URL', 'ENCRYPTION_KEYS'];
const saved = Object.fromEntries(keys.map(key => [key, Reflect.get(process.env, key)]));
let encryptionKey = '';

beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (!url.pathname.endsWith('_test') || !['localhost', '127.0.0.1'].includes(url.hostname))
    throw new Error('Owned local test database required');
  for (const key of keys) Reflect.deleteProperty(process.env, key);
  await resetDatabase();
}, 60000);

afterAll(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) Reflect.deleteProperty(process.env, key);
    else Reflect.set(process.env, key, value);
  }
  resetMcpRuntimeForTests();
});

beforeEach(async () => {
  resetMcpRuntimeForTests();
  encryptionKey = randomBytes(32).toString('hex');
  process.env.ENCRYPTION_KEY = encryptionKey;
  Reflect.deleteProperty(process.env, 'ENCRYPTION_KEYS');
  await db.mcpGrant.deleteMany();
  await db.mcpClient.deleteMany();
  await db.mcpPolicy.deleteMany();
  await db.systemSettings.upsert({
    where: { id: 'default' },
    create: { appUrl: null },
    update: { appUrl: null },
  });
});

describe('MCP configuration without MCP environment variables', () => {
  it('fails closed until the database configuration has been loaded', () => {
    expect(() => mcpResource()).toThrow('MCP_RUNTIME_NOT_LOADED');
  });

  it('hashes credentials with a key derived from the application encryption key', async () => {
    expect((await getMcpConfigurationStatus()).issues).toEqual([]);
    const first = digestMcpSecret('token');
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    // Domain separated: never the raw encryption key used directly as an HMAC key.
    expect(first).not.toBe(
      createHmac('sha256', Buffer.from(encryptionKey, 'hex')).update('token').digest('hex')
    );
    expect(digestMcpSecret('token')).toBe(first);
    expect(digestMcpSecret('other')).not.toBe(first);
    // Nothing MCP-specific is generated or stored.
    expect(await db.mcpPolicy.count()).toBe(0);

    // Every replica sharing the encryption key derives the same hashes.
    resetMcpRuntimeForTests();
    expect(digestMcpSecret('token')).toBe(first);

    // Keeping the old key only for decryption leaves existing connections valid.
    process.env.ENCRYPTION_KEYS = `current:${encryptionKey},old:${randomBytes(32).toString('hex')}`;
    expect(digestMcpSecret('token')).toBe(first);

    // Promoting a new active encryption key invalidates every MCP credential hash.
    process.env.ENCRYPTION_KEYS = `next:${randomBytes(32).toString('hex')},current:${encryptionKey}`;
    expect(digestMcpSecret('token')).not.toBe(first);
  });

  it('uses the App URL from Settings → System as the public origin', async () => {
    await db.systemSettings.update({
      where: { id: 'default' },
      data: { appUrl: 'https://ops.example.com/' },
    });
    const status = await getMcpConfigurationStatus({ force: true });
    expect(status).toMatchObject({ origin: 'https://ops.example.com', originSource: 'app-url' });
    expect(mcpResource()).toBe('https://ops.example.com/mcp');
    const { GET } = await import('@/app/.well-known/oauth-protected-resource/mcp/route');
    const metadata = await (await GET()).json();
    expect(metadata).toMatchObject({
      resource: 'https://ops.example.com/mcp',
      authorization_servers: ['https://ops.example.com/oauth/mcp'],
    });
  });

  it('reports an unusable App URL instead of serving a wrong origin', async () => {
    await db.systemSettings.update({
      where: { id: 'default' },
      data: { appUrl: 'http://ops.example.com' },
    });
    const status = await getMcpConfigurationStatus({ force: true });
    expect(status.origin).toBeNull();
    expect(status.issues.join(' ')).toContain('HTTPS');
    expect(() => mcpResource()).toThrow('MCP_ORIGIN_REQUIRED');
  });

  it('reports a missing encryption key and refuses to hash credentials', async () => {
    process.env.ENCRYPTION_KEY = 'not-a-valid-key';
    const status = await getMcpConfigurationStatus({ force: true });
    expect(status.issues.join(' ')).toContain('encryption key');
    expect(JSON.stringify(status)).not.toContain('not-a-valid-key');
    expect(() => digestMcpSecret('token')).toThrow('MCP_HASH_SECRET_UNAVAILABLE');
  });

  it('lets an administrator revoke every MCP connection at once, with an audit record', async () => {
    const { revokeAllMcpConnections } =
      await import('@/app/(app)/settings/integrations/mcp/actions');
    const admin = await createTestUser({ role: 'ADMIN' });
    const member = await createTestUser({ role: 'USER' });
    const client = await db.mcpClient.create({
      data: {
        name: 'Assistant',
        scopes: ['incidents:read'],
        redirectUris: ['http://localhost/cb'],
      },
    });
    for (const user of [admin, member])
      await db.mcpGrant.create({
        data: {
          clientId: client.id,
          userId: user.id,
          userTokenVersion: user.tokenVersion,
          scopes: ['incidents:read'],
          resource: 'https://ops.example.com/mcp',
          expiresAt: new Date(Date.now() + 3600000),
        },
      });

    const confirmed = new FormData();
    confirmed.set('confirm', 'on');

    actor.id = member.id;
    actor.capabilities = [];
    await expect(revokeAllMcpConnections(confirmed)).rejects.toThrow('MCP_ADMIN_REQUIRED');

    actor.id = admin.id;
    actor.capabilities = ['admin.manage'];
    await expect(revokeAllMcpConnections(new FormData())).rejects.toThrow(
      'MCP_CONFIRMATION_REQUIRED'
    );
    expect(await db.mcpGrant.count({ where: { revokedAt: null } })).toBe(2);

    await revokeAllMcpConnections(confirmed);
    expect(await db.mcpGrant.count({ where: { revokedAt: null } })).toBe(0);
    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: 'mcp.grants.revoked_all' },
    });
    expect(audit).toMatchObject({ actorId: admin.id, details: { metadata: { revokedGrants: 2 } } });
  });
});
