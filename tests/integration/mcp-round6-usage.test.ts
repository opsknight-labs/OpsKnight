// @vitest-environment node
import { randomBytes } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestUser, resetDatabase, testPrisma as db } from '../helpers/test-db';
import { digestMcpSecret, mcpResource } from '@/lib/mcp/auth/config';
import { flushMcpCallLog } from '@/lib/mcp/core/call-log';
import { purgeMcpCallLog } from '@/lib/mcp/auth/retention';
import {
  USAGE_EXPORT_LIMIT,
  csvCell,
  getMcpUsage,
  getMcpUsageExportRows,
  usageToCsv,
} from '@/app/(app)/settings/integrations/mcp/usage';
import type { McpViewer } from '@/app/(app)/settings/integrations/mcp/queries';
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

const basePolicy = {
  enabled: true,
  writesEnabled: false,
  requestsPerMinute: 600,
  maxOperations: 8,
  callLogRetentionDays: 30,
  disabledCapabilities: [] as string[],
};
beforeEach(async () => {
  await db.mcpPolicy.upsert({ where: { id: 'default' }, create: basePolicy, update: basePolicy });
  await db.mcpCallLog.deleteMany();
});

const scopes = ['incidents:read'];
async function connection(name = 'Usage client') {
  const user = await createTestUser({ role: 'USER' });
  const client = await db.mcpClient.create({
    data: { name, scopes, redirectUris: ['http://localhost/callback'] },
  });
  const grant = await db.mcpGrant.create({
    data: {
      clientId: client.id,
      userId: user.id,
      userTokenVersion: user.tokenVersion,
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
  return { user, client, grant, bearer };
}

const viewerOf = (id: string, isAdmin: boolean) =>
  ({
    id,
    isAdmin,
    canApproveRunbooks: isAdmin,
    readsAllTargets: isAdmin,
    timeZone: 'UTC',
  }) as unknown as McpViewer;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
let sequence = 0;
const row = (
  grantId: string,
  overrides: Partial<{
    tool: string;
    outcome: string;
    durationMs: number;
    at: Date;
    clientId: string | null;
    userId: string | null;
    errorCode: string | null;
    requestId: string;
  }> = {}
) => ({
  grantId,
  tool: 'whoami',
  outcome: 'served',
  durationMs: 50,
  at: new Date(Date.now() - MINUTE),
  clientId: null,
  userId: null,
  errorCode: null,
  requestId: `req-${++sequence}-${randomBytes(3).toString('hex')}`,
  ...overrides,
});

describe('the call log records who made each call', () => {
  it('stores the client and the person on a real request, and nothing else about them', async () => {
    const { bearer, grant, client, user } = await connection();
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
          id: 1,
          method: 'tools/call',
          params: {
            name: 'whoami',
            arguments: {},
            _meta: {
              'io.modelcontextprotocol/protocolVersion': '2026-07-28',
              'io.modelcontextprotocol/clientCapabilities': {},
              'io.modelcontextprotocol/clientInfo': { name: 'usage', version: '1' },
            },
          },
        }),
      })
    );
    expect(response.status).toBe(200);
    await flushMcpCallLog();
    const rows = await db.mcpCallLog.findMany({ where: { grantId: grant.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ clientId: client.id, userId: user.id, tool: 'whoami' });
    expect(JSON.stringify(rows[0])).not.toContain('@');
  });
});

describe('fleet usage', () => {
  it('counts calls and failures and computes an exact slowest-5% figure', async () => {
    const { grant } = await connection();
    const durations = [100, 200, 300, 400, 1000];
    await db.mcpCallLog.createMany({
      data: [
        ...durations.map(durationMs => row(grant.id, { tool: 'p95_tool', durationMs })),
        // A failure that reached domain work is timed; a rejection is counted but never timed.
        row(grant.id, { tool: 'fail_tool', outcome: 'tool_error', durationMs: 7000 }),
        row(grant.id, { tool: 'fail_tool', outcome: 'rate_limited', durationMs: 1 }),
        row(grant.id, { tool: 'fail_tool', outcome: 'served', durationMs: 10 }),
      ],
    });
    const usage = await getMcpUsage(viewerOf('admin', true), { window: '24h', by: 'tool' });
    const slow = usage.rows.find(entry => entry.key === 'p95_tool')!;
    expect(slow).toMatchObject({ calls: 5, failed: 0, errorRate: 0, p95Ms: 880 });
    const failing = usage.rows.find(entry => entry.key === 'fail_tool')!;
    expect(failing).toMatchObject({ calls: 3, failed: 2 });
    expect(failing.errorRate).toBeCloseTo(0.6667, 3);
    // Only 10 and 7000 are timed (the rate-limited 1 ms is not): 10 + 0.95 * 6990 = 6650.5.
    expect(failing.p95Ms).toBe(6651);
    expect(usage.totals).toMatchObject({ calls: 8, failed: 2 });
    expect(usage.rows[0]!.calls).toBeGreaterThanOrEqual(usage.rows[1]!.calls);
  });

  it('pages the groups in a stable order and falls back to page one for a stale page', async () => {
    const { grant } = await connection();
    // 45 tools; tool_NN has NN+1 calls so the order is fixed (busiest first).
    await db.mcpCallLog.createMany({
      data: Array.from({ length: 45 }, (_, n) =>
        Array.from({ length: n + 1 }, () =>
          row(grant.id, { tool: `tool_${String(n).padStart(2, '0')}` })
        )
      ).flat(),
    });
    const admin = viewerOf('admin', true);
    const first = await getMcpUsage(admin, { window: '24h', by: 'tool', page: 1 });
    const second = await getMcpUsage(admin, { window: '24h', by: 'tool', page: 2 });
    const third = await getMcpUsage(admin, { window: '24h', by: 'tool', page: 3 });
    expect([first.rows.length, second.rows.length, third.rows.length]).toEqual([20, 20, 5]);
    expect([first.groupCount, second.groupCount, third.groupCount]).toEqual([45, 45, 45]);
    expect(first.rows[0]!.key).toBe('tool_44');
    expect(second.rows[0]!.key).toBe('tool_24');
    expect(third.rows.at(-1)!.key).toBe('tool_00');
    const keys = [...first.rows, ...second.rows, ...third.rows].map(entry => entry.key);
    expect(new Set(keys).size).toBe(45);
    // Totals describe the whole window, not the page.
    expect(third.totals.calls).toBe((45 * 46) / 2);
    // A page past the end (a stale link) shows the first page.
    const stale = await getMcpUsage(admin, { window: '24h', by: 'tool', page: 9 });
    expect(stale.page).toBe(1);
    expect(stale.rows[0]!.key).toBe('tool_44');
  });

  it('groups by assistant and by person with names, never emails, and flags older unattributed calls', async () => {
    const a = await connection('Alpha assistant');
    const b = await connection('Beta assistant');
    await db.user.update({ where: { id: a.user.id }, data: { name: 'Alice Example' } });
    await db.mcpCallLog.createMany({
      data: [
        row(a.grant.id, { clientId: a.client.id, userId: a.user.id }),
        row(a.grant.id, { clientId: a.client.id, userId: a.user.id }),
        row(b.grant.id, { clientId: b.client.id, userId: b.user.id }),
        row(b.grant.id), // logged before client and user were recorded
      ],
    });
    const byClient = await getMcpUsage(viewerOf('admin', true), { window: '24h', by: 'client' });
    expect(byClient.rows.map(entry => [entry.label, entry.calls])).toEqual(
      expect.arrayContaining([
        ['Alpha assistant', 2],
        ['Beta assistant', 1],
      ])
    );
    const unattributed = byClient.rows.find(entry => entry.key === null)!;
    expect(unattributed.calls).toBe(1);
    expect(unattributed.label).toMatch(/Not recorded/);

    const byUser = await getMcpUsage(viewerOf('admin', true), { window: '24h', by: 'user' });
    expect(byUser.rows.find(entry => entry.key === a.user.id)).toMatchObject({
      label: 'Alice Example',
      calls: 2,
    });
    expect(JSON.stringify(byUser)).not.toMatch(/@/);
  });

  it('names requests that are not a tool call, and people or assistants that were since removed', async () => {
    const a = await connection('Still here');
    await db.mcpCallLog.createMany({
      data: [
        row(a.grant.id, { clientId: a.client.id, userId: a.user.id, tool: 'none' }),
        row(a.grant.id, { clientId: 'removed-client-abc123', userId: 'removed-user-xyz789' }),
      ],
    });
    const byTool = await getMcpUsage(viewerOf('admin', true), { window: '24h', by: 'tool' });
    const protocol = byTool.rows.find(entry => entry.key === 'none')!;
    expect(protocol.label).toMatch(/Protocol requests/);
    expect(byTool.rows.some(entry => entry.label === 'none')).toBe(false);
    const byUser = await getMcpUsage(viewerOf('admin', true), { window: '24h', by: 'user' });
    expect(byUser.rows.find(entry => entry.key === 'removed-user-xyz789')?.label).toBe(
      'Removed person (id ending xyz789)'
    );
    const byClient = await getMcpUsage(viewerOf('admin', true), { window: '24h', by: 'client' });
    expect(byClient.rows.find(entry => entry.key === 'removed-client-abc123')?.label).toBe(
      'Removed assistant (id ending abc123)'
    );
  });

  it('respects the window, searches by tool, outcome, error code and request id, and admin-only', async () => {
    const { grant } = await connection();
    await db.mcpCallLog.createMany({
      data: [
        row(grant.id, { tool: 'incident_search', at: new Date(Date.now() - 2 * HOUR) }),
        row(grant.id, { tool: 'old_tool', at: new Date(Date.now() - 3 * DAY) }),
        row(grant.id, {
          tool: 'incident_get',
          outcome: 'tool_error',
          errorCode: 'MCP_NOT_FOUND',
          requestId: 'needle-request-1',
        }),
      ],
    });
    const day = await getMcpUsage(viewerOf('admin', true), { window: '24h', by: 'tool' });
    expect(day.rows.map(entry => entry.key)).not.toContain('old_tool');
    const week = await getMcpUsage(viewerOf('admin', true), { window: '7d', by: 'tool' });
    expect(week.rows.map(entry => entry.key)).toContain('old_tool');

    for (const q of ['incident_get', 'tool_error', 'MCP_NOT_FOUND', 'needle-request-1'])
      expect(
        (await getMcpUsage(viewerOf('admin', true), { window: '24h', by: 'tool', q })).rows.map(
          entry => entry.key
        ),
        q
      ).toEqual(['incident_get']);
    // % and _ are literal characters in a search, not wildcards.
    expect(
      (await getMcpUsage(viewerOf('admin', true), { window: '24h', by: 'tool', q: '%' })).rows
    ).toEqual([]);

    await expect(
      getMcpUsage(viewerOf('someone', false), { window: '24h', by: 'tool' })
    ).rejects.toMatchObject({ code: 'MCP_ADMIN_REQUIRED' });
    await expect(
      getMcpUsageExportRows(viewerOf('someone', false), { window: '24h' })
    ).rejects.toMatchObject({ code: 'MCP_ADMIN_REQUIRED' });
  });

  it('reports the retention window so a longer view can be called incomplete', async () => {
    await db.mcpPolicy.update({ where: { id: 'default' }, data: { callLogRetentionDays: 7 } });
    const usage = await getMcpUsage(viewerOf('admin', true), { window: '30d', by: 'tool' });
    expect(usage.retentionDays).toBe(7);
  });
});

describe('usage export', () => {
  it('returns newest first and cuts a long result at the limit, saying so', async () => {
    const { grant } = await connection();
    const marker = `bulk-${randomBytes(3).toString('hex')}`;
    const base = Date.now() - HOUR;
    await db.mcpCallLog.createMany({
      data: Array.from({ length: USAGE_EXPORT_LIMIT + 1 }, (_, index) =>
        row(grant.id, { tool: marker, at: new Date(base - index * 1000) })
      ),
    });
    const result = await getMcpUsageExportRows(viewerOf('admin', true), {
      window: '24h',
      q: marker,
    });
    expect(result.rows).toHaveLength(USAGE_EXPORT_LIMIT);
    expect(result.truncated).toBe(true);
    expect(Date.parse(result.rows[0]!.at)).toBeGreaterThan(Date.parse(result.rows[1]!.at));
  }, 60000);

  it('quotes values and neutralises spreadsheet formulas', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('-1')).toBe("'-1");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell(null)).toBe('');
    const csv = usageToCsv([
      {
        at: '2026-11-06T00:00:00.000Z',
        tool: '=cmd',
        operationId: null,
        outcome: 'served',
        durationMs: 5,
        requestId: 'r1',
        errorCode: null,
        clientId: null,
        userId: null,
        grantId: 'g1',
      },
    ]);
    expect(csv.split('\n')[0]).toBe(
      'at,tool,operationId,outcome,durationMs,requestId,errorCode,clientId,userId,grantId'
    );
    expect(csv.split('\n')[1]).toContain(",'=cmd,");
  });
});

describe('request log retention', () => {
  it('deletes only entries older than the administrator’s window', async () => {
    const { grant } = await connection();
    await db.mcpPolicy.update({ where: { id: 'default' }, data: { callLogRetentionDays: 7 } });
    await db.mcpCallLog.createMany({
      data: [
        row(grant.id, { tool: 'kept_6d', at: new Date(Date.now() - 6 * DAY) }),
        row(grant.id, { tool: 'gone_8d', at: new Date(Date.now() - 8 * DAY) }),
      ],
    });
    expect(await purgeMcpCallLog()).toBe(1);
    const left = await db.mcpCallLog.findMany({ where: { grantId: grant.id } });
    expect(left.map(entry => entry.tool)).toEqual(['kept_6d']);

    // A longer window keeps the same age; the default (30 days) would have too.
    await db.mcpPolicy.update({ where: { id: 'default' }, data: { callLogRetentionDays: 365 } });
    await db.mcpCallLog.create({
      data: row(grant.id, { tool: 'kept_100d', at: new Date(Date.now() - 100 * DAY) }),
    });
    expect(await purgeMcpCallLog()).toBe(0);
  });

  it('refuses a retention value outside 7 to 365 at the database', async () => {
    for (const days of [6, 366, 0])
      await expect(
        db.mcpPolicy.update({ where: { id: 'default' }, data: { callLogRetentionDays: days } })
      ).rejects.toThrow();
  });
});
