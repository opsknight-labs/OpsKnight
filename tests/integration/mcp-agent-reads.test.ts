/**
 * Reads an assistant answers the common on-call questions with, through the real MCP route:
 * "what is open right now", "summarize this incident", "who is on call for X", and ChatGPT's
 * search/fetch pair.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { disconnectPrisma } from '@/lib/prisma';
import { digestMcpSecret, mcpResource } from '@/lib/mcp/auth/config';
import { POST } from '@/app/mcp/route';
import {
  createTestEscalationPolicy,
  createTestIncident,
  createTestOnCallSchedule,
  createTestService,
  createTestTeam,
  createTestUser,
  resetDatabase,
  testPrisma as db,
} from '../helpers/test-db';

const SCOPES = [
  'incidents:read',
  'services:read',
  'schedules:read',
  'escalation-policies:read',
  'runbooks:read',
];

async function connect(role: 'ADMIN' | 'USER') {
  const user = await createTestUser({ role, name: `Reader ${role}` });
  const client = await db.mcpClient.create({
    data: { name: `Reads ${role}`, redirectUris: ['http://localhost/callback'], scopes: SCOPES },
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
  content: Record<string, unknown>[];
  structuredContent?: Record<string, unknown>;
};
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
        id: 1,
        method,
        params: {
          ...params,
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2026-07-28',
            'io.modelcontextprotocol/clientInfo': { name: 'reads', version: '1' },
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
const rows = (result: ToolResult) =>
  (result.structuredContent as { data: { data: { id: string; status?: string }[] } }).data.data;
const toolNames = async (bearer: string) =>
  ((await rpc(bearer, 'tools/list')).tools as { name: string }[]).map(tool => tool.name);

let admin: Awaited<ReturnType<typeof connect>>;
let outsider: Awaited<ReturnType<typeof connect>>;
let serviceId: string;
let teamIncidentId: string;
const created = new Map<string, string>();
const ids = {} as Record<'open' | 'acked' | 'snoozed' | 'resolved' | 'old', string>;
let oncallUserId: string;
let nextUserId: string;
let shiftEnd: Date;

beforeAll(async () => {
  process.env.MCP_DATABASE_URL = process.env.DATABASE_URL;
  process.env.MCP_DATABASE_POOL_SIZE = '2';
  process.env.MCP_PUBLIC_ORIGIN = 'http://localhost:3000';
  await resetDatabase();
  admin = await connect('ADMIN');
  outsider = await connect('USER');
  const first = await createTestUser({ name: 'Current responder' });
  const second = await createTestUser({ name: 'Next responder' });
  oncallUserId = first.id;
  nextUserId = second.id;
  // A 24-hour rotation that started an hour ago: the first responder hands over in 23 hours.
  const start = new Date(Date.now() - 3600000);
  shiftEnd = new Date(start.getTime() + 24 * 3600000);
  const schedule = await createTestOnCallSchedule('Primary', [
    { start, rotationLengthHours: 24, userIds: [first.id, second.id] },
  ]);
  const policy = await createTestEscalationPolicy('Reads policy', [
    { stepOrder: 0, delayMinutes: 0, targetType: 'SCHEDULE', targetScheduleId: schedule.id },
    { stepOrder: 1, delayMinutes: 15, targetType: 'USER', targetUserId: admin.user.id },
  ]);
  serviceId = (await createTestService('Checkout', null, { escalationPolicyId: policy.id })).id;
  const day = 24 * 3600000;
  for (const [name, status, ageDays] of [
    ['open', 'OPEN', 0],
    ['acked', 'ACKNOWLEDGED', 0],
    ['snoozed', 'SNOOZED', 0],
    ['resolved', 'RESOLVED', 0],
    ['old', 'OPEN', 10],
  ] as const)
    created.set(
      name,
      (
        await createTestIncident(`Checkout ${name} incident`, serviceId, {
          status,
          createdAt: new Date(Date.now() - ageDays * day),
          ...(status === 'SNOOZED' ? { snoozedUntil: new Date(Date.now() + 3600000) } : {}),
        })
      ).id
    );
  Object.assign(ids, Object.fromEntries(created));
  await db.incidentNote.create({
    data: { incidentId: ids.open, userId: admin.user.id, content: 'Rolled back the canary.' },
  });
  const team = await createTestTeam('Private team');
  const teamService = await createTestService('Team only', team.id);
  teamIncidentId = (await createTestIncident('Team only incident', teamService.id)).id;
}, 60000);

beforeEach(async () => {
  await db.mcpPolicy.upsert({
    where: { id: 'default' },
    create: { enabled: true, writesEnabled: false, requestsPerMinute: 6000 },
    update: {
      enabled: true,
      writesEnabled: false,
      requestsPerMinute: 6000,
      disabledCapabilities: [],
    },
  });
});

afterAll(async () => {
  await disconnectPrisma();
  await db.$disconnect();
});

describe('incident_search filters', () => {
  it('ACTIVE means every unresolved status, and a comma list is a set', async () => {
    const active = await call(admin.bearer, 'incident_search', { query: { status: 'ACTIVE' } });
    expect(active.isError, JSON.stringify(active)).not.toBe(true);
    expect(
      rows(active)
        .map(row => row.id)
        .sort()
    ).toEqual([ids.open, ids.acked, ids.snoozed, ids.old, teamIncidentId].sort());
    const some = await call(admin.bearer, 'incident_search', {
      query: { status: 'ACKNOWLEDGED,SNOOZED' },
    });
    expect(
      rows(some)
        .map(row => row.id)
        .sort()
    ).toEqual([ids.acked, ids.snoozed].sort());
    const invalid = await call(admin.bearer, 'incident_search', { query: { status: 'OPEN,NOPE' } });
    expect(invalid.isError).toBe(true);
  });

  it('bounds results by creation time', async () => {
    const after = new Date(Date.now() - 5 * 24 * 3600000).toISOString();
    const recent = await call(admin.bearer, 'incident_search', {
      query: { status: 'OPEN', createdAfter: after },
    });
    expect(rows(recent).map(row => row.id)).not.toContain(ids.old);
    expect(rows(recent).map(row => row.id)).toContain(ids.open);
    const older = await call(admin.bearer, 'incident_search', {
      query: { createdBefore: after },
    });
    expect(rows(older).map(row => row.id)).toEqual([ids.old]);
  });

  it('gives a list one web URL template and links to the first rows', async () => {
    const result = await call(admin.bearer, 'incident_search', { query: { limit: 3 } });
    const evidence = (result.structuredContent as { evidence: Record<string, unknown> }).evidence;
    expect(evidence.webUrlTemplate).toBe('http://localhost:3000/incidents/{id}');
    const links = result.content.filter(block => block.type === 'resource_link');
    expect(links).toHaveLength(3);
    expect(links[0]).toMatchObject({
      uri: `http://localhost:3000/incidents/${rows(result)[0].id}`,
      annotations: { audience: ['user'] },
    });
    // Rows themselves stay exactly the REST shape: no per-row URL.
    expect(rows(result)[0]).not.toHaveProperty('webUrl');
  });
});

describe('incident_get_context', () => {
  it('includes escalation, SLA and recent notes', async () => {
    const nextAt = new Date(Date.now() + 600000);
    await db.incident.update({
      where: { id: ids.open },
      data: {
        currentEscalationStep: 1,
        escalationStatus: 'ESCALATING',
        nextEscalationAt: nextAt,
        slaAckTargetMs: 900000,
      },
    });
    const result = await call(admin.bearer, 'incident_get_context', { id: ids.open });
    expect(result.isError, JSON.stringify(result)).not.toBe(true);
    const context = result.structuredContent as Record<
      string,
      { data: { data: unknown }; evidence: { operationId: string } }
    >;
    expect(context.notes.evidence.operationId).toBe('listIncidentNotes');
    expect(JSON.stringify(context.notes.data)).toContain('Rolled back the canary.');
    const incident = context.incident.data.data as Record<string, unknown>;
    expect(incident.sla).toMatchObject({ ackTargetMs: 900000, pausedMs: 0 });
    expect(incident.escalation).toEqual({
      step: 1,
      status: 'ESCALATING',
      nextAt: nextAt.toISOString(),
    });
    expect(incident).not.toHaveProperty('escalationGeneration');
  });

  it('leaves out notes when notes are not readable through this connection', async () => {
    await db.mcpPolicy.update({
      where: { id: 'default' },
      data: { disabledCapabilities: ['listIncidentNotes'] },
    });
    const result = await call(admin.bearer, 'incident_get_context', { id: ids.open });
    expect(result.isError, JSON.stringify(result)).not.toBe(true);
    expect(result.structuredContent).not.toHaveProperty('notes');
    expect(result.structuredContent).toHaveProperty('timeline');
  });
});

describe('oncall_for_service', () => {
  it('answers who is on call, until when, and who is next, in one call', async () => {
    const result = await call(admin.bearer, 'oncall_for_service', { serviceId });
    expect(result.isError, JSON.stringify(result)).not.toBe(true);
    const answer = result.structuredContent as {
      steps: { index: number; delayMinutes: number; target: Record<string, unknown> }[];
    };
    expect(answer.steps).toHaveLength(2);
    const schedule = answer.steps[0].target as {
      type: string;
      onCallUsers: { id: string; shiftEndsAt: string }[];
      next: { userId: string; start: string };
    };
    expect(schedule.type).toBe('SCHEDULE');
    expect(schedule.onCallUsers.map(user => user.id)).toEqual([oncallUserId]);
    expect(Date.parse(schedule.onCallUsers[0].shiftEndsAt)).toBe(shiftEnd.getTime());
    expect(schedule.next).toMatchObject({ userId: nextUserId });
    expect(Date.parse(schedule.next.start)).toBe(shiftEnd.getTime());
    expect(answer.steps[1]).toMatchObject({
      delayMinutes: 15,
      target: { type: 'USER', id: admin.user.id },
    });
  });

  it('adds the shift end to oncall_lookup itself', async () => {
    const service = await db.service.findUniqueOrThrow({
      where: { id: serviceId },
      include: { policy: { include: { steps: true } } },
    });
    const scheduleId = service.policy!.steps.find(step => step.targetScheduleId)!.targetScheduleId!;
    const result = await call(admin.bearer, 'oncall_lookup', { path: { id: scheduleId } });
    const data = (
      result.structuredContent as {
        data: { data: { onCallUsers: { shiftEndsAt: string }[]; next: unknown } };
      }
    ).data.data;
    expect(Date.parse(data.onCallUsers[0].shiftEndsAt)).toBe(shiftEnd.getTime());
    expect(data.next).toMatchObject({ userId: nextUserId });
  });
});

describe('search and fetch', () => {
  it('searches what the connection can read and returns typed ids with links', async () => {
    const result = await call(admin.bearer, 'search', { query: 'Checkout' });
    expect(result.isError, JSON.stringify(result)).not.toBe(true);
    const { results } = result.structuredContent as {
      results: { id: string; title: string; url: string }[];
    };
    expect(results.map(item => item.id)).toEqual(
      expect.arrayContaining([`incident:${ids.open}`, `service:${serviceId}`])
    );
    expect(results.find(item => item.id === `incident:${ids.open}`)).toMatchObject({
      title: 'Checkout open incident',
      url: `http://localhost:3000/incidents/${ids.open}`,
    });
    expect(JSON.parse(result.content[0].text as string)).toEqual(result.structuredContent);
  });

  it('fetches a result as markdown, re-checking access for the id', async () => {
    const result = await call(admin.bearer, 'fetch', { id: `incident:${ids.open}` });
    expect(result.isError, JSON.stringify(result)).not.toBe(true);
    const document = result.structuredContent as Record<string, unknown>;
    expect(document).toMatchObject({
      id: `incident:${ids.open}`,
      title: 'Checkout open incident',
      url: `http://localhost:3000/incidents/${ids.open}`,
      metadata: { type: 'incident', status: 'OPEN' },
    });
    expect(document.text).toMatch(/^# Checkout open incident/);
    expect(document.text).toContain('Rolled back the canary.');
    // An id that appeared nowhere for this person is still refused, whatever its form.
    const hidden = await call(outsider.bearer, 'fetch', { id: `incident:${teamIncidentId}` });
    expect(hidden.isError).toBe(true);
    expect(hidden.content[0].text).toMatch(/^MCP_RESOURCE_UNAVAILABLE/);
    const unknown = await call(admin.bearer, 'fetch', { id: `secret:${ids.open}` });
    expect(unknown.isError).toBe(true);
    expect(unknown.content[0].text).toMatch(/^MCP_INVALID_ARGUMENTS/);
  });

  it('never returns a source the person cannot read', async () => {
    const result = await call(outsider.bearer, 'search', { query: 'Team only' });
    const { results } = result.structuredContent as { results: { id: string }[] };
    expect(results.map(item => item.id)).not.toContain(`incident:${teamIncidentId}`);
  });

  it('is on by default and can be turned off by an administrator', async () => {
    expect(await toolNames(admin.bearer)).toEqual(expect.arrayContaining(['search', 'fetch']));
    await db.mcpPolicy.update({
      where: { id: 'default' },
      data: { disabledCapabilities: ['search', 'fetch'] },
    });
    const names = await toolNames(admin.bearer);
    expect(names).not.toContain('search');
    expect(names).not.toContain('fetch');
  });
});
