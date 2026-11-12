// @vitest-environment node
/**
 * On-call actions that run directly over MCP, like acknowledge and resolve: escalate, reopen,
 * unsnooze and bulk acknowledge. Snooze and unacknowledge stay approval-gated
 * (tests/integration/mcp-approval-incidents.test.ts).
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { IncidentStatus } from '@prisma/client';
import { disconnectPrisma } from '@/lib/prisma';
import { digestMcpSecret, mcpResource } from '@/lib/mcp/auth/config';
import { MCP_OPERATION_MAP, isMcpApprovalGated, isMcpExecutable } from '@/lib/mcp/catalog';
import { POST } from '@/app/mcp/route';
import {
  createTestEscalationPolicy,
  createTestIncident,
  createTestService,
  createTestTeam,
  createTestUser,
  resetDatabase,
  testPrisma as db,
} from '../helpers/test-db';

const SCOPES = ['incidents:read', 'incidents:write', 'services:read'];

async function connect(role: 'ADMIN' | 'USER') {
  const user = await createTestUser({ role });
  const client = await db.mcpClient.create({
    data: { name: `Curated ${role}`, redirectUris: ['http://localhost/callback'], scopes: SCOPES },
  });
  const grant = await db.mcpGrant.create({
    data: {
      clientId: client.id,
      userId: user.id,
      userTokenVersion: user.tokenVersion,
      scopes: SCOPES,
      resource: mcpResource(),
      expiresAt: new Date(Date.now() + 3600000),
    },
  });
  const bearer = randomBytes(32).toString('base64url');
  await db.mcpToken.create({
    data: {
      grantId: grant.id,
      scopes: SCOPES,
      accessHash: digestMcpSecret(bearer),
      refreshHash: digestMcpSecret(randomBytes(32).toString('base64url')),
      accessExpiresAt: new Date(Date.now() + 3600000),
      refreshExpiresAt: new Date(Date.now() + 3600000),
    },
  });
  return { user, bearer };
}

type ToolResult = {
  isError?: boolean;
  content: { type: string; text: string }[];
  structuredContent?: Record<string, unknown>;
};
async function rpc(bearer: string, method: string, params: Record<string, unknown>) {
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
        id: 1,
        method,
        params: {
          ...params,
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2026-07-28',
            'io.modelcontextprotocol/clientInfo': { name: 'curated', version: '1' },
            'io.modelcontextprotocol/clientCapabilities': {},
          },
        },
      }),
    })
  );
  expect(response.status).toBe(200);
  return (await response.json()).result;
}
const call = async (bearer: string, name: string, args: Record<string, unknown>) =>
  (await rpc(bearer, 'tools/call', { name, arguments: args })) as ToolResult;
const key = () => `curated-${randomBytes(12).toString('hex')}`;
const data = (result: ToolResult) =>
  (result.structuredContent as { data: { data: Record<string, unknown> } }).data.data;

let admin: Awaited<ReturnType<typeof connect>>;
let outsider: Awaited<ReturnType<typeof connect>>;
let serviceId: string;
let teamServiceId: string;

beforeAll(async () => {
  process.env.MCP_DATABASE_URL = process.env.DATABASE_URL;
  process.env.MCP_DATABASE_POOL_SIZE = '2';
  process.env.MCP_PUBLIC_ORIGIN = 'http://localhost:3000';
  await resetDatabase();
  admin = await connect('ADMIN');
  outsider = await connect('USER');
  const responder = await createTestUser({ role: 'USER', name: 'Second responder' });
  const policy = await createTestEscalationPolicy('Curated policy', [
    { stepOrder: 0, delayMinutes: 0, targetType: 'USER', targetUserId: responder.id },
    { stepOrder: 1, delayMinutes: 10, targetType: 'USER', targetUserId: admin.user.id },
  ]);
  serviceId = (await createTestService('Curated service', null, { escalationPolicyId: policy.id }))
    .id;
  // A team the outsider is not a member of: its incidents are outside their resource scope.
  const team = await createTestTeam('Curated team');
  teamServiceId = (await createTestService('Team service', team.id)).id;
}, 60000);

beforeEach(async () => {
  await db.mcpPolicy.upsert({
    where: { id: 'default' },
    create: { enabled: true, writesEnabled: true, requestsPerMinute: 6000 },
    update: { enabled: true, writesEnabled: true, requestsPerMinute: 6000 },
  });
});

afterAll(async () => {
  await disconnectPrisma();
  await db.$disconnect();
});

const incident = async (status: IncidentStatus, service = serviceId) =>
  (
    await createTestIncident('Curated incident', service, {
      status,
      ...(status === 'SNOOZED' ? { snoozedUntil: new Date(Date.now() + 3600000) } : {}),
      ...(status === 'RESOLVED' ? { resolvedAt: new Date() } : {}),
    })
  ).id;
const statusOf = async (id: string) =>
  (await db.incident.findUniqueOrThrow({ where: { id } })).status;

describe('catalog disposition', () => {
  it('runs escalate, reopen and unsnooze directly and keeps snooze and unacknowledge gated', () => {
    for (const [operationId, tool] of [
      ['escalateIncident', 'incident_escalate'],
      ['reopenIncident', 'incident_reopen'],
      ['unsnoozeIncident', 'incident_unsnooze'],
    ]) {
      const operation = MCP_OPERATION_MAP.get(operationId)!;
      expect(operation.tool).toBe(tool);
      expect(operation.risk).toBe('R1');
      expect(isMcpExecutable(operation), operationId).toBe(true);
      expect(isMcpApprovalGated(operation)).toBe(false);
    }
    for (const operationId of ['snoozeIncident', 'unacknowledgeIncident']) {
      const operation = MCP_OPERATION_MAP.get(operationId)!;
      expect(isMcpExecutable(operation)).toBe(false);
      expect(isMcpApprovalGated(operation)).toBe(true);
    }
  });

  it('lists the tools only while changes are allowed', async () => {
    const names = async () =>
      ((await rpc(admin.bearer, 'tools/list', {})).tools as { name: string }[]).map(
        tool => tool.name
      );
    const tools = ['incident_escalate', 'incident_reopen', 'incident_unsnooze'];
    expect(await names()).toEqual(expect.arrayContaining([...tools, 'incident_acknowledge_many']));
    await db.mcpPolicy.update({ where: { id: 'default' }, data: { writesEnabled: false } });
    const readOnly = await names();
    for (const tool of [...tools, 'incident_acknowledge_many'])
      expect(readOnly).not.toContain(tool);
  });
});

describe('incident_reopen and incident_unsnooze', () => {
  it('reopens once; a retry with the same key replays without a second event', async () => {
    const id = await incident('RESOLVED');
    const idempotencyKey = key();
    const args = { path: { id }, body: { expectedStatus: 'RESOLVED' }, idempotencyKey };
    const first = await call(admin.bearer, 'incident_reopen', args);
    expect(first.isError, JSON.stringify(first)).not.toBe(true);
    expect(await statusOf(id)).toBe('OPEN');
    const replay = await call(admin.bearer, 'incident_reopen', args);
    expect(replay.isError, JSON.stringify(replay)).not.toBe(true);
    expect(data(replay)).toEqual(data(first));
    const events = await db.incidentEvent.findMany({ where: { incidentId: id } });
    expect(events.filter(event => /reopen/i.test(event.message))).toHaveLength(1);
  });

  it('ends a snooze', async () => {
    const id = await incident('SNOOZED');
    const result = await call(admin.bearer, 'incident_unsnooze', {
      path: { id },
      body: {},
      idempotencyKey: key(),
    });
    expect(result.isError, JSON.stringify(result)).not.toBe(true);
    expect(await statusOf(id)).not.toBe('SNOOZED');
  });

  it('applies two racing reopens once: one transition, one event, no error', async () => {
    const id = await incident('RESOLVED');
    const results = await Promise.all(
      [key(), key()].map(idempotencyKey =>
        call(admin.bearer, 'incident_reopen', {
          path: { id },
          body: { expectedStatus: 'RESOLVED' },
          idempotencyKey,
        })
      )
    );
    // The incident row is locked by the MCP fence; the loser sees OPEN, which is a no-op or a
    // conflict, never a second reopen.
    for (const result of results)
      if (result.isError) expect(result.content[0].text).toMatch(/^MCP_DOMAIN_REJECTED/);
    expect(await statusOf(id)).toBe('OPEN');
    const events = await db.incidentEvent.findMany({ where: { incidentId: id } });
    expect(events.filter(event => /reopen/i.test(event.message))).toHaveLength(1);
  });

  it('refuses a person whose role cannot manage incidents, and changes nothing', async () => {
    const id = await incident('RESOLVED', teamServiceId);
    const listed = ((await rpc(outsider.bearer, 'tools/list', {})).tools as { name: string }[]).map(
      tool => tool.name
    );
    expect(listed).not.toContain('incident_reopen');
    // A session that can change nothing is not offered the generic change tool either (W2), so
    // a call through it is refused before any authority is used.
    expect(listed).not.toContain('call_operation');
    const result = await call(outsider.bearer, 'call_operation', {
      operationId: 'reopenIncident',
      args: { path: { id }, body: {}, idempotencyKey: key() },
    });
    expect(result?.isError ?? true).toBe(true);
    if (result) expect(result.content[0].text).not.toMatch(/reopened/i);
    expect(await statusOf(id)).toBe('RESOLVED');
  });
});

describe('incident_escalate', () => {
  it('pages the next step once and reports who; a replay pages nobody again', async () => {
    const id = await incident('OPEN');
    const idempotencyKey = key();
    const first = await call(admin.bearer, 'incident_escalate', { path: { id }, idempotencyKey });
    expect(first.isError, JSON.stringify(first)).not.toBe(true);
    const escalation = data(first);
    expect(escalation).toMatchObject({ requested: true, incident: { id, status: 'OPEN' } });
    expect(escalation.incident).toHaveProperty('escalation');
    // The impact a responder needs to confirm: which step paged whom.
    expect(escalation).toMatchObject({
      escalated: true,
      paged: { stepIndex: 0, targetType: 'USER', targetName: 'Second responder', targetCount: 1 },
    });
    const replay = await call(admin.bearer, 'incident_escalate', { path: { id }, idempotencyKey });
    expect(replay.isError, JSON.stringify(replay)).not.toBe(true);
    expect(data(replay).outcome).toBe(escalation.outcome);
    const requests = await db.auditLog.count({
      where: { action: 'incident.escalation.requested', entityId: id },
    });
    expect(requests).toBe(1);
    // The single-incident read now shows where escalation stands.
    const read = await call(admin.bearer, 'incident_get', { path: { id } });
    expect(data(read)).toHaveProperty('escalation');
    expect(data(read)).toHaveProperty('sla');
  });

  it('does not escalate an incident that no longer needs a responder', async () => {
    const id = await incident('ACKNOWLEDGED');
    const result = await call(admin.bearer, 'incident_escalate', {
      path: { id },
      idempotencyKey: key(),
    });
    expect(result.isError, JSON.stringify(result)).not.toBe(true);
    // Null members are compacted away on the wire; nothing was paged.
    expect(data(result)).toMatchObject({ requested: false, reason: 'INCIDENT_NOT_ESCALATABLE' });
    expect(data(result)).not.toHaveProperty('paged');
    expect(await statusOf(id)).toBe('ACKNOWLEDGED');
  });

  it('reports a missing incident as unavailable', async () => {
    const result = await call(admin.bearer, 'incident_escalate', {
      path: { id: 'missing-incident' },
      idempotencyKey: key(),
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/^MCP_RESOURCE_UNAVAILABLE/);
  });
});

describe('incident_acknowledge_many', () => {
  it('acknowledges each incident through its own check and reports partial failure', async () => {
    const ids = [await incident('OPEN'), await incident('OPEN'), 'missing-incident'];
    const idempotencyKey = key();
    const first = await call(admin.bearer, 'incident_acknowledge_many', { ids, idempotencyKey });
    expect(first.isError, JSON.stringify(first)).not.toBe(true);
    const summary = first.structuredContent as {
      results: { id: string; status: string; code?: string }[];
      completed: number;
      failed: number;
    };
    expect(summary).toMatchObject({ completed: 2, failed: 1 });
    expect(summary.results.map(item => [item.id, item.status])).toEqual([
      [ids[0], 'completed'],
      [ids[1], 'completed'],
      [ids[2], 'failed'],
    ]);
    expect(summary.results[2].code).toBe('MCP_RESOURCE_UNAVAILABLE');
    expect(await statusOf(ids[0])).toBe('ACKNOWLEDGED');
    const acknowledgements = async () =>
      db.auditLog.count({
        where: { action: 'incident.acknowledged', entityId: { in: ids.slice(0, 2) } },
      });
    const before = await acknowledgements();
    // A retry with the same key replays each incident's own receipt: nothing happens twice.
    const replay = await call(admin.bearer, 'incident_acknowledge_many', { ids, idempotencyKey });
    expect((replay.structuredContent as { completed: number }).completed).toBe(2);
    expect(await acknowledgements()).toBe(before);
  });

  it('refuses more than eight incidents or a repeated id', async () => {
    // Charged one operation per incident before anything runs, so nine never start.
    const response = await POST(
      new Request(mcpResource(), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${admin.bearer}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'mcp-protocol-version': '2026-07-28',
          'mcp-method': 'tools/call',
          'mcp-name': 'incident_acknowledge_many',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'incident_acknowledge_many',
            arguments: {
              ids: Array.from({ length: 9 }, (_, i) => `id${i}`),
              idempotencyKey: key(),
            },
            _meta: {
              'io.modelcontextprotocol/protocolVersion': '2026-07-28',
              'io.modelcontextprotocol/clientInfo': { name: 'curated', version: '1' },
              'io.modelcontextprotocol/clientCapabilities': {},
            },
          },
        }),
      })
    );
    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).toContain('MCP_OPERATION_BUDGET_EXCEEDED');
    const id = await incident('OPEN');
    const repeated = await call(admin.bearer, 'incident_acknowledge_many', {
      ids: [id, id],
      idempotencyKey: key(),
    });
    expect(repeated.isError).toBe(true);
    expect(await statusOf(id)).toBe('OPEN');
    // A note longer than acknowledge accepts is refused up front, not once per incident.
    const tooLong = await call(admin.bearer, 'incident_acknowledge_many', {
      ids: [id],
      note: 'n'.repeat(1001),
      idempotencyKey: key(),
    });
    expect(tooLong.isError, JSON.stringify(tooLong)).toBe(true);
    expect(JSON.stringify(tooLong)).not.toContain('results');
    expect(await statusOf(id)).toBe('OPEN');
  });
});

describe('attribution of changes made through an assistant', () => {
  it('names the person and the assistant, and marks the rows with the channel', async () => {
    const client = await db.mcpClient.findFirstOrThrow({ where: { name: 'Curated ADMIN' } });
    const channel = `mcp:${client.id}`;
    const label = `${admin.user.name} via Curated ADMIN (AI)`;
    const id = await incident('OPEN');

    const acknowledged = await call(admin.bearer, 'incident_acknowledge', {
      path: { id },
      body: {},
      idempotencyKey: key(),
    });
    expect(acknowledged.isError, JSON.stringify(acknowledged)).not.toBe(true);
    const noted = await call(admin.bearer, 'incident_add_note', {
      path: { id },
      body: { content: 'Restarted the worker pool.' },
      idempotencyKey: key(),
    });
    expect(noted.isError, JSON.stringify(noted)).not.toBe(true);

    const events = await db.incidentEvent.findMany({ where: { incidentId: id } });
    const made = events.filter(event => /acknowledged|Note added/i.test(event.message));
    expect(made).toHaveLength(2);
    for (const event of made) {
      expect(event.message).toContain(`by ${label}`);
      expect(event.channel).toBe(channel);
    }
    const note = await db.incidentNote.findFirstOrThrow({ where: { incidentId: id } });
    expect(note.channel).toBe(channel);
    const audits = await db.auditLog.findMany({ where: { entityId: id } });
    expect(audits.length).toBeGreaterThanOrEqual(2);
    for (const audit of audits) expect(audit.channel).toBe(channel);

    // A row written outside an assistant's transaction is never marked, even on a connection
    // an assistant's transaction used before.
    for (let attempt = 0; attempt < 8; attempt++) {
      const plain = await db.incidentEvent.create({ data: { incidentId: id, message: 'manual' } });
      expect(plain.channel).toBeNull();
    }
  });

  it('removes markup from a self-declared assistant name', async () => {
    const { mcpActorLabel } = await import('@/lib/mcp/auth/principal');
    expect(mcpActorLabel('Asha', '*@here* <b>Claude</b>')).toBe('Asha via here bClaude/b (AI)');
    expect(mcpActorLabel(null, '***')).toBe('A user via an assistant (AI)');
  });
});

describe('routine responder changes without a review (administrator switch)', () => {
  const snooze = (id: string) =>
    call(admin.bearer, 'call_operation', {
      operationId: 'snoozeIncident',
      args: {
        path: { id },
        body: {
          expectedStatus: 'OPEN',
          snoozedUntil: new Date(Date.now() + 3600000).toISOString(),
        },
        idempotencyKey: key(),
      },
    });
  const direct = (on: boolean) =>
    db.mcpPolicy.update({
      where: { id: 'default' },
      data: { responderDirectWritesEnabled: on },
    });
  const workflow = async (operationId: string) => {
    const found = await call(admin.bearer, 'describe_operation', { operationId });
    return JSON.stringify(found.structuredContent);
  };

  it('is off by default: snooze still goes through review', async () => {
    const id = await incident('OPEN');
    const refused = await snooze(id);
    expect(refused.isError).toBe(true);
    expect(JSON.stringify(refused)).toContain('MCP_OPERATION_UNAVAILABLE');
    expect(await statusOf(id)).toBe('OPEN');
    expect(await workflow('snoozeIncident')).toContain('operation_prepare');
  });

  it('when on, runs the marked changes directly, attributed, and nothing else', async () => {
    await direct(true);
    const id = await incident('OPEN');
    const done = await snooze(id);
    expect(done.isError, JSON.stringify(done)).not.toBe(true);
    expect(await statusOf(id)).toBe('SNOOZED');
    expect(await workflow('snoozeIncident')).toContain('call_operation');
    const client = await db.mcpClient.findFirstOrThrow({ where: { name: 'Curated ADMIN' } });
    const audits = await db.auditLog.findMany({ where: { entityId: id } });
    expect(audits.length).toBeGreaterThan(0);
    for (const audit of audits) expect(audit.channel).toBe(`mcp:${client.id}`);

    // A change that is not marked keeps its review, even for an administrator.
    const other = await incident('OPEN');
    const suppressed = await call(admin.bearer, 'call_operation', {
      operationId: 'suppressIncident',
      args: { path: { id: other }, body: { expectedStatus: 'OPEN' }, idempotencyKey: key() },
    });
    expect(suppressed.isError).toBe(true);
    expect(await statusOf(other)).toBe('OPEN');

    // The role check is unchanged: someone who cannot touch the incident is still refused.
    const hidden = await incident('OPEN', teamServiceId);
    const outside = await call(outsider.bearer, 'call_operation', {
      operationId: 'snoozeIncident',
      args: {
        path: { id: hidden },
        body: {
          expectedStatus: 'OPEN',
          snoozedUntil: new Date(Date.now() + 3600000).toISOString(),
        },
        idempotencyKey: key(),
      },
    });
    // Refused either as a tool error or before the tool runs; never applied.
    expect(outside?.isError ?? true).toBe(true);
    expect(await statusOf(hidden)).toBe('OPEN');

    // Turning changes off turns this off too.
    await db.mcpPolicy.update({ where: { id: 'default' }, data: { writesEnabled: false } });
    const readOnly = await incident('OPEN');
    expect((await snooze(readOnly))?.isError ?? true).toBe(true);
    expect(await statusOf(readOnly)).toBe('OPEN');
    await direct(false);
  });
});
