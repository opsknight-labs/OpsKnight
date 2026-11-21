import { beforeEach, describe, expect, it } from 'vitest';
import { runOpsInsights } from '@/lib/intelligence/ops-insights/handlers';
import { updateOpsInsightSwitches } from '@/lib/intelligence/ops-insights/settings';
import { getIntelligenceSettings } from '@/lib/intelligence/settings/service';
import {
  createTestIncident,
  createTestService,
  createTestUser,
  resetDatabase,
  testPrisma as db,
} from '../../helpers/test-db';

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  await resetDatabase();
});

const DAY = 86_400_000;
const item = (serviceId: string, generation = 1) => ({
  subjectKey: `SERVICE:${serviceId}`,
  generation,
  force: true,
});

async function switches(intelligence: boolean) {
  const admin = await createTestUser({ role: 'ADMIN' });
  const current = await getIntelligenceSettings();
  await updateOpsInsightSwitches(
    {
      opsInsightsEnabled: true,
      opsInsightsAutomationEnabled: false,
      opsInsightsEscalationEnabled: false,
      opsInsightsOnCallEnabled: false,
      opsInsightsPostmortemsEnabled: false,
      opsInsightsRunbooksEnabled: false,
      opsInsightsNotificationsEnabled: false,
      opsInsightsIntelligenceEnabled: intelligence,
      expectedRevision: current.revision,
    },
    { actorId: admin.id, source: 'UI' }
  );
  return { admin, settings: await getIntelligenceSettings() };
}

async function feedback(
  serviceId: string,
  actorId: string,
  accepted: number,
  total: number,
  ageDays: number
) {
  const incident = await createTestIncident(`Incident ${ageDays}`, serviceId);
  // Opened when the verdicts were given, so it predates the metric deviation below.
  await db.incident.update({
    where: { id: incident.id },
    data: { createdAt: new Date(Date.now() - ageDays * DAY) },
  });
  for (let i = 0; i < total; i += 1) {
    const finding = await db.intelligenceFinding.create({
      data: {
        incidentId: incident.id,
        kind: 'CHANGE_CORRELATION',
        subjectRef: `change-${ageDays}-${i}`,
        evidence: {},
        generation: 1,
        engineVersion: 'test',
      },
    });
    await db.intelligenceFeedback.create({
      data: {
        subjectType: 'FINDING',
        subjectId: finding.id,
        verdict: i < accepted ? 'HELPFUL' : 'NOT_HELPFUL',
        serviceId,
        actorId,
        createdAt: new Date(Date.now() - ageDays * DAY),
      },
    });
  }
}

describe('intelligence-area operations insights', () => {
  it('reports acceptance drift and metric early warnings, only while the area is on', async () => {
    const service = await createTestService('Checkout');
    const { admin, settings } = await switches(false);
    await feedback(service.id, admin.id, 32, 40, 14); // 80% before
    await feedback(service.id, admin.id, 10, 20, 2); // 50% last week
    const template = await db.serviceMetricTemplate.create({
      data: { serviceId: service.id, name: 'p99 latency', query: 'q', enabled: true },
    });
    const at = new Date(Date.now() - 2 * 3_600_000);
    await db.metricAnomaly.create({
      data: {
        templateId: template.id,
        serviceId: service.id,
        seriesKey: 's1',
        at,
        peakAt: at,
        endAt: new Date(at.getTime() + 600_000),
        direction: 'UP',
        score: 12.34,
        value: 900,
        baselineMedian: 200,
        baselineMad: 20,
        baselineSamples: 40,
        points: 10,
        generation: 1,
      },
    });

    await runOpsInsights(item(service.id), settings);
    expect(await db.opsInsight.count()).toBe(0);

    const on = (await switches(true)).settings;
    expect(await runOpsInsights(item(service.id, 2), on)).toBe('computed');
    const rows = await db.opsInsight.findMany({ orderBy: { kind: 'asc' } });
    expect(rows.map(row => [row.kind, row.key, row.status])).toEqual([
      ['intelligence.acceptance-drift', 'CHANGE_CORRELATION', 'OPEN'],
      ['intelligence.metric-early-warning', template.id, 'OPEN'],
    ]);
    expect(rows[0].title).toContain('80% to 50%');
    expect(rows[1].severity).toBe('WARNING');

    // Once an incident opens on the service, the deviation is no longer an early warning.
    await createTestIncident('Latency', service.id);
    await runOpsInsights(item(service.id, 3), on);
    expect(
      (
        await db.opsInsight.findFirstOrThrow({
          where: { kind: 'intelligence.metric-early-warning' },
        })
      ).status
    ).toBe('RESOLVED');
  });
});
