import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createV2Credential, invokeV2 } from '../helpers/api-v2';
import {
  createTestService,
  createTestTeam,
  resetDatabase,
  testPrisma as db,
} from '../helpers/test-db';
import { INTELLIGENCE_SETTINGS_DEFAULTS } from '@/lib/intelligence/contract';
import { ConnectorError } from '@/lib/intelligence/connectors/http';
import type { RawSeries, TimeWindow } from '@/lib/intelligence/connectors/normalize';
import { POST as createObjective } from '@/app/api/v2/service-objectives/route';
import {
  GET as readPolicy,
  PUT as writePolicy,
} from '@/app/api/v2/service-objectives/[id]/alert-policy/route';
import { GET as readHistory } from '@/app/api/v2/service-objectives/[id]/burn-history/route';
import { evaluateSloPolicy, type SloSeriesFetcher } from '@/lib/slo/burn-alerts/evaluate';
import { scheduleSloEvaluationsIfDue, testSloAlertQueries } from '@/lib/slo/burn-alerts/service';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  await resetDatabase();
});

const STEP = 300_000;
const settings = { maxDbMs: 30_000 };
const never = new AbortController().signal;
const scopes = ['service-objectives:read', 'service-objectives:write'];
const key = () => ({ 'Idempotency-Key': crypto.randomUUID() });
// A whole step in the recent past, plus the settle delay, so `end` is exactly this step boundary.
const BASE = Math.floor(Date.now() / STEP) * STEP - 20 * STEP;
const at = (steps: number) => new Date(BASE + 60_000 + steps * STEP);

async function connection(allowedTeamIds: string[] = []) {
  return db.observabilityConnection.create({
    data: {
      name: `prom-${Math.random().toString(36).slice(2, 8)}`,
      kind: 'PROMETHEUS',
      baseUrl: 'https://prom.example.com',
      enabled: true,
      allowedTeamIds,
      timeoutMs: 1_000,
    },
  });
}

async function fixture(metricType = 'UPTIME', teamId: string | null = null) {
  const credential = await createV2Credential(scopes);
  const service = await createTestService('Checkout', teamId);
  const response = await invokeV2(
    createObjective,
    credential.token,
    'POST',
    '/service-objectives',
    {},
    {
      definition: {
        serviceId: service.id,
        name: 'Checkout availability',
        metricType,
        target: metricType === 'UPTIME' ? 99.9 : 30,
        comparator: metricType === 'UPTIME' ? 'GREATER_THAN_OR_EQUAL' : 'LESS_THAN_OR_EQUAL',
        windowType: 'THIRTY_DAYS',
      },
      expectedActiveVersionId: null,
    },
    key()
  );
  expect(response.status).toBe(201);
  const objective = (await response.json()).data as { id: string };
  return { credential, service, objectiveId: objective.id };
}

const policyBody = (connectionId: string, enabled = true) => ({
  connectionId,
  goodQuery: 'sum(increase(http_requests_total{code!~"5.."}[5m]))',
  totalQuery: 'sum(increase(http_requests_total[5m]))',
  enabled,
});

async function enabledPolicy(teamId: string | null = null) {
  const base = await fixture('UPTIME', teamId);
  const conn = await connection();
  const response = await invokeV2(
    writePolicy,
    base.credential.token,
    'PUT',
    `/service-objectives/${base.objectiveId}/alert-policy`,
    { id: base.objectiveId },
    policyBody(conn.id),
    key()
  );
  expect(response.status).toBe(200);
  const policy = await db.sloAlertPolicy.findUniqueOrThrow({
    where: { lineageId: base.objectiveId },
  });
  return { ...base, conn, policy };
}

/**
 * A fake connector: 1000 events per step, `errorRate(stepEnd)` of them bad. Records every window asked for,
 * and which query (good or total) asked.
 */
function fakeConnector(errorRate: (stepEnd: number) => number) {
  const calls: Array<{ query: string; window: TimeWindow }> = [];
  const fetchSeries: SloSeriesFetcher = async (_connection, query) => {
    calls.push({ query: query.query, window: query.window });
    const good = query.query.includes('code!~');
    const points: Array<[number, number]> = [];
    for (let t = query.window.start.getTime(); t <= query.window.end.getTime(); t += STEP)
      points.push([t, good ? 1000 * (1 - errorRate(t)) : 1000]);
    return [{ labels: {}, points }] satisfies RawSeries[];
  };
  return { calls, fetchSeries };
}

describe('alert-policy route contract', () => {
  it('saves a policy (off by default), reads it back and validates the objective and connection', async () => {
    const { credential, objectiveId, service } = await fixture();
    const path = `/service-objectives/${objectiveId}/alert-policy`;
    const missing = await invokeV2(readPolicy, credential.token, 'GET', path, { id: objectiveId });
    expect(missing.status).toBe(404);

    const conn = await connection();
    const body = { ...policyBody(conn.id), enabled: undefined };
    const unkeyed = await invokeV2(
      writePolicy,
      credential.token,
      'PUT',
      path,
      { id: objectiveId },
      body
    );
    expect(unkeyed.status).toBeGreaterThanOrEqual(400);
    const saved = await invokeV2(
      writePolicy,
      credential.token,
      'PUT',
      path,
      { id: objectiveId },
      body,
      key()
    );
    expect(saved.status).toBe(200);
    expect((await saved.json()).data).toMatchObject({
      objectiveId,
      serviceId: service.id,
      connectionId: conn.id,
      connectionName: conn.name,
      enabled: false,
      ticketsEnabled: true,
      state: 'OK',
      stepSeconds: 300,
      lastEvaluatedAt: null,
    });
    const read = await invokeV2(readPolicy, credential.token, 'GET', path, { id: objectiveId });
    expect(read.status).toBe(200);
    expect((await read.json()).data.goodQuery).toBe(body.goodQuery);
    expect(
      await db.auditLog.count({ where: { action: 'service_objective.alert_policy.created' } })
    ).toBe(1);

    const unknownField = await invokeV2(
      writePolicy,
      credential.token,
      'PUT',
      path,
      { id: objectiveId },
      { ...body, threshold: 3 },
      key()
    );
    expect(unknownField.status).toBe(400);

    const disabled = await db.observabilityConnection.create({
      data: { name: 'off', kind: 'PROMETHEUS', baseUrl: 'https://p.example.com', enabled: false },
    });
    const rejected = await invokeV2(
      writePolicy,
      credential.token,
      'PUT',
      path,
      { id: objectiveId },
      policyBody(disabled.id),
      key()
    );
    expect(rejected.status).toBe(400);
    expect(JSON.stringify(await rejected.json())).toContain('Enable the connection first');
  });

  it('refuses objectives that are not service availability or uptime, and connections outside the team', async () => {
    const mtta = await fixture('MTTA');
    const conn = await connection();
    const response = await invokeV2(
      writePolicy,
      mtta.credential.token,
      'PUT',
      `/service-objectives/${mtta.objectiveId}/alert-policy`,
      { id: mtta.objectiveId },
      policyBody(conn.id),
      key()
    );
    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).toContain('availability and uptime');

    const team = await createTestTeam('Payments');
    const other = await createTestTeam('Search');
    const scoped = await fixture('UPTIME', team.id);
    const narrow = await connection([other.id]);
    const outside = await invokeV2(
      writePolicy,
      scoped.credential.token,
      'PUT',
      `/service-objectives/${scoped.objectiveId}/alert-policy`,
      { id: scoped.objectiveId },
      policyBody(narrow.id),
      key()
    );
    expect(outside.status).toBe(400);
    expect(JSON.stringify(await outside.json())).toContain("not allowed for this service's team");
  });

  it('lets a responder read but not write, and needs the write scope', async () => {
    const { objectiveId, conn } = await enabledPolicy();
    const path = `/service-objectives/${objectiveId}/alert-policy`;
    const responder = await createV2Credential(scopes, 'RESPONDER');
    expect(
      (await invokeV2(readPolicy, responder.token, 'GET', path, { id: objectiveId })).status
    ).toBe(200);
    expect(
      (
        await invokeV2(
          writePolicy,
          responder.token,
          'PUT',
          path,
          { id: objectiveId },
          policyBody(conn.id),
          key()
        )
      ).status
    ).toBe(403);
    const readOnly = await createV2Credential(['service-objectives:read']);
    expect(
      (
        await invokeV2(
          writePolicy,
          readOnly.token,
          'PUT',
          path,
          { id: objectiveId },
          policyBody(conn.id),
          key()
        )
      ).status
    ).toBe(403);
  });

  it('serves burn history with hourly burn per step, transitions and tiers', async () => {
    const { credential, objectiveId, policy } = await enabledPolicy();
    const fake = fakeConnector(() => 0.002);
    await evaluateSloPolicy({ subjectKey: policy.id, generation: 1 }, settings, never, {
      fetchSeries: fake.fetchSeries,
      processEvent: vi.fn(async () => ({})) as never,
      now: () => at(0),
    });
    const response = await invokeV2(
      readHistory,
      credential.token,
      'GET',
      `/service-objectives/${objectiveId}/burn-history?hours=4`,
      { id: objectiveId }
    );
    expect(response.status).toBe(200);
    const data = (await response.json()).data;
    expect(data).toMatchObject({ objectiveId, targetPercent: 99.9, hours: 4 });
    expect(data.tiers).toHaveLength(4);
    expect(data.points.length).toBeGreaterThan(20);
    expect(data.points.at(-1)).toMatchObject({ good: 998, total: 1000, sli: 99.8, burn1h: 2 });
    const tooLong = await invokeV2(
      readHistory,
      credential.token,
      'GET',
      `/service-objectives/${objectiveId}/burn-history?hours=1000`,
      { id: objectiveId }
    );
    expect(tooLong.status).toBe(400);
  });
});

describe('evaluateSloPolicy', () => {
  it('backfills the longest window once, then asks only for the new step', async () => {
    const { policy } = await enabledPolicy();
    const fake = fakeConnector(() => 0);
    const emit = vi.fn(async () => ({}));
    const first = await evaluateSloPolicy(
      { subjectKey: policy.id, generation: 1 },
      settings,
      never,
      {
        fetchSeries: fake.fetchSeries,
        processEvent: emit as never,
        now: () => at(0),
      }
    );
    expect(first).toMatchObject({ outcome: 'evaluated', status: 'OK', state: 'OK', stored: 864 });
    const end = BASE;
    expect(fake.calls[0].window).toEqual({
      start: new Date(end - 3 * 86_400_000 + STEP),
      end: new Date(end),
    });
    const stored = await db.sloAlertPolicy.findUniqueOrThrow({ where: { id: policy.id } });
    expect(stored.coverageFrom?.getTime()).toBe(end - 3 * 86_400_000);

    fake.calls.length = 0;
    const second = await evaluateSloPolicy(
      { subjectKey: policy.id, generation: 2 },
      settings,
      never,
      { fetchSeries: fake.fetchSeries, processEvent: emit as never, now: () => at(1) }
    );
    expect(second.stored).toBe(1);
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[0].window).toEqual({
      start: new Date(end + STEP),
      end: new Date(end + STEP),
    });
    // Again within the same step: nothing to ask for.
    fake.calls.length = 0;
    await evaluateSloPolicy({ subjectKey: policy.id, generation: 3 }, settings, never, {
      fetchSeries: fake.fetchSeries,
      processEvent: emit as never,
      now: () => new Date(at(1).getTime() + 60_000),
    });
    expect(fake.calls).toHaveLength(0);
    expect(emit).not.toHaveBeenCalled();
    // A stale generation never overwrites a newer result.
    expect(
      await evaluateSloPolicy({ subjectKey: policy.id, generation: 1 }, settings, never, {
        fetchSeries: fake.fetchSeries,
        processEvent: emit as never,
        now: () => at(2),
      })
    ).toMatchObject({ outcome: 'stale' });
  });

  it('opens a ticket, escalates the same incident to a page, then resolves after clean evaluations', async () => {
    const { policy, service } = await enabledPolicy();
    // 0.15% errors throughout: burn 1.5 on every window, so the 3d/6h ticket tier fires at once.
    let rate = 0.0015;
    const fake = fakeConnector(() => rate);
    const run = (generation: number, steps: number) =>
      evaluateSloPolicy({ subjectKey: policy.id, generation }, settings, never, {
        fetchSeries: fake.fetchSeries,
        now: () => at(steps),
      });

    expect(await run(1, 0)).toMatchObject({ state: 'TICKET' });
    const ticket = await db.sloAlertPolicy.findUniqueOrThrow({ where: { id: policy.id } });
    expect(ticket.lastIncidentId).toBeTruthy();
    const opened = await db.incident.findUniqueOrThrow({ where: { id: ticket.lastIncidentId! } });
    expect(opened).toMatchObject({ serviceId: service.id, status: 'OPEN' });

    // 10% errors: two steps push the 1h burn past 14.4 with the 5m window burning too.
    rate = 0.1;
    expect(await run(2, 1)).toMatchObject({ state: 'TICKET' });
    expect(await run(3, 2)).toMatchObject({ state: 'PAGE' });
    const paged = await db.sloAlertPolicy.findUniqueOrThrow({ where: { id: policy.id } });
    expect(paged.lastIncidentId).toBe(opened.id);
    const escalated = await db.incident.findUniqueOrThrow({ where: { id: opened.id } });
    expect(escalated.urgency).toBe('HIGH');
    expect(await db.incident.count({ where: { serviceId: service.id } })).toBe(1);

    // Clean again: the page tiers stop at once, but the step down waits for three clean evaluations
    // and lands on the ticket tier, which the 6h burn still meets. Tickets off makes the next one OK.
    rate = 0;
    expect(await run(4, 3)).toMatchObject({ state: 'PAGE' });
    expect(await run(5, 4)).toMatchObject({ state: 'PAGE' });
    expect(await run(6, 5)).toMatchObject({ state: 'TICKET' });
    expect((await db.incident.findUniqueOrThrow({ where: { id: opened.id } })).status).toBe('OPEN');
    await db.sloAlertPolicy.update({ where: { id: policy.id }, data: { ticketsEnabled: false } });
    expect(await run(7, 6)).toMatchObject({ state: 'TICKET' });
    expect(await run(8, 7)).toMatchObject({ state: 'TICKET' });
    expect(await run(9, 8)).toMatchObject({ state: 'OK' });
    expect((await db.incident.findUniqueOrThrow({ where: { id: opened.id } })).status).toBe(
      'RESOLVED'
    );
    const transitions = await db.sloAlertTransition.findMany({
      where: { policyId: policy.id },
      orderBy: { at: 'asc' },
    });
    expect(transitions.map(item => `${item.from}>${item.to}`)).toEqual([
      'OK>TICKET',
      'TICKET>PAGE',
      'PAGE>TICKET',
      'TICKET>OK',
    ]);
    expect(transitions[1].incidentId).toBe(opened.id);
    expect((transitions[1].burnByWindow as Record<string, number>)['1h']).toBeGreaterThan(14.4);
  });

  it('does not arm a tier before coverage spans its long window', async () => {
    const { policy } = await enabledPolicy();
    // Data only for the last 30 minutes: an outage there cannot page on a one-hour window yet.
    const fake = fakeConnector(() => 0.5);
    const shortHistory: SloSeriesFetcher = async (connection, query, signal) =>
      (await fake.fetchSeries(connection, query, signal)).map(series => ({
        ...series,
        points: series.points.filter(([t]) => t > BASE - 30 * 60_000),
      }));
    const emit = vi.fn(async () => ({}));
    const result = await evaluateSloPolicy(
      { subjectKey: policy.id, generation: 1 },
      settings,
      never,
      { fetchSeries: shortHistory, processEvent: emit as never, now: () => at(0) }
    );
    expect(result).toMatchObject({ state: 'OK', stored: 6 });
    expect(emit).not.toHaveBeenCalled();
  });

  it('rethrows a lane abort without writing, and records a connector failure without moving state', async () => {
    const { policy } = await enabledPolicy();
    const controller = new AbortController();
    const aborting: SloSeriesFetcher = async () => {
      controller.abort();
      throw new ConnectorError('ABORTED', 'cancelled');
    };
    await expect(
      evaluateSloPolicy({ subjectKey: policy.id, generation: 1 }, settings, controller.signal, {
        fetchSeries: aborting,
        now: () => at(0),
      })
    ).rejects.toThrow();
    let row = await db.sloAlertPolicy.findUniqueOrThrow({ where: { id: policy.id } });
    expect(row.lastEvaluatedAt).toBeNull();
    expect(await db.sloSliPoint.count()).toBe(0);

    const failing: SloSeriesFetcher = async () => {
      throw new ConnectorError('TIMEOUT', 'slow');
    };
    const degraded = await evaluateSloPolicy(
      { subjectKey: policy.id, generation: 2 },
      settings,
      never,
      { fetchSeries: failing, now: () => at(0) }
    );
    expect(degraded).toMatchObject({ outcome: 'degraded', status: 'CONNECTOR_ERROR:TIMEOUT' });
    row = await db.sloAlertPolicy.findUniqueOrThrow({ where: { id: policy.id } });
    expect(row).toMatchObject({ state: 'OK', lastStatus: 'CONNECTOR_ERROR:TIMEOUT' });
  });

  it('keeps the state when the incident cannot be raised, so the next evaluation retries', async () => {
    const { policy } = await enabledPolicy();
    const fake = fakeConnector(() => 0.5);
    const failing = vi.fn(async () => {
      throw new Error('ingestion unavailable');
    });
    const result = await evaluateSloPolicy(
      { subjectKey: policy.id, generation: 1 },
      settings,
      never,
      { fetchSeries: fake.fetchSeries, processEvent: failing as never, now: () => at(0) }
    );
    expect(result).toMatchObject({ state: 'OK', status: 'EVENT_FAILED', stored: 864 });
    expect(failing).toHaveBeenCalledTimes(1);
    expect(await db.sloAlertTransition.count()).toBe(0);
  });

  it('closes its incident once when switched off while alerting', async () => {
    const { policy } = await enabledPolicy();
    const fake = fakeConnector(() => 0.5);
    await evaluateSloPolicy({ subjectKey: policy.id, generation: 1 }, settings, never, {
      fetchSeries: fake.fetchSeries,
      now: () => at(0),
    });
    const paged = await db.sloAlertPolicy.findUniqueOrThrow({ where: { id: policy.id } });
    expect(paged.state).toBe('PAGE');
    await db.sloAlertPolicy.update({ where: { id: policy.id }, data: { enabled: false } });
    const result = await evaluateSloPolicy(
      { subjectKey: policy.id, generation: 2 },
      settings,
      never,
      { fetchSeries: fake.fetchSeries, now: () => at(1) }
    );
    expect(result).toMatchObject({ outcome: 'skipped', status: 'DISABLED', state: 'OK' });
    expect(
      (await db.incident.findUniqueOrThrow({ where: { id: paged.lastIncidentId! } })).status
    ).toBe('RESOLVED');
  });
});

describe('scheduling and query tests', () => {
  it('schedules enabled policies (and alerting disabled ones) only while intelligence is on', async () => {
    const { policy } = await enabledPolicy();
    expect(await scheduleSloEvaluationsIfDue(settings)).toBe(0);
    await db.intelligenceSettings.create({
      data: { id: 'default', ...INTELLIGENCE_SETTINGS_DEFAULTS, enabled: true },
    });
    expect(await scheduleSloEvaluationsIfDue(settings)).toBe(1);
    const item = await db.intelligenceWorkItem.findFirstOrThrow({
      where: { kind: 'EVALUATE_SLO_POLICY' },
    });
    expect(item.subjectKey).toBe(policy.id);
    await db.sloAlertPolicy.update({ where: { id: policy.id }, data: { enabled: false } });
    await db.intelligenceWorkItem.deleteMany({});
    expect(await scheduleSloEvaluationsIfDue(settings)).toBe(0);
    await db.sloAlertPolicy.update({ where: { id: policy.id }, data: { state: 'PAGE' } });
    expect(await scheduleSloEvaluationsIfDue(settings)).toBe(1);
  });

  it('tests queries over the last hour without saving anything', async () => {
    const { objectiveId, conn } = await enabledPolicy();
    const fake = fakeConnector(() => 0.001);
    const result = await testSloAlertQueries(objectiveId, policyBody(conn.id), {
      fetchSeries: fake.fetchSeries,
    });
    expect(result).toEqual({
      ok: true,
      good: 11_988,
      total: 12_000,
      sli: 99.9,
      burn1h: 1,
      steps: 12,
    });
    expect(await db.sloSliPoint.count()).toBe(0);
  });
});
