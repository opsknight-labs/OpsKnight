// @vitest-environment node
/**
 * Round 5 curated tools, over the real /mcp endpoint: oncall_now, the schedule/service/team
 * lookups, incident notes, postmortems, schedule overrides, available actions and incident_watch.
 * Snooze, suppress, unacknowledge and their kin stay approval-gated on purpose.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { disconnectPrisma } from '@/lib/prisma';
import { digestMcpSecret, mcpResource } from '@/lib/mcp/auth/config';
import { MCP_OPERATION_MAP, isMcpApprovalGated, isMcpExecutable } from '@/lib/mcp/catalog';
import { POST } from '@/app/mcp/route';
import {
  createTestIncident,
  createTestOnCallSchedule,
  createTestScheduleOverride,
  createTestService,
  createTestTeam,
  createTestUser,
  resetDatabase,
  testPrisma as db,
} from '../helpers/test-db';

const SCOPES = [
  'incidents:read',
  'incidents:write',
  'services:read',
  'schedules:read',
  'teams:read',
  'postmortems:read',
];

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
/** A refused call is a JSON-RPC error or a tool error result; either way it must not succeed. */
async function refusedCall(bearer: string, name: string, args: Record<string, unknown>) {
  const response = await POST(
    new Request(mcpResource(), {
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
            'io.modelcontextprotocol/clientInfo': { name: 'curated', version: '1' },
            'io.modelcontextprotocol/clientCapabilities': {},
          },
        },
      }),
    })
  );
  const json = await response.json();
  return Boolean(json.error) || Boolean(json.result?.isError) || response.status >= 400;
}
const key = () => `curated-${randomBytes(12).toString('hex')}`;
const data = (result: ToolResult) =>
  (result.structuredContent as { data: { data: Record<string, unknown> } }).data.data;

let admin: Awaited<ReturnType<typeof connect>>;
let outsider: Awaited<ReturnType<typeof connect>>;
let teammate: Awaited<ReturnType<typeof createTestUser>>;
let serviceId: string;
let teamServiceId: string;
let scheduleId: string;

beforeAll(async () => {
  process.env.MCP_DATABASE_URL = process.env.DATABASE_URL;
  process.env.MCP_DATABASE_POOL_SIZE = '2';
  process.env.MCP_PUBLIC_ORIGIN = 'http://localhost:3000';
  await resetDatabase();
  admin = await connect('ADMIN');
  outsider = await connect('USER');
  teammate = await createTestUser({ role: 'RESPONDER', name: 'Round five teammate' });
  serviceId = (await createTestService('Round five service')).id;
  // A team the outsider is not a member of: its incidents are outside their resource scope.
  const team = await createTestTeam('Round five team');
  teamServiceId = (await createTestService('Round five team service', team.id)).id;
  const schedule = await createTestOnCallSchedule('Round five schedule', [
    {
      start: new Date(Date.now() - 3 * 24 * 3600000),
      rotationLengthHours: 7 * 24,
      userIds: [teammate.id, admin.user.id],
    },
  ]);
  scheduleId = schedule.id;
  await createTestScheduleOverride(
    scheduleId,
    admin.user.id,
    new Date(Date.now() + 24 * 3600000),
    new Date(Date.now() + 30 * 3600000),
    teammate.id
  );
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

const READS: [string, string, string][] = [
  ['getOnCallNow', 'oncall_now', 'schedules:read'],
  ['listSchedules', 'schedule_list', 'schedules:read'],
  ['listServices', 'service_list', 'services:read'],
  ['listTeams', 'team_list', 'teams:read'],
  ['listIncidentNotes', 'incident_list_notes', 'incidents:read'],
  ['getPostmortem', 'postmortem_get', 'postmortems:read'],
  ['listPostmortems', 'postmortem_list', 'postmortems:read'],
  ['listScheduleOverrides', 'schedule_list_overrides', 'schedules:read'],
  ['getIncidentAvailableActions', 'incident_available_actions', 'incidents:read'],
];

describe('catalog disposition', () => {
  it.each(READS)('%s is the curated read-only tool %s', (operationId, tool, scope) => {
    const operation = MCP_OPERATION_MAP.get(operationId)!;
    expect(operation).toMatchObject({ status: 'CURATED', risk: 'R0', tool });
    expect(operation.requiredScopes).toContain(scope);
    expect(isMcpExecutable(operation)).toBe(true);
    expect(isMcpApprovalGated(operation)).toBe(false);
  });

  it('runs incident_watch directly (reviewed R1) and keeps the riskier neighbours gated', () => {
    const watch = MCP_OPERATION_MAP.get('setIncidentWatcher')!;
    expect(watch).toMatchObject({ status: 'CURATED', risk: 'R1', tool: 'incident_watch' });
    expect(isMcpExecutable(watch)).toBe(true);
    expect(isMcpApprovalGated(watch)).toBe(false);
    // Not downgraded by this round: each stays approval-gated.
    for (const operationId of [
      'snoozeIncident',
      'suppressIncident',
      'unsuppressIncident',
      'unacknowledgeIncident',
      'removeIncidentWatcher',
      'setIncidentCustomField',
      'createScheduleOverride',
      'createStatusPageAnnouncement',
    ]) {
      const operation = MCP_OPERATION_MAP.get(operationId)!;
      expect(isMcpApprovalGated(operation), operationId).toBe(true);
      expect(isMcpExecutable(operation), operationId).toBe(false);
      expect(operation.tool, operationId).toBeNull();
    }
  });

  it('lists incident_watch only while changes are allowed, and the reads always', async () => {
    const names = async () =>
      ((await rpc(admin.bearer, 'tools/list', {})).tools as { name: string }[]).map(
        tool => tool.name
      );
    expect(await names()).toEqual(
      expect.arrayContaining([...READS.map(([, tool]) => tool), 'incident_watch'])
    );
    await db.mcpPolicy.update({ where: { id: 'default' }, data: { writesEnabled: false } });
    const readOnly = await names();
    expect(readOnly).not.toContain('incident_watch');
    for (const [, tool] of READS) expect(readOnly).toContain(tool);
  });

  it('describes every new tool with a clear title and when to use it', async () => {
    const tools = (await rpc(admin.bearer, 'tools/list', {})).tools as {
      name: string;
      title?: string;
      description?: string;
      annotations?: { readOnlyHint?: boolean };
    }[];
    for (const [, tool] of [...READS, ['', 'incident_watch', '']]) {
      const entry = tools.find(candidate => candidate.name === tool)!;
      expect(entry.title, tool).toBeTruthy();
      expect(entry.description, tool).toMatch(/\bUse\b/);
      expect(entry.annotations?.readOnlyHint === true, tool).toBe(tool !== 'incident_watch');
    }
  });
});

describe('reads over /mcp', () => {
  it('lists schedules, services and teams with ids an assistant can pass on', async () => {
    const schedules = data(await call(admin.bearer, 'schedule_list', {})) as unknown as {
      id: string;
      name: string;
    }[];
    expect(schedules.map(row => row.id)).toContain(scheduleId);
    const services = data(await call(admin.bearer, 'service_list', {})) as unknown as {
      id: string;
    }[];
    expect(services.map(row => row.id)).toEqual(expect.arrayContaining([serviceId, teamServiceId]));
    const teams = data(await call(admin.bearer, 'team_list', {})) as unknown as { name: string }[];
    expect(teams.some(row => row.name.startsWith('Round five team'))).toBe(true);
  });

  it('says who is on call now and next, by name only, with the real shift edges', async () => {
    const result = data(
      await call(admin.bearer, 'oncall_now', { query: { scope: 'all' } })
    ) as unknown as {
      iAmOnCall: boolean;
      gaps: number;
      schedules: {
        scheduleId: string;
        onCall: { userId: string; name: string | null; start: string; startClamped: boolean }[];
        next: { userId: string } | null;
        gap: boolean;
      }[];
    };
    const row = result.schedules.find(entry => entry.scheduleId === scheduleId)!;
    expect(row.gap).toBe(false);
    expect(row.onCall).toHaveLength(1);
    // Weekly rotation that began three days ago: the real start, not a window edge.
    expect(Math.round((Date.now() - Date.parse(row.onCall[0]!.start)) / 3600000 / 24)).toBe(3);
    expect(row.onCall[0]!.startClamped).toBe(false);
    expect(row.next).not.toBeNull();
    const text = JSON.stringify(result);
    expect(text).not.toContain('@');
    expect(text).not.toMatch(/email|phone/i);
  });

  it('lists overrides, notes and the actions available on an incident', async () => {
    const overrides = data(
      await call(admin.bearer, 'schedule_list_overrides', { path: { id: scheduleId } })
    ) as unknown as unknown[];
    expect(overrides.length).toBeGreaterThanOrEqual(1);
    const id = (await createTestIncident('Round five incident', serviceId)).id;
    await db.incidentNote.create({ data: { incidentId: id, content: 'Looking at the pool.' } });
    const notes = data(
      await call(admin.bearer, 'incident_list_notes', { path: { id } })
    ) as unknown as { content: string }[];
    expect(notes.map(note => note.content)).toContain('Looking at the pool.');
    const actions = await call(admin.bearer, 'incident_available_actions', { path: { id } });
    expect(actions.isError).toBeFalsy();
  });
});

describe('incident_watch', () => {
  it('adds a watcher once, audited, and an outsider cannot watch what they cannot read', async () => {
    const id = (await createTestIncident('Watch me', serviceId)).id;
    const first = await call(admin.bearer, 'incident_watch', {
      path: { id },
      body: { userId: teammate.id },
      idempotencyKey: key(),
    });
    expect(first.isError).toBeFalsy();
    expect(await db.incidentWatcher.count({ where: { incidentId: id, userId: teammate.id } })).toBe(
      1
    );
    expect(
      await db.auditLog.count({ where: { entityId: id, action: 'incident.watcher.updated' } })
    ).toBeGreaterThanOrEqual(1);

    const hidden = (await createTestIncident('Not yours', teamServiceId)).id;
    expect(
      await refusedCall(outsider.bearer, 'incident_watch', {
        path: { id: hidden },
        body: { userId: outsider.user.id },
        idempotencyKey: key(),
      })
    ).toBe(true);
    expect(await db.incidentWatcher.count({ where: { incidentId: hidden } })).toBe(0);
  });

  it('is refused while changes are off', async () => {
    await db.mcpPolicy.update({ where: { id: 'default' }, data: { writesEnabled: false } });
    const id = (await createTestIncident('Writes off', serviceId)).id;
    expect(
      await refusedCall(admin.bearer, 'incident_watch', {
        path: { id },
        body: { userId: teammate.id },
        idempotencyKey: key(),
      })
    ).toBe(true);
    expect(await db.incidentWatcher.count({ where: { incidentId: id } })).toBe(0);
  });
});
