// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { GET as myShiftsRoute } from '@/app/api/v2/users/me/on-call-shifts/route';
import { describe, expect, it } from 'vitest';
import { MCP_OPERATION_MAP, isMcpExecutable, isMcpSensitiveRead } from '@/lib/mcp/catalog';
import { callMcpOperation } from '@/lib/mcp/core/execution';
import {
  describeSensitiveReads,
  principal,
  setupMcpReadDatabase,
  unredactedSensitiveKeys,
} from '../helpers/mcp-read-scenarios';
import {
  createTestOnCallSchedule,
  createTestScheduleOverride,
  createTestService,
  createTestTeam,
  createTestUser,
  testPrisma as db,
} from '../helpers/test-db';

setupMcpReadDatabase();

const unique = () => randomUUID().slice(0, 8);
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const refused = (promise: Promise<unknown>) =>
  promise.then(
    () => 'allowed',
    (error: Error) => error.message
  );
type Envelope<T> = { data: { data: T } };

describe('user directory (listUsers, getUser)', () => {
  async function colleague() {
    const email = `private-${unique()}@corp.example`;
    const user = await createTestUser({
      name: `Colleague ${unique()}`,
      email,
      role: 'RESPONDER',
      department: 'Payments',
      jobTitle: 'Staff engineer',
      phoneNumber: '+15555550100',
    });
    const team = await createTestTeam('Directory team');
    await db.teamMember.create({ data: { teamId: team.id, userId: user.id } });
    return { user, team, email };
  }

  it('is a reviewed, directly usable read', () => {
    for (const id of ['listUsers', 'getUser']) {
      const operation = MCP_OPERATION_MAP.get(id)!;
      expect(operation).toMatchObject({ status: 'DISCOVERABLE', risk: 'R0', tool: null });
      expect(isMcpExecutable(operation)).toBe(true);
    }
  });

  it('returns only id, name, role, status and teams, never contact or profile details', async () => {
    const { user, team, email } = await colleague();
    const caller = await principal('RESPONDER', ['users:read']);
    const list = (await callMcpOperation(caller.ctx(), 'listUsers', {
      query: { search: user.name!, limit: 5 },
    })) as Envelope<Record<string, unknown>[]>;
    expect(list.data.data).toHaveLength(1);
    expect(list.data.data[0]).toEqual({
      id: user.id,
      name: user.name,
      role: 'RESPONDER',
      status: 'ACTIVE',
      teams: [{ id: team.id, name: team.name }],
    });
    const one = (await callMcpOperation(caller.ctx(), 'getUser', {
      path: { id: user.id },
    })) as Envelope<Record<string, unknown>>;
    expect(Object.keys(one.data.data).sort()).toEqual(['id', 'name', 'role', 'status', 'teams']);
    for (const result of [list, one]) {
      const text = JSON.stringify(result);
      for (const secret of [email, 'Payments', 'Staff engineer', '+15555550100'])
        expect(text).not.toContain(secret);
      expect(text).not.toMatch(/"(?:email|phoneNumber|department|jobTitle|timeZone)"/);
      expect(unredactedSensitiveKeys(result.data)).toEqual([]);
    }
  });

  it('refuses a role without user.read and a connection without users:read', async () => {
    const { user } = await colleague();
    const member = await principal('USER', ['users:read']);
    expect(
      await refused(callMcpOperation(member.ctx(), 'getUser', { path: { id: user.id } }))
    ).toBe('MCP_OPERATION_FORBIDDEN');
    const admin = await principal('ADMIN', ['schedules:read']);
    expect(await refused(callMcpOperation(admin.ctx(), 'listUsers', {}))).toBe(
      'MCP_SCOPE_NOT_GRANTED'
    );
  });
});

describeSensitiveReads([
  {
    name: 'audit log',
    operationId: 'listAuditLogs',
    async setup(owner) {
      const entityId = `audit-${unique()}`;
      await db.auditLog.create({
        data: {
          action: 'service.updated',
          entityType: 'SERVICE',
          entityId,
          actorId: owner.id,
          actorEmail: 'auditor-target@corp.example',
          actorName: 'Owner',
          ip: '203.0.113.7',
          details: { field: 'name', notifyEmail: 'someone@corp.example' },
        },
      });
      return { query: { entityId, limit: 5 } };
    },
  },
]);

describe('audit log read (listAuditLogs)', () => {
  async function entry() {
    const owner = await createTestUser({ role: 'ADMIN' });
    const entityId = `audit-${unique()}`;
    await db.auditLog.create({
      data: {
        action: 'team.updated',
        entityType: 'TEAM',
        entityId,
        actorId: owner.id,
        actorEmail: 'actor-private@corp.example',
        actorName: 'Audit Owner',
        ip: '198.51.100.23',
        details: { changed: ['name'], contactEmail: 'hidden@corp.example' },
      },
    });
    return { entityId, owner };
  }

  it('is a sensitive read for Administrators and Auditors that drops actor email and IP', async () => {
    expect(isMcpSensitiveRead(MCP_OPERATION_MAP.get('listAuditLogs')!)).toBe(true);
    const { entityId, owner } = await entry();
    for (const role of ['ADMIN', 'AUDITOR'] as const) {
      const caller = await principal(role, ['audit:read']);
      const result = (await callMcpOperation(caller.ctx(), 'listAuditLogs', {
        query: { entityId },
      })) as Envelope<Record<string, unknown>[]>;
      expect(result.data.data).toHaveLength(1);
      const row = result.data.data[0];
      expect(row).toMatchObject({ action: 'team.updated', actorId: owner.id, entityId });
      expect(row).not.toHaveProperty('ip');
      expect(row).not.toHaveProperty('actorEmail');
      const text = JSON.stringify(result);
      for (const secret of ['198.51.100.23', 'actor-private@corp.example', 'hidden@corp.example'])
        expect(text, role).not.toContain(secret);
    }
  });

  it('refuses Responders and Users, and a connection without audit:read', async () => {
    const { entityId } = await entry();
    for (const role of ['RESPONDER', 'USER'] as const) {
      const caller = await principal(role, ['audit:read']);
      expect(
        await refused(callMcpOperation(caller.ctx(), 'listAuditLogs', { query: { entityId } })),
        role
      ).toBe('MCP_OPERATION_FORBIDDEN');
    }
    const admin = await principal('ADMIN', ['users:read']);
    expect(await refused(callMcpOperation(admin.ctx(), 'listAuditLogs', {}))).toBe(
      'MCP_SCOPE_NOT_GRANTED'
    );
  });
});

describe('integration health (getIntegrationDiagnostics)', () => {
  async function integration() {
    const team = await createTestTeam('Integration team');
    const service = await createTestService('Integration service', team.id);
    const row = await db.integration.create({
      data: {
        name: `Webhook ${unique()}`,
        key: `key-${randomUUID()}`,
        signatureSecret: 'signing-secret-value',
        serviceId: service.id,
      },
    });
    return { row, team };
  }

  it('returns health and delivery outcomes without configuration or secrets', async () => {
    const { row } = await integration();
    const caller = await principal('RESPONDER', ['integrations:read']);
    const result = (await callMcpOperation(caller.ctx(), 'getIntegrationDiagnostics', {
      path: { id: row.id },
    })) as Envelope<Record<string, unknown>>;
    expect(result.data.data).toMatchObject({
      id: row.id,
      enabled: true,
      configurationState: 'ENABLED',
      deliveryCounts: { recent: 0, failed: 0, processing: 0 },
    });
    const text = JSON.stringify(result);
    for (const secret of [row.key, 'signing-secret-value', row.name])
      expect(text).not.toContain(secret);
  });

  it('hides another team’s integration from a team-scoped user', async () => {
    const { row } = await integration();
    const outsider = await principal('USER', ['integrations:read']);
    expect(
      await refused(
        callMcpOperation(outsider.ctx(), 'getIntegrationDiagnostics', { path: { id: row.id } })
      )
    ).not.toBe('allowed');
  });
});

describe('my on-call shifts (listMyOnCallShifts, oncall_my_shifts)', () => {
  type Shifts = {
    userId: string;
    onCallNow: boolean;
    nextHandoff: { at: string; change: string; scheduleId: string } | null;
    shifts: {
      scheduleId: string;
      scheduleName: string;
      scheduleTimeZone: string;
      start: string;
      end: string;
      current: boolean;
      handoffTo: { userId: string; name: string | null } | null;
    }[];
    truncated: boolean;
  };

  it('is the curated read-only tool oncall_my_shifts', () => {
    const operation = MCP_OPERATION_MAP.get('listMyOnCallShifts')!;
    expect(operation).toMatchObject({ status: 'CURATED', risk: 'R0', tool: 'oncall_my_shifts' });
    expect(operation.requiredScopes).toEqual(['schedules:read']);
  });

  it('lists the caller’s current and upcoming shifts across schedules with handoffs', async () => {
    const caller = await principal('USER', ['schedules:read']);
    const other = await createTestUser({ name: `Partner ${unique()}` });
    const start = new Date(Date.now() - HOUR);
    const primary = await createTestOnCallSchedule('Primary', [
      { start, rotationLengthHours: 24, userIds: [caller.user.id, other.id] },
    ]);
    await db.onCallSchedule.update({
      where: { id: primary.id },
      data: { timeZone: 'Europe/Berlin' },
    });
    const secondary = await createTestOnCallSchedule('Secondary', [
      { start, rotationLengthHours: 24, userIds: [other.id] },
    ]);
    // An override puts the caller on the secondary schedule in three days.
    const overrideStart = new Date(start.getTime() + 3 * DAY);
    await createTestScheduleOverride(
      secondary.id,
      caller.user.id,
      overrideStart,
      new Date(overrideStart.getTime() + 6 * HOUR),
      other.id
    );
    const unrelated = await createTestOnCallSchedule('Unrelated', [
      { start, rotationLengthHours: 24, userIds: [other.id] },
    ]);

    const result = (await callMcpOperation(caller.ctx(), 'listMyOnCallShifts', {
      query: { days: 7 },
    })) as Envelope<Shifts>;
    const data = result.data.data;
    expect(data.userId).toBe(caller.user.id);
    expect(data.onCallNow).toBe(true);
    expect(data.truncated).toBe(false);
    const ids = new Set(data.shifts.map(shift => shift.scheduleId));
    expect(ids).toEqual(new Set([primary.id, secondary.id]));
    expect(ids.has(unrelated.id)).toBe(false);
    const current = data.shifts.find(shift => shift.current)!;
    expect(current).toMatchObject({
      scheduleId: primary.id,
      scheduleTimeZone: 'Europe/Berlin',
      start: start.toISOString(),
      end: new Date(start.getTime() + DAY).toISOString(),
      handoffTo: { userId: other.id, name: other.name },
    });
    expect(data.nextHandoff).toMatchObject({
      change: 'SHIFT_ENDS',
      at: current.end,
      scheduleId: primary.id,
    });
    const override = data.shifts.find(shift => shift.scheduleId === secondary.id)!;
    expect(override).toMatchObject({
      start: overrideStart.toISOString(),
      current: false,
      handoffTo: { userId: other.id },
    });
    // Ordered by start, inside the window, every other day on the primary rotation.
    const starts = data.shifts.map(shift => shift.start);
    expect([...starts].sort()).toEqual(starts);
    expect(data.shifts.every(shift => Date.parse(shift.start) < Date.now() + 7 * DAY)).toBe(true);
    expect(data.shifts.filter(shift => shift.scheduleId === primary.id)).toHaveLength(4);
  });

  it('bounds the window and the count, and reports truncation', async () => {
    const caller = await principal('RESPONDER', ['schedules:read']);
    const other = await createTestUser();
    await createTestOnCallSchedule('Bounded', [
      {
        start: new Date(Date.now() - HOUR),
        rotationLengthHours: 24,
        userIds: [caller.user.id, other.id],
      },
    ]);
    const limited = (await callMcpOperation(caller.ctx(), 'listMyOnCallShifts', {
      query: { days: 30, limit: 2 },
    })) as Envelope<Shifts>;
    expect(limited.data.data.shifts).toHaveLength(2);
    expect(limited.data.data.truncated).toBe(true);
    for (const query of [{ days: 31 }, { days: 0 }, { limit: 51 }])
      expect(await refused(callMcpOperation(caller.ctx(), 'listMyOnCallShifts', { query }))).toBe(
        'MCP_INVALID_ARGUMENTS'
      );
  });

  it('returns nothing for someone on no schedule and refuses without schedules:read', async () => {
    const idle = await principal('AUDITOR', ['schedules:read']);
    const empty = (await callMcpOperation(
      idle.ctx(),
      'listMyOnCallShifts',
      {}
    )) as Envelope<Shifts>;
    expect(empty.data.data).toMatchObject({ onCallNow: false, nextHandoff: null, shifts: [] });
    const noScope = await principal('ADMIN', ['incidents:read']);
    expect(await refused(callMcpOperation(noScope.ctx(), 'listMyOnCallShifts', {}))).toBe(
      'MCP_SCOPE_NOT_GRANTED'
    );
  });

  it('serves the same read over REST v2 with schedules:read, and validates the window', async () => {
    const get = (token: string, query = '') =>
      myShiftsRoute(
        new NextRequest(`http://localhost/api/v2/users/me/on-call-shifts${query}`, {
          headers: { authorization: `Bearer ${token}` },
        })
      );
    const caller = await principal('USER', ['schedules:read']);
    const ok = await get(caller.restToken, '?days=3');
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { data: { userId: string } }).data.userId).toBe(caller.user.id);
    expect((await get(caller.restToken, '?days=45')).status).toBe(400);
    const noScope = await principal('USER', ['incidents:read']);
    expect((await get(noScope.restToken)).status).toBe(403);
  });
});
