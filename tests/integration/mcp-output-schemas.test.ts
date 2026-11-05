// @vitest-environment node
import { randomBytes } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createTestEscalationPolicy,
  createTestIncident,
  createTestOnCallSchedule,
  createTestService,
  createTestStatusPage,
  createTestTeam,
  createTestUser,
  linkServiceToStatusPage,
  resetDatabase,
  testPrisma as db,
} from '../helpers/test-db';
import { createRunbook, publishDraftVersion } from '@/lib/runbooks/versioning';
import { digestMcpSecret, mcpResource } from '@/lib/mcp/auth/config';
import { MCP_CATALOG } from '@/lib/mcp/catalog';
import { POST } from '@/app/mcp/route';

/**
 * D1: a named tool that advertises an outputSchema has every result validated against it by the
 * SDK, and a mismatch turns a completed call (a write included) into a tool error. These calls
 * run the real routes, so a contract that drifted from what a route returns fails here.
 */

beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (!url.pathname.endsWith('_test') || !['localhost', '127.0.0.1'].includes(url.hostname))
    throw new Error('Owned local test database required');
  process.env.MCP_PUBLIC_ORIGIN = 'http://localhost:3000';
  process.env.MCP_DATABASE_URL = process.env.DATABASE_URL;
  process.env.ENCRYPTION_KEY = randomBytes(32).toString('hex');
  await resetDatabase();
}, 60000);

const policy = {
  enabled: true,
  writesEnabled: true,
  requestsPerMinute: 600,
  maxOperations: 8,
  disabledCapabilities: [] as string[],
};
beforeEach(async () => {
  await db.mcpPolicy.upsert({ where: { id: 'default' }, create: policy, update: policy });
});

const scopes = [
  ...new Set(MCP_CATALOG.filter(operation => operation.tool).flatMap(o => o.requiredScopes)),
];

async function principal() {
  const user = await createTestUser({ role: 'ADMIN', name: 'Output Schema' });
  const client = await db.mcpClient.create({
    data: { name: 'Output schemas', scopes, redirectUris: ['http://localhost/callback'] },
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
  return { user, bearer };
}

let rpcId = 0;
async function rpc(bearer: string, method: string, params: Record<string, unknown> = {}) {
  const response = await POST(
    new Request(mcpResource(), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${bearer}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2026-07-28',
        'mcp-method': method,
        ...(typeof params.name === 'string' ? { 'mcp-name': params.name } : {}),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: ++rpcId,
        method,
        params: {
          ...params,
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2026-07-28',
            'io.modelcontextprotocol/clientCapabilities': {},
            'io.modelcontextprotocol/clientInfo': { name: 'output-schemas', version: '1' },
          },
        },
      }),
    })
  );
  expect(response.status).toBe(200);
  return (await response.json()) as {
    result: {
      isError?: boolean;
      content: { type: string; text?: string }[];
      structuredContent?: Record<string, unknown>;
      tools?: { name: string; outputSchema?: unknown }[];
    };
  };
}

const key = () => randomBytes(12).toString('hex');

describe('named tool results satisfy their advertised output schemas', () => {
  it('reads and writes through the real routes come back as results, not validation errors', async () => {
    const { user, bearer } = await principal();
    const team = await createTestTeam('Schema team');
    await db.teamMember.create({ data: { teamId: team.id, userId: user.id } });
    const service = await createTestService('Schema service', team.id);
    const incident = await createTestIncident('Disk full on db-1', service.id, {
      description: 'Dashboard https://grafana.test/d/x?token=secret',
    });
    const schedule = await createTestOnCallSchedule('Schema rota', [{ userIds: [user.id] }]);
    const escalation = await createTestEscalationPolicy('Schema policy', [
      { stepOrder: 0, delayMinutes: 5, targetType: 'USER', targetUserId: user.id },
    ]);
    const page = await createTestStatusPage();
    await linkServiceToStatusPage(page.id, service.id);
    const runbook = await createRunbook(
      {
        name: 'Schema runbook',
        slug: `schema-runbook-${crypto.randomUUID()}`,
        description: '',
        definition: {
          steps: [{ key: 'wait', name: 'Wait', type: 'WAIT', config: { durationSeconds: 1 } }],
        },
      },
      user.id
    );
    await publishDraftVersion(runbook.draftVersionId!, user.id);

    const listed = (await rpc(bearer, 'tools/list')).result.tools!;
    const advertised = new Set(
      listed.filter(tool => tool.outputSchema).map(tool => String(tool.name))
    );
    const calls: [string, Record<string, unknown>][] = [
      ['incident_search', { query: { limit: 5 } }],
      ['incident_get', { path: { id: incident.id } }],
      ['incident_get_timeline', { path: { id: incident.id } }],
      ['schedule_get', { path: { id: schedule.id } }],
      ['oncall_lookup', { path: { id: schedule.id } }],
      ['oncall_my_shifts', { query: { days: 7 } }],
      ['escalation_explain', { path: { id: escalation.id } }],
      ['status_page_get', { path: { id: page.id } }],
      ['service_get_health', { path: { id: service.id } }],
      ['automation_get_effective', { path: { id: service.id } }],
      ['automation_get_decision_trace', { path: { id: service.id } }],
      ['runbook_find', { query: { limit: 5 } }],
      [
        'incident_create',
        { body: { title: 'Created by schema test', serviceId: service.id }, idempotencyKey: key() },
      ],
      [
        'incident_add_note',
        { path: { id: incident.id }, body: { content: 'Looking' }, idempotencyKey: key() },
      ],
      [
        'incident_assign',
        { path: { id: incident.id }, body: { assigneeId: user.id }, idempotencyKey: key() },
      ],
      ['incident_acknowledge', { path: { id: incident.id }, body: {}, idempotencyKey: key() }],
      ['incident_resolve', { path: { id: incident.id }, body: {}, idempotencyKey: key() }],
    ];
    const checked: string[] = [];
    for (const [name, args] of calls) {
      if (!listed.some(tool => tool.name === name)) continue;
      const { result } = await rpc(bearer, 'tools/call', { name, arguments: args });
      const text = result.content.map(part => part.text ?? '').join(' ');
      expect(text, name).not.toContain('Output validation error');
      expect(result.isError, `${name}: ${text.slice(0, 400)}`).toBeFalsy();
      if (advertised.has(name)) checked.push(name);
    }
    // Most of the curated surface is covered, and every one of these advertises a schema.
    expect(checked.length).toBeGreaterThanOrEqual(12);
    expect(checked).toContain('oncall_my_shifts');
  }, 120000);
});
