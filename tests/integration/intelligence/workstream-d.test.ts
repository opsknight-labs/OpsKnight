import { beforeEach, describe, expect, it } from 'vitest';
import { resolveUserActor } from '@/lib/authorization-actors';
import {
  DEFAULT_POLICY_DEFINITION,
  INTELLIGENCE_SETTINGS_DEFAULTS,
} from '@/lib/intelligence/contract';
import { computeChangeRisk } from '@/lib/intelligence/changes/risk';
import { recordChange } from '@/lib/intelligence/changes/service';
import { applyCatalogImport, parseCatalog } from '@/lib/intelligence/dependencies/import';
import { getServiceGraphForActor } from '@/lib/intelligence/dependencies/graph-view';
import { buildHandoffSummary } from '@/lib/intelligence/handoff/summary';
import { indexIncident } from '@/lib/intelligence/jobs/indexer';
import { DEFAULT_HANDLERS } from '@/lib/intelligence/jobs/runner';
import { analyzeIncident } from '@/lib/intelligence/similarity/analyzer';
import { publishPolicyVersion } from '@/lib/intelligence/settings/service';
import { getIncidentTimeAxisForActor } from '@/lib/intelligence/timeline/service';
import { decideTriageSuggestion } from '@/lib/intelligence/triage/accept';
import { predictTriage } from '@/lib/intelligence/triage/predict';
import { getTriageForActor } from '@/lib/intelligence/triage/view';
import { getSloBurn } from '@/lib/slo/burn';
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
const settings = { ...INTELLIGENCE_SETTINGS_DEFAULTS, revision: 1, enabled: true, maxDbMs: 30_000 };
const actorOf = async (userId: string) => {
  const actor = await resolveUserActor(userId);
  if (!actor) throw new Error('actor not resolved');
  return actor;
};

async function enable(triage = true) {
  const admin = await createTestUser({ role: 'ADMIN' });
  await db.intelligenceSettings.create({ data: { id: 'default', ...settings } });
  await publishPolicyVersion(
    {},
    {
      mode: 'SUGGEST',
      definition: { ...DEFAULT_POLICY_DEFINITION, triage: { enabled: triage } },
      expectedHeadVersion: 0,
    },
    { actorId: admin.id, source: 'UI' }
  );
  return admin;
}

describe('triage suggestions', () => {
  it('votes urgency, owner, duplicate and time-to-resolve from resolved precedents, and applies an accepted one through the incident commands', async () => {
    const admin = await enable();
    const team = await createTestTeam('Payments');
    const responder = await createTestUser({ role: 'RESPONDER' });
    const service = await createTestService('Checkout', team.id);
    // Five resolved precedents, all HIGH urgency, owned by the responder, resolved in about an hour.
    for (let i = 0; i < 5; i += 1) {
      const createdAt = new Date(Date.now() - (i + 2) * 86_400_000);
      const precedent = await createTestIncident(
        'Checkout pool exhausted on node-' + i,
        service.id,
        {
          status: 'RESOLVED',
          urgency: 'HIGH',
          assigneeId: responder.id,
          createdAt,
          resolvedAt: new Date(createdAt.getTime() + (55 + i * 5) * MIN),
        }
      );
      await db.$transaction(tx => indexIncident(precedent.id, tx));
    }
    const incident = await createTestIncident('Checkout pool exhausted on node-9', service.id, {
      urgency: 'LOW',
    });
    const duplicate = await createTestIncident('Checkout pool exhausted on node-8', service.id, {
      urgency: 'LOW',
      createdAt: new Date(Date.now() - 10 * MIN),
    });
    for (const id of [incident.id, duplicate.id])
      await db.$transaction(tx => indexIncident(id, tx));
    expect(await analyzeIncident({ subjectKey: incident.id, generation: 1 }, settings)).toBe(
      'analyzed'
    );
    // Similarity chained a triage item; run it as the lane would.
    expect(
      await db.intelligenceWorkItem.findFirst({
        where: { kind: 'TRIAGE_INCIDENT', subjectKey: incident.id },
      })
    ).not.toBeNull();
    expect(await predictTriage({ subjectKey: incident.id, generation: 1 }, settings)).toBe(
      'analyzed'
    );

    const view = await getTriageForActor(incident.id, await actorOf(admin.id));
    expect(view).not.toBeNull();
    const kinds = view!.suggestions.map(s => s.kind).sort();
    expect(kinds).toEqual([
      'TRIAGE_ASSIGNMENT',
      'TRIAGE_DUPLICATE',
      'TRIAGE_RESOLUTION_TIME',
      'TRIAGE_URGENCY',
    ]);
    const urgency = view!.suggestions.find(s => s.kind === 'TRIAGE_URGENCY')!;
    expect(urgency.urgency).toBe('HIGH');
    const owner = view!.suggestions.find(s => s.kind === 'TRIAGE_ASSIGNMENT')!;
    expect(owner.owner).toMatchObject({ type: 'user', id: responder.id });
    const dup = view!.suggestions.find(s => s.kind === 'TRIAGE_DUPLICATE')!;
    expect(dup.duplicate?.incidentId).toBe(duplicate.id);
    const ttr = view!.suggestions.find(s => s.kind === 'TRIAGE_RESOLUTION_TIME')!;
    expect(ttr.resolution!.expectedMinutes).toBeGreaterThanOrEqual(55);
    expect(ttr.resolution!.expectedMinutes).toBeLessThanOrEqual(75);

    // Accepting the urgency suggestion runs the canonical command: row, timeline event, feedback.
    const result = await decideTriageSuggestion(await actorOf(admin.id), {
      findingId: urgency.findingId,
      decision: 'ACCEPT',
    });
    expect(result).toEqual({ decision: 'ACCEPT', applied: 'urgency' });
    expect((await db.incident.findUniqueOrThrow({ where: { id: incident.id } })).urgency).toBe(
      'HIGH'
    );
    expect(
      await db.incidentEvent.findFirst({
        where: { incidentId: incident.id, message: { contains: 'Urgency updated to HIGH' } },
      })
    ).not.toBeNull();
    expect(
      await db.intelligenceFeedback.findFirst({ where: { subjectId: urgency.findingId } })
    ).toMatchObject({
      verdict: 'HELPFUL',
    });
    // Dismissing records the verdict and changes nothing.
    await decideTriageSuggestion(await actorOf(admin.id), {
      findingId: owner.findingId,
      decision: 'DISMISS',
    });
    expect(
      (await db.incident.findUniqueOrThrow({ where: { id: incident.id } })).assigneeId
    ).toBeNull();
    expect(
      await db.intelligenceFeedback.findFirst({ where: { subjectId: owner.findingId } })
    ).toMatchObject({
      verdict: 'NOT_HELPFUL',
      reasonCode: 'OTHER',
    });
    // Accepting the duplicate links the incidents through the human-link command.
    await decideTriageSuggestion(await actorOf(admin.id), {
      findingId: dup.findingId,
      decision: 'ACCEPT',
    });
    expect(await db.incidentRelationship.count({ where: { decision: 'ACCEPTED' } })).toBe(1);
    // Accepted and dismissed suggestions show the viewer's verdict.
    const after = await getTriageForActor(incident.id, await actorOf(admin.id));
    expect(after!.suggestions.find(s => s.findingId === urgency.findingId)?.myVerdict).toBe(
      'HELPFUL'
    );
  });

  it('writes nothing while triage is off in the policy', async () => {
    await enable(false);
    const service = await createTestService('Quiet');
    const incident = await createTestIncident('Nothing to see', service.id);
    await db.$transaction(tx => indexIncident(incident.id, tx));
    await analyzeIncident({ subjectKey: incident.id, generation: 1 }, settings);
    expect(await db.intelligenceWorkItem.count({ where: { kind: 'TRIAGE_INCIDENT' } })).toBe(0);
    expect(await predictTriage({ subjectKey: incident.id, generation: 1 }, settings)).toBe(
      'skipped_disabled_feature'
    );
    expect(
      await db.intelligenceFinding.count({
        where: {
          kind: {
            in: [
              'TRIAGE_URGENCY',
              'TRIAGE_ASSIGNMENT',
              'TRIAGE_DUPLICATE',
              'TRIAGE_RESOLUTION_TIME',
            ],
          },
        },
      })
    ).toBe(0);
  });
});

describe('change risk', () => {
  it('scores a recorded change from history, blast radius and timing when the lane processes it', async () => {
    const admin = await enable(false);
    const upstream = await createTestService('Payments DB');
    const api = await createTestService('Payments API');
    const web = await createTestService('Storefront');
    await db.serviceDependency.createMany({
      data: [
        {
          upstreamServiceId: upstream.id,
          downstreamServiceId: api.id,
          origin: 'DECLARED',
          status: 'ACTIVE',
          evidence: {},
        },
        {
          upstreamServiceId: api.id,
          downstreamServiceId: web.id,
          origin: 'DECLARED',
          status: 'ACTIVE',
          evidence: {},
        },
      ],
    });
    // Four earlier deploys from the same source, three followed by an incident within an hour.
    for (let i = 1; i <= 4; i += 1) {
      const at = new Date(Date.now() - i * 2 * 86_400_000);
      await db.changeEvent.create({
        data: {
          serviceId: upstream.id,
          source: 'ci',
          kind: 'DEPLOY',
          summary: `v${i}`,
          occurredAt: at,
        },
      });
      if (i < 4)
        await createTestIncident(`After v${i}`, upstream.id, {
          createdAt: new Date(at.getTime() + 20 * MIN),
          status: 'RESOLVED',
          resolvedAt: new Date(at.getTime() + 60 * MIN),
        });
    }
    const change = await recordChange({
      serviceId: upstream.id,
      source: 'ci',
      kind: 'DEPLOY',
      summary: 'v5',
      labels: { files_changed: 80 },
      occurredAt: new Date(Date.now() - 5 * MIN),
    });
    expect(
      await db.intelligenceWorkItem.findFirst({
        where: { kind: 'LATE_CHANGE', subjectKey: change.id },
      })
    ).not.toBeNull();
    await DEFAULT_HANDLERS.LATE_CHANGE!(
      {
        id: 'late',
        kind: 'LATE_CHANGE',
        subjectKey: change.id,
        generation: 1,
        claimToken: 'late',
        attempts: 1,
      },
      { settings, signal: new AbortController().signal }
    );
    const stored = await db.changeEvent.findUniqueOrThrow({ where: { id: change.id } });
    expect(stored.riskScore).not.toBeNull();
    expect(stored.riskScore!).toBeGreaterThan(0.3);
    expect(stored.riskEvidence).toMatchObject({
      type: 'change_risk',
      historicalSample: 4,
      blastRadius: 2,
    });
    expect(stored.riskComputedAt).not.toBeNull();
    const direct = await db.$transaction(tx => computeChangeRisk(tx, change.id));
    // Three of four earlier changes were followed by an incident; the small sample is shrunk towards the prior.
    expect(direct?.score.components.history).toBeGreaterThan(0.35);
    expect(admin.id).toBeTruthy();
  });
});

describe('topology import and graph', () => {
  it('declares edges for matched catalog entities, is idempotent, and reports the rest', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    const checkout = await createTestService('checkout');
    const payments = await createTestService('payments');
    const catalog = `
kind: Component
metadata:
  name: shop-checkout
  annotations:
    opsknight.com/service-id: ${checkout.id}
spec:
  dependsOn: [component:${payments.name}, component:inventory]
---
kind: Component
metadata:
  name: ${payments.name}
---
kind: Component
metadata:
  name: inventory
`;
    const entities = parseCatalog(catalog);
    const first = await db.$transaction(tx =>
      applyCatalogImport(tx, entities, { actorId: admin.id, source: 'UI' }, 'test')
    );
    expect(first).toMatchObject({
      entities: 3,
      matched: 2,
      edgesDeclared: 1,
      edgesUnchanged: 0,
      danglingReferences: 1,
    });
    expect(first.unmatched).toEqual(['inventory']);
    const edge = await db.serviceDependency.findUniqueOrThrow({
      where: {
        upstreamServiceId_downstreamServiceId: {
          upstreamServiceId: payments.id,
          downstreamServiceId: checkout.id,
        },
      },
    });
    expect(edge).toMatchObject({ origin: 'DECLARED', status: 'ACTIVE' });
    const second = await db.$transaction(tx =>
      applyCatalogImport(tx, entities, { actorId: admin.id, source: 'UI' }, 'test')
    );
    expect(second).toMatchObject({ edgesDeclared: 0, edgesUnchanged: 1 });
    expect(await db.auditLog.count({ where: { action: 'intelligence.topology.imported' } })).toBe(
      2
    );

    await createTestIncident('Checkout down', checkout.id, { urgency: 'HIGH' });
    const graph = await getServiceGraphForActor(await actorOf(admin.id));
    expect(graph!.nodes.find(node => node.id === checkout.id)).toMatchObject({
      openIncidents: 1,
      highestOpenUrgency: 'HIGH',
    });
    expect(graph!.edges).toEqual([
      expect.objectContaining({
        upstreamServiceId: payments.id,
        downstreamServiceId: checkout.id,
        origin: 'DECLARED',
        status: 'ACTIVE',
      }),
    ]);
  });
});

describe('SLO burn', () => {
  it('reports burn for availability objectives from merged incident downtime', async () => {
    const service = await createTestService('Burning');
    expect(await getSloBurn(service.id)).toBeNull();
    await db.serviceObjective.create({
      data: {
        lineageId: 'lineage-1',
        serviceId: service.id,
        name: 'Availability',
        metricType: 'AVAILABILITY',
        target: 99.9,
        comparator: 'GREATER_THAN_OR_EQUAL',
        windowType: 'THIRTY_DAYS',
      },
    });
    const now = new Date();
    // Two overlapping incidents covering the last 20 minutes: 20 of 60 minutes down.
    await createTestIncident('A', service.id, { createdAt: new Date(now.getTime() - 20 * MIN) });
    await createTestIncident('B', service.id, { createdAt: new Date(now.getTime() - 15 * MIN) });
    const burn = await getSloBurn(service.id, now);
    expect(burn).toMatchObject({ burning: true, severity: 'critical' });
    expect(burn!.downtimeMinutes.fast).toBeCloseTo(20, 0);
    expect(burn!.objectives[0].fastBurn).toBeGreaterThan(100);
  });
});

describe('incident time axis', () => {
  it('lines up alerts, changes, upstream incidents and the incident itself relative to onset', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    const upstream = await createTestService('DB');
    const api = await createTestService('API');
    await db.serviceDependency.create({
      data: {
        upstreamServiceId: upstream.id,
        downstreamServiceId: api.id,
        origin: 'DECLARED',
        status: 'ACTIVE',
        evidence: {},
      },
    });
    const onset = new Date(Date.now() - 30 * MIN);
    const incident = await createTestIncident('API errors', api.id, { createdAt: onset });
    await db.alert.create({
      data: {
        incidentId: incident.id,
        serviceId: api.id,
        createdAt: onset,
        payload: { summary: 'HTTP 500 spike' },
      },
    });
    await db.changeEvent.create({
      data: {
        serviceId: upstream.id,
        source: 'ci',
        kind: 'DEPLOY',
        summary: 'db v2',
        occurredAt: new Date(onset.getTime() - 12 * MIN),
        riskScore: 0.42,
      },
    });
    await createTestIncident('DB latency', upstream.id, {
      createdAt: new Date(onset.getTime() - 8 * MIN),
    });
    const axis = await getIncidentTimeAxisForActor(incident.id, await actorOf(admin.id));
    expect(axis).not.toBeNull();
    expect(axis!.entries.map(entry => [entry.kind, entry.offsetMinutes])).toEqual([
      ['CHANGE', -12],
      ['UPSTREAM_INCIDENT', -8],
      ['ALERT', 0],
      ['INCIDENT', 0],
    ]);
    expect(axis!.entries.find(entry => entry.kind === 'CHANGE')?.riskPercent).toBe(42);
  });
});

describe('shift handoff summary', () => {
  it('summarizes open and recently resolved incidents and overdue follow-ups for the schedule services', async () => {
    const service = await createTestService('Edge');
    const other = await createTestService('Elsewhere');
    const responder = await createTestUser({ role: 'RESPONDER', name: 'Dana' });
    const open = await createTestIncident('Edge down', service.id, {
      urgency: 'HIGH',
      assigneeId: responder.id,
      acknowledgedAt: new Date(),
    });
    await createTestIncident('Edge slow', service.id, { urgency: 'LOW' });
    await createTestIncident('Not mine', other.id);
    await createTestIncident('Edge fixed', service.id, {
      status: 'RESOLVED',
      resolvedAt: new Date(Date.now() - 2 * 3_600_000),
    });
    const postmortem = await db.postmortem.create({
      data: { incidentId: open.id, title: 'PM', status: 'DRAFT' },
    });
    await db.actionItem.create({
      data: {
        postmortemId: postmortem.id,
        incidentId: open.id,
        title: 'Rotate certs',
        status: 'OPEN',
        dueDate: new Date(Date.now() - 86_400_000),
      },
    });
    const summary = await buildHandoffSummary({
      scheduleId: 'sched',
      scheduleName: 'Edge primary',
      serviceIds: [service.id],
    });
    expect(summary.counts).toEqual({
      open: 2,
      unacknowledged: 1,
      high: 1,
      resolved: 1,
      overdue: 1,
    });
    expect(summary.open.map(row => row.title)).toEqual(['Edge down', 'Edge slow']);
    expect(summary.open[0]).toMatchObject({ assigneeName: 'Dana', acknowledged: true });
    expect(summary.recentlyResolved.map(row => row.title)).toEqual(['Edge fixed']);
    expect(summary.overdueFollowUps.map(row => row.title)).toEqual(['Rotate certs']);
  });
});
