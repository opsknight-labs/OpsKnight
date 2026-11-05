// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { createTestUser, resetDatabase, testPrisma as db } from '../helpers/test-db';
import { seedMcpLoadPrincipals } from '../load/helpers/mcp-seed';
import { POST } from '@/app/mcp/route';

/** OBS-10: the tokens the load seed mints are real, separate principals the route accepts. */
beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (!url.pathname.endsWith('_test') || !['localhost', '127.0.0.1'].includes(url.hostname))
    throw new Error('Owned local test database required');
  process.env.MCP_PUBLIC_ORIGIN = 'http://localhost:3000';
  process.env.MCP_DATABASE_URL = process.env.DATABASE_URL;
  await resetDatabase();
}, 60000);

const call = (bearer: string, name: string, args: Record<string, unknown>) =>
  POST(
    new Request('http://localhost:3000/mcp', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${bearer}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2026-07-28',
        'mcp-method': 'tools/call',
        'mcp-name': name,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name,
          arguments: args,
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2026-07-28',
            'io.modelcontextprotocol/clientCapabilities': {},
            'io.modelcontextprotocol/clientInfo': { name: 'k6-mcp-assistant', version: '1' },
          },
        },
      }),
    })
  );

describe('MCP load seed', () => {
  it('mints one working grant per principal, for the scenario’s own requests', async () => {
    const users = [
      await createTestUser({ role: 'RESPONDER' }),
      await createTestUser({ role: 'USER' }),
    ];
    const seeded = await seedMcpLoadPrincipals(
      db,
      users.map(user => user.id),
      { count: 5, origin: 'http://localhost:3000/' }
    );
    expect(seeded.resource).toBe('http://localhost:3000/mcp');
    expect(seeded.tokens).toHaveLength(2);
    expect(new Set(seeded.tokens).size).toBe(2);
    expect(await db.mcpGrant.count()).toBe(2);
    for (const token of seeded.tokens) {
      const whoami = await (await call(token, 'whoami', {})).json();
      expect(whoami.result.isError ?? false).toBe(false);
      // The three-step plan the k6 scenario sends.
      const plan = await (
        await call(token, 'execute_plan', {
          steps: [
            { id: 'services', operationId: 'listServices', args: { query: { limit: 10 } } },
            { id: 'incidents', operationId: 'listIncidents', args: { query: { limit: 10 } } },
            { id: 'teams', operationId: 'listTeams', args: { query: { limit: 10 } } },
          ],
        })
      ).json();
      expect(plan.result.isError ?? false, JSON.stringify(plan)).toBe(false);
    }
    const ids = await db.mcpGrant.findMany({ select: { userId: true } });
    expect(ids.map(grant => grant.userId).sort()).toEqual(users.map(user => user.id).sort());
  });
});
