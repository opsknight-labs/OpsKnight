// @vitest-environment node
import { randomBytes } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestUser, resetDatabase, testPrisma as db } from '../helpers/test-db';
import { digestMcpSecret, mcpResource } from '@/lib/mcp/auth/config';
import { POST } from '@/app/mcp/route';

beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (!url.pathname.endsWith('_test') || !['localhost', '127.0.0.1'].includes(url.hostname))
    throw new Error('Owned local test database required');
  process.env.MCP_PUBLIC_ORIGIN = 'http://localhost:3000';
  process.env.MCP_DATABASE_URL = process.env.DATABASE_URL;
  process.env.ENCRYPTION_KEY = randomBytes(32).toString('hex');
  await resetDatabase();
}, 60000);

const setPolicy = (perUserRequestsPerMinute: number | null) => {
  const policy = {
    enabled: true,
    writesEnabled: false,
    requestsPerMinute: 600,
    maxOperations: 8,
    perUserRequestsPerMinute,
  };
  return db.mcpPolicy.upsert({ where: { id: 'default' }, create: policy, update: policy });
};
beforeEach(() => setPolicy(null));

const scopes = ['incidents:read'];
async function connection(userId: string, tokenVersion: number) {
  const client = await db.mcpClient.create({
    data: { name: 'Cap client', scopes, redirectUris: ['http://localhost/callback'] },
  });
  const grant = await db.mcpGrant.create({
    data: {
      clientId: client.id,
      userId,
      userTokenVersion: tokenVersion,
      scopes,
      resource: mcpResource(),
      expiresAt: new Date(Date.now() + 3600000),
    },
  });
  const bearer = randomBytes(32).toString('base64url');
  await db.mcpToken.create({
    data: {
      grantId: grant.id,
      scopes,
      accessHash: digestMcpSecret(bearer),
      refreshHash: digestMcpSecret(randomBytes(32).toString('base64url')),
      accessExpiresAt: new Date(Date.now() + 3600000),
      refreshExpiresAt: new Date(Date.now() + 3600000),
    },
  });
  return bearer;
}

let rpcId = 0;
const whoami = async (bearer: string) => {
  const response = await POST(
    new Request(mcpResource(), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${bearer}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2026-07-28',
        'mcp-method': 'tools/call',
        'mcp-name': 'whoami',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: ++rpcId,
        method: 'tools/call',
        params: {
          name: 'whoami',
          arguments: {},
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2026-07-28',
            'io.modelcontextprotocol/clientCapabilities': {},
            'io.modelcontextprotocol/clientInfo': { name: 'cap', version: '1' },
          },
        },
      }),
    })
  );
  const json = await response.json();
  return {
    status: response.status,
    retryAfter: response.headers.get('retry-after'),
    limited: JSON.stringify(json).includes('MCP_RATE_LIMITED') || response.status === 429,
  };
};

describe('per-person request cap', () => {
  it('adds up one person’s connections, leaves other people alone, and is off by default', async () => {
    const alice = await createTestUser({ role: 'USER' });
    const bob = await createTestUser({ role: 'USER' });
    const aliceLaptop = await connection(alice.id, alice.tokenVersion);
    const alicePhone = await connection(alice.id, alice.tokenVersion);
    const bobLaptop = await connection(bob.id, bob.tokenVersion);

    // Off: both of Alice's connections are only bound by their own per-connection quota.
    for (let i = 0; i < 4; i++) expect((await whoami(aliceLaptop)).limited).toBe(false);

    await setPolicy(5);
    // The counter is fresh for this minute's window only if no earlier calls landed in it; use a
    // new person so the assertion is about the cap, not about leftovers.
    const carol = await createTestUser({ role: 'USER' });
    const carolA = await connection(carol.id, carol.tokenVersion);
    const carolB = await connection(carol.id, carol.tokenVersion);
    const results: boolean[] = [];
    for (let i = 0; i < 6; i++) results.push((await whoami(i % 2 ? carolA : carolB)).limited);
    // Five requests fit under the cap across the two connections; the sixth does not.
    expect(results.slice(0, 5)).toEqual([false, false, false, false, false]);
    expect(results[5]).toBe(true);

    // Another person is unaffected by Carol having used her cap, and so is Alice's other phone.
    expect((await whoami(bobLaptop)).limited).toBe(false);
    expect((await whoami(alicePhone)).limited).toBe(false);
  });

  it('tells the client when the window reopens', async () => {
    const dana = await createTestUser({ role: 'USER' });
    const bearer = await connection(dana.id, dana.tokenVersion);
    await setPolicy(1);
    expect((await whoami(bearer)).limited).toBe(false);
    const refused = await whoami(bearer);
    expect(refused.limited).toBe(true);
    expect(Number(refused.retryAfter)).toBeGreaterThanOrEqual(1);
    expect(Number(refused.retryAfter)).toBeLessThanOrEqual(60);
  });

  it('is enforced by the database at 1 to 6000 or off', async () => {
    for (const value of [0, 6001, -1]) await expect(setPolicy(value)).rejects.toThrow();
    await expect(setPolicy(6000)).resolves.toBeTruthy();
    await expect(setPolicy(null)).resolves.toBeTruthy();
  });
});
