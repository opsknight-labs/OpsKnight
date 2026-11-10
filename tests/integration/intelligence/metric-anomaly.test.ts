import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveUserActor } from '@/lib/authorization-actors';
import {
  DEFAULT_POLICY_DEFINITION,
  INTELLIGENCE_SETTINGS_DEFAULTS,
} from '@/lib/intelligence/contract';
import type { ConnectorFetch } from '@/lib/intelligence/connectors/http';
import { indexIncident } from '@/lib/intelligence/jobs/indexer';
import { purgeExpiredIntelligenceData } from '@/lib/intelligence/jobs/retention';
import { DEFAULT_HANDLERS } from '@/lib/intelligence/jobs/runner';
import { WORK_KINDS } from '@/lib/intelligence/jobs/work-queue';
import { evaluateMetricTemplate } from '@/lib/intelligence/metric-anomaly/evaluate';
import {
  deleteMetricTemplate,
  listMetricTemplates,
  requestMetricEvaluation,
  saveMetricTemplate,
  scheduleMetricEvaluationsIfDue,
} from '@/lib/intelligence/metric-anomaly/service';
import { analyzeResponse } from '@/lib/intelligence/response/handler';
import { getResponseIntelligenceForActor } from '@/lib/intelligence/response/view';
import { publishPolicyVersion } from '@/lib/intelligence/settings/service';
import { getIncidentTimeAxisForActor } from '@/lib/intelligence/timeline/service';
import {
  createTestIncident,
  createTestService,
  createTestTeam,
  createTestUser,
  resetDatabase,
  testPrisma as db,
} from '../../helpers/test-db';

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  await resetDatabase();
});

const MIN = 60_000;
const DAY = 86_400_000;
const settings = { ...INTELLIGENCE_SETTINGS_DEFAULTS, revision: 1, enabled: true, maxDbMs: 30_000 };
// Whole hours in the recent past, so the time axis (which ends at the real clock) includes the spike.
const NOW = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000 - 3_600_000);
const SPIKE_START = NOW.getTime() - 30 * MIN;
const SPIKE_END = NOW.getTime() - 26 * MIN;
const SPIKE_CLOCK = new Date(SPIKE_START).toISOString().slice(11, 16);
const expectDeviationTitle = (title: string) => {
  expect(title.startsWith(`p99 latency deviated at ${SPIKE_CLOCK} UTC by `)).toBe(true);
  expect(title.endsWith(' MAD (rose)')).toBe(true);
};
const never = new AbortController().signal;

const actorOf = async (userId: string) => {
  const actor = await resolveUserActor(userId);
  if (!actor) throw new Error('actor not resolved');
  return actor;
};

const noise = (seed: number) => {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
};
/** Daily cycle around 100 with small noise; the spike only exists in the current window. */
const metricAt = (ms: number, spike: number) =>
  100 +
  50 * Math.sin((2 * Math.PI * (ms % DAY)) / DAY) +
  noise(ms / MIN) * 2 +
  (ms >= SPIKE_START && ms < SPIKE_END ? spike : 0);

/** A Prometheus stand-in behind the real adapter: answers query_range from the requested window. */
function fakePrometheus(options: { spike?: number; status?: number } = {}) {
  const calls: Array<{ start: number; end: number; step: number; query: string }> = [];
  const fetch: ConnectorFetch = vi.fn(async (input: string) => {
    const url = new URL(input);
    const start = Number(url.searchParams.get('start')) * 1000;
    const end = Number(url.searchParams.get('end')) * 1000;
    const step = Number(url.searchParams.get('step')) * 1000;
    calls.push({ start, end, step, query: url.searchParams.get('query') ?? '' });
    if (options.status && options.status !== 200)
      return new Response('{"error":"nope"}', { status: options.status });
    const values: Array<[number, string]> = [];
    for (let at = start; at <= end; at += step)
      values.push([at / 1000, String(metricAt(at, options.spike ?? 80))]);
    return new Response(
      JSON.stringify({
        status: 'success',
        data: { resultType: 'matrix', result: [{ metric: { service: 'checkout' }, values }] },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  });
  return { fetch, calls };
}

async function enableIntelligence(response = true) {
  const admin = await createTestUser({ role: 'ADMIN' });
  await db.intelligenceSettings.create({ data: { id: 'default', ...settings } });
  await publishPolicyVersion(
    {},
    {
      mode: 'SUGGEST',
      definition: { ...DEFAULT_POLICY_DEFINITION, response: { enabled: response } },
      expectedHeadVersion: 0,
    },
    { actorId: admin.id, source: 'UI' }
  );
  return admin;
}

async function connection(
  overrides: Partial<{
    kind: 'PROMETHEUS' | 'LOKI';
    enabled: boolean;
    allowedTeamIds: string[];
  }> = {}
) {
  return db.observabilityConnection.create({
    data: {
      name: `prom-${Math.random().toString(36).slice(2, 8)}`,
      kind: overrides.kind ?? 'PROMETHEUS',
      baseUrl: 'https://prom.example.com',
      enabled: overrides.enabled ?? true,
      allowedTeamIds: overrides.allowedTeamIds ?? [],
      timeoutMs: 1_000,
    },
  });
}

async function template(serviceId: string, connectionId: string, enabled = true) {
  return db.serviceMetricTemplate.create({
    data: {
      serviceId,
      connectionId,
      name: 'p99 latency',
      query: 'histogram_quantile(0.99, rate(http_seconds_bucket[5m]))',
      enabled,
    },
  });
}

describe('metric template administration', () => {
  it('is off by default, audited, and accepts only connections the service team may use', async () => {
    const admin = await enableIntelligence();
    const actor = { actorId: admin.id, source: 'UI' as const };
    const teamA = await createTestTeam('A');
    const teamB = await createTestTeam('B');
    const service = await createTestService('Checkout', teamA.id);
    const open = await connection();
    const onlyB = await connection({ allowedTeamIds: [teamB.id] });
    const disabled = await connection({ enabled: false });
    const logs = await connection({ kind: 'LOKI' });
    const input = { serviceId: service.id, name: 'p99', query: 'up' };

    const saved = await saveMetricTemplate(null, { ...input, connectionId: open.id }, actor);
    expect(saved.enabled).toBe(false);
    expect(saved.serviceName).toBe(service.name);
    for (const [connectionId, message] of [
      [onlyB.id, /not allowed for this service's team/],
      [disabled.id, /Enable the connection first/],
      [logs.id, /cannot answer metric queries/],
      ['missing', /no longer exists/],
    ] as const) {
      await expect(
        saveMetricTemplate(null, { ...input, name: `x-${connectionId}`, connectionId }, actor)
      ).rejects.toMatchObject({
        fields: [{ field: 'connectionId', message: expect.stringMatching(message) }],
      });
    }
    await expect(
      saveMetricTemplate(null, { ...input, connectionId: open.id }, actor)
    ).rejects.toMatchObject({ fields: [{ field: 'name' }] });

    const updated = await saveMetricTemplate(
      saved.id,
      { ...input, connectionId: open.id, enabled: true, thresholdMad: 6 },
      actor
    );
    expect(updated).toMatchObject({ enabled: true, thresholdMad: 6 });
    expect((await listMetricTemplates()).map(view => view.id)).toEqual([saved.id]);
    const audits = await db.auditLog.findMany({
      where: { entityId: saved.id },
      orderBy: { createdAt: 'asc' },
      select: { action: true },
    });
    expect(audits.map(entry => entry.action)).toEqual([
      'intelligence.metric_template.created',
      'intelligence.metric_template.updated',
    ]);
    expect(await deleteMetricTemplate(saved.id, actor)).toBe('deleted');
    expect(await deleteMetricTemplate(saved.id, actor)).toBe('not_found');
  });

  it('schedules only enabled templates whose interval has elapsed, and only while intelligence is on', async () => {
    await enableIntelligence();
    const service = await createTestService('Checkout');
    const conn = await connection();
    const off = await template(service.id, conn.id, false);
    await db.serviceMetricTemplate.update({ where: { id: off.id }, data: { name: 'off' } });
    const due = await template(service.id, conn.id);
    const fresh = await db.serviceMetricTemplate.create({
      data: {
        serviceId: service.id,
        connectionId: conn.id,
        name: 'fresh',
        query: 'up',
        enabled: true,
        lastEvaluatedAt: new Date(NOW.getTime() - 5 * MIN),
      },
    });

    expect(await scheduleMetricEvaluationsIfDue(settings, NOW)).toBe(1);
    const items = await db.intelligenceWorkItem.findMany({
      where: { kind: WORK_KINDS.EVALUATE_METRIC_TEMPLATE },
      select: { subjectKey: true },
    });
    expect(items.map(item => item.subjectKey)).toEqual([due.id]);
    expect(items.map(item => item.subjectKey)).not.toContain(fresh.id);
    expect(await requestMetricEvaluation(off.id)).toBe(false);
    expect(await requestMetricEvaluation(fresh.id)).toBe(true);

    await db.intelligenceSettings.update({ where: { id: 'default' }, data: { enabled: false } });
    await db.intelligenceWorkItem.deleteMany({});
    expect(await scheduleMetricEvaluationsIfDue(settings, NOW)).toBe(0);
  });
});

describe('metric template evaluation (lane job)', () => {
  it('records a seasonal deviation with its time and size, once, and fences on the generation', async () => {
    await enableIntelligence();
    const service = await createTestService('Checkout');
    const conn = await connection();
    const tpl = await template(service.id, conn.id);
    const prom = fakePrometheus();

    const result = await evaluateMetricTemplate(
      { subjectKey: tpl.id, generation: 10 },
      settings,
      never,
      { fetch: prom.fetch, now: () => NOW }
    );
    expect(result).toMatchObject({ outcome: 'evaluated', status: 'OK', anomalies: 1, created: 1 });
    // One current window and four history weeks, each the same query at the template's step.
    expect(prom.calls).toHaveLength(5);
    expect(new Set(prom.calls.map(call => call.step))).toEqual(new Set([60_000]));
    expect(
      prom.calls.slice(1).map(call => Math.round((NOW.getTime() - call.end) / (7 * DAY)))
    ).toEqual([1, 2, 3, 4]);

    const [anomaly, ...others] = await db.metricAnomaly.findMany();
    expect(others).toEqual([]);
    expect(anomaly).toMatchObject({
      serviceId: service.id,
      templateId: tpl.id,
      direction: 'UP',
      generation: 10,
      at: new Date(SPIKE_START),
      endAt: new Date(SPIKE_END - MIN),
      points: 4,
    });
    expect(anomaly.score).toBeGreaterThan(5);
    expect(anomaly.labels).toEqual({ service: 'checkout' });
    const after = await db.serviceMetricTemplate.findUniqueOrThrow({ where: { id: tpl.id } });
    expect(after).toMatchObject({ lastStatus: 'OK', lastGeneration: 10, lastEvaluatedAt: NOW });

    // The next evaluation overlaps the same spike: the anomaly is kept, not duplicated.
    const again = await evaluateMetricTemplate(
      { subjectKey: tpl.id, generation: 11 },
      settings,
      never,
      { fetch: prom.fetch, now: () => new Date(NOW.getTime() + 15 * MIN) }
    );
    expect(again).toMatchObject({ outcome: 'evaluated', created: 0 });
    expect(await db.metricAnomaly.count()).toBe(1);

    // An older generation finishing late writes nothing.
    const late = await evaluateMetricTemplate(
      { subjectKey: tpl.id, generation: 9 },
      settings,
      never,
      { fetch: fakePrometheus({ spike: 500 }).fetch, now: () => NOW }
    );
    expect(late.outcome).toBe('stale');
    expect((await db.metricAnomaly.findFirstOrThrow()).generation).toBe(11);
  });

  it('finds nothing when the current window follows the seasonal shape', async () => {
    await enableIntelligence();
    const service = await createTestService('Checkout');
    const tpl = await template(service.id, (await connection()).id);
    const result = await evaluateMetricTemplate(
      { subjectKey: tpl.id, generation: 1 },
      settings,
      never,
      { fetch: fakePrometheus({ spike: 0 }).fetch, now: () => NOW }
    );
    expect(result).toMatchObject({ outcome: 'evaluated', status: 'OK', anomalies: 0 });
    expect(await db.metricAnomaly.count()).toBe(0);
  });

  it('degrades to no evidence when the connector fails or times out, and completes', async () => {
    await enableIntelligence();
    const service = await createTestService('Checkout');
    const tpl = await template(service.id, (await connection()).id);

    const failing = await evaluateMetricTemplate(
      { subjectKey: tpl.id, generation: 1 },
      settings,
      never,
      { fetch: fakePrometheus({ status: 503 }).fetch, now: () => NOW }
    );
    expect(failing).toMatchObject({ outcome: 'degraded', status: 'CONNECTOR_ERROR:HTTP_ERROR' });

    const hanging: ConnectorFetch = (_input, init) =>
      new Promise((_resolve, reject) =>
        init?.signal?.addEventListener('abort', () =>
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
        )
      );
    const slow = await evaluateMetricTemplate(
      { subjectKey: tpl.id, generation: 2 },
      settings,
      never,
      { fetch: hanging, now: () => NOW }
    );
    expect(slow).toMatchObject({ outcome: 'degraded', status: 'CONNECTOR_ERROR:TIMEOUT' });
    expect(await db.metricAnomaly.count()).toBe(0);
    expect(
      await db.serviceMetricTemplate.findUniqueOrThrow({ where: { id: tpl.id } })
    ).toMatchObject({ lastStatus: 'CONNECTOR_ERROR:TIMEOUT', lastGeneration: 2 });

    // A history week that fails is only a gap in the baseline.
    let call = 0;
    const flaky = fakePrometheus();
    const partly: ConnectorFetch = async (input, init) =>
      ++call === 3 ? new Response('', { status: 500 }) : flaky.fetch(input, init);
    const partial = await evaluateMetricTemplate(
      { subjectKey: tpl.id, generation: 3 },
      settings,
      never,
      { fetch: partly, now: () => NOW }
    );
    expect(partial).toMatchObject({ outcome: 'evaluated', status: 'OK', anomalies: 1 });
  });

  it('through the lane handler, an unreachable endpoint is recorded on the template and does not throw', async () => {
    await enableIntelligence();
    const service = await createTestService('Checkout');
    const conn = await db.observabilityConnection.create({
      data: {
        name: 'nowhere',
        kind: 'PROMETHEUS',
        baseUrl: 'https://prometheus.invalid',
        enabled: true,
        timeoutMs: 2_000,
      },
    });
    const tpl = await template(service.id, conn.id);
    const handler = DEFAULT_HANDLERS[WORK_KINDS.EVALUATE_METRIC_TEMPLATE]!;
    await handler(
      {
        id: 'w',
        kind: WORK_KINDS.EVALUATE_METRIC_TEMPLATE,
        subjectKey: tpl.id,
        generation: 1,
        claimToken: 't',
        attempts: 1,
      },
      { settings: { ...settings, maxDbMs: 5_000 }, signal: never }
    );
    const row = await db.serviceMetricTemplate.findUniqueOrThrow({ where: { id: tpl.id } });
    expect(row.lastStatus).toMatch(/^CONNECTOR_ERROR:/);
    expect(await db.metricAnomaly.count()).toBe(0);
  });

  it('never queries a connection the service team may not use, nor a disabled one', async () => {
    await enableIntelligence();
    const teamA = await createTestTeam('A');
    const teamB = await createTestTeam('B');
    const service = await createTestService('Checkout', teamA.id);
    const onlyB = await connection({ allowedTeamIds: [teamB.id] });
    const tpl = await template(service.id, onlyB.id);
    const prom = fakePrometheus();
    const blocked = await evaluateMetricTemplate(
      { subjectKey: tpl.id, generation: 1 },
      settings,
      never,
      { fetch: prom.fetch, now: () => NOW }
    );
    expect(blocked).toMatchObject({ outcome: 'skipped', status: 'CONNECTION_NOT_ALLOWED' });

    await db.observabilityConnection.update({
      where: { id: onlyB.id },
      data: { allowedTeamIds: [teamA.id], enabled: false },
    });
    const disabled = await evaluateMetricTemplate(
      { subjectKey: tpl.id, generation: 2 },
      settings,
      never,
      { fetch: prom.fetch, now: () => NOW }
    );
    expect(disabled.status).toBe('CONNECTION_DISABLED');

    await db.observabilityConnection.delete({ where: { id: onlyB.id } });
    const orphan = await evaluateMetricTemplate(
      { subjectKey: tpl.id, generation: 3 },
      settings,
      never,
      { fetch: prom.fetch, now: () => NOW }
    );
    expect(orphan.status).toBe('NO_CONNECTION');
    expect(prom.calls).toEqual([]);

    await db.serviceMetricTemplate.update({ where: { id: tpl.id }, data: { enabled: false } });
    expect(
      (await evaluateMetricTemplate({ subjectKey: tpl.id, generation: 4 }, settings, never)).outcome
    ).toBe('skipped');
  });
});

describe('metric anomaly evidence in root-cause analysis and the timeline', () => {
  async function scenario() {
    const admin = await enableIntelligence();
    const teamA = await createTestTeam('A');
    const teamB = await createTestTeam('B');
    const web = await createTestService('Web', teamA.id);
    const db1 = await createTestService('Orders DB', teamB.id);
    await db.serviceDependency.create({
      data: {
        upstreamServiceId: db1.id,
        downstreamServiceId: web.id,
        origin: 'DECLARED',
        status: 'ACTIVE',
        evidence: {},
      },
    });
    const onset = new Date(SPIKE_START + 6 * MIN);
    const incident = await createTestIncident('Web errors', web.id, {
      createdAt: onset,
      teamId: teamA.id,
    });
    await db.$transaction(tx => indexIncident(incident.id, tx));
    const tpl = await template(db1.id, (await connection()).id);
    await db.intelligenceWorkItem.deleteMany({});
    const result = await evaluateMetricTemplate(
      { subjectKey: tpl.id, generation: 5 },
      settings,
      never,
      { fetch: fakePrometheus().fetch, now: () => NOW }
    );
    expect(result.created).toBe(1);
    return { admin, teamA, web, db1, incident };
  }

  it('re-signals incidents a new anomaly may explain and ranks it as a probable-cause lead', async () => {
    const { admin, incident } = await scenario();
    const queued = await db.intelligenceWorkItem.findMany({
      where: { kind: WORK_KINDS.ANALYZE_RESPONSE },
      select: { subjectKey: true },
    });
    expect(queued.map(item => item.subjectKey)).toEqual([incident.id]);

    await analyzeResponse({ subjectKey: incident.id, generation: 100 }, settings);
    const [finding] = await db.intelligenceFinding.findMany({
      where: { incidentId: incident.id, kind: 'METRIC_ANOMALY', status: 'ACTIVE' },
    });
    expect(finding.confidence).toBeGreaterThan(0);
    expect(finding.evidence).toMatchObject({
      type: 'metric_anomaly',
      relation: 'UPSTREAM',
      depth: 1,
      leadSeconds: 6 * 60,
      direction: 'UP',
    });

    const view = await getResponseIntelligenceForActor(incident.id, await actorOf(admin.id));
    expect(view?.metricAnomalies).toHaveLength(1);
    expect(view!.metricAnomalies![0]).toMatchObject({
      relation: 'UPSTREAM',
      direction: 'UP',
      leadMinutes: 6,
      templateName: 'p99 latency',
    });
    expectDeviationTitle(view!.metricAnomalies![0].title);
  });

  it("hides an upstream service's anomaly from people who cannot read that service", async () => {
    const { teamA, incident } = await scenario();
    const member = await createTestUser({ role: 'USER' });
    await db.teamMember.create({ data: { userId: member.id, teamId: teamA.id, role: 'MEMBER' } });
    await analyzeResponse({ subjectKey: incident.id, generation: 100 }, settings);
    const actor = await actorOf(member.id);
    const view = await getResponseIntelligenceForActor(incident.id, actor);
    expect(view?.metricAnomalies ?? []).toEqual([]);
    const axis = await getIncidentTimeAxisForActor(incident.id, actor);
    expect(axis?.entries.some(entry => entry.kind === 'METRIC_ANOMALY')).toBe(false);
  });

  it('places the anomaly on the incident time axis relative to onset', async () => {
    const { admin, incident } = await scenario();
    const axis = await getIncidentTimeAxisForActor(incident.id, await actorOf(admin.id));
    const entry = axis!.entries.find(item => item.kind === 'METRIC_ANOMALY');
    expect(entry).toMatchObject({ offsetMinutes: -6, href: null, at: new Date(SPIKE_START) });
    expectDeviationTitle(entry!.title);
    expect(entry!.detail).toMatch(/^Orders DB-\w+ · [\d.]+ vs usual [\d.]+$/);
    expect(axis!.entries.map(item => item.kind)).toEqual(['METRIC_ANOMALY', 'INCIDENT']);
  });

  it('writes no metric finding for incidents on services without metric evidence', async () => {
    await enableIntelligence();
    const service = await createTestService('Plain');
    const incident = await createTestIncident('Plain incident', service.id);
    await db.$transaction(tx => indexIncident(incident.id, tx));
    await analyzeResponse({ subjectKey: incident.id, generation: 1 }, settings);
    expect(
      await db.intelligenceAnalysisSnapshot.findMany({
        where: { incidentId: incident.id, kind: 'METRIC_ANOMALY' },
      })
    ).toEqual([]);
  });

  it('ages anomalies out with finding retention and removes them with their template', async () => {
    const { admin } = await scenario();
    await db.metricAnomaly.updateMany({ data: { at: new Date(Date.now() - 400 * DAY) } });
    await purgeExpiredIntelligenceData(
      { ...settings, findingRetentionDays: 365 },
      { batchSize: 100 }
    );
    expect(await db.metricAnomaly.count()).toBe(0);

    const [tpl] = await listMetricTemplates();
    await db.metricAnomaly.create({
      data: {
        templateId: tpl.id,
        serviceId: tpl.serviceId,
        seriesKey: 'k',
        at: new Date(),
        peakAt: new Date(),
        endAt: new Date(),
        direction: 'UP',
        score: 9,
        value: 1,
        baselineMedian: 0,
        baselineMad: 0,
        baselineSamples: 3,
        points: 2,
        generation: 1,
      },
    });
    await deleteMetricTemplate(tpl.id, { actorId: admin.id, source: 'UI' });
    expect(await db.metricAnomaly.count()).toBe(0);
  });
});
