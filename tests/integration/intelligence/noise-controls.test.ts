import { beforeEach, describe, expect, it } from 'vitest';
import { resolveUserActor } from '@/lib/authorization-actors';
import { processEvent } from '@/lib/events';
import {
  DEFAULT_POLICY_DEFINITION,
  INTELLIGENCE_SETTINGS_DEFAULTS,
} from '@/lib/intelligence/contract';
import { correlateIncident } from '@/lib/intelligence/correlation/handler';
import { indexIncident } from '@/lib/intelligence/jobs/indexer';
import { publishPolicyVersion } from '@/lib/intelligence/settings/service';
import {
  assessNoiseReadiness,
  createHeartbeatMonitor,
  createMaintenanceWindow,
  createSuppressionRule,
  endMaintenanceWindow,
  evaluatePrePagingControls,
  getNoiseControlKpis,
  listMaintenanceWindows,
  listPrePagingDecisions,
  loadPrePagingSnapshot,
  prismaLookups,
  recordHeartbeat,
  recordPrePagingDecision,
  reversePrePagingDecision,
  saveNoiseControlPolicy,
  simulatePrePagingControls,
  suggestSuppressionRules,
  sweepHeartbeatMonitors,
  sweepPrePagingControls,
  type PrePagingInput,
} from '@/lib/intelligence/noise-controls';
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

const actorOf = (userId: string) => ({ actorId: userId, source: 'UI' as const });
const settings = { ...INTELLIGENCE_SETTINGS_DEFAULTS, revision: 1, enabled: true };

async function setup() {
  const admin = await createTestUser({ role: 'ADMIN' });
  await db.intelligenceSettings.create({
    data: { id: 'default', ...INTELLIGENCE_SETTINGS_DEFAULTS, enabled: true },
  });
  const service = await createTestService('Checkout');
  return { admin, service, actor: actorOf(admin.id) };
}

function alertInput(serviceId: string, overrides: Partial<PrePagingInput> = {}): PrePagingInput {
  return {
    serviceId,
    source: 'prometheus',
    summary: 'Checkout pool exhausted',
    severity: 'error',
    urgency: 'MEDIUM',
    labels: { env: 'prod' },
    resourceKey: 'pool-1',
    fingerprintHash: 'fp-pool',
    dedupKey: 'pool-1',
    receivedAt: new Date(),
    ...overrides,
  };
}

describe('policy lifecycle', () => {
  it('saves with compare-and-set, gates ON behind shadow evidence, and audits every change', async () => {
    const { service, actor } = await setup();
    const first = await saveNoiseControlPolicy(
      {
        serviceId: service.id,
        mode: 'SHADOW',
        definition: { schemaVersion: 1, contentDedup: { enabled: true } },
        expectedRevision: 0,
      },
      actor
    );
    expect(first).toMatchObject({ mode: 'SHADOW', revision: 1 });
    await expect(
      saveNoiseControlPolicy(
        {
          serviceId: service.id,
          mode: 'ON',
          definition: { schemaVersion: 1 },
          expectedRevision: 0,
        },
        actor
      )
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    // Not enough shadow decisions yet: ON is refused unless the operator acknowledges it.
    await expect(
      saveNoiseControlPolicy(
        {
          serviceId: service.id,
          mode: 'ON',
          definition: { schemaVersion: 1 },
          expectedRevision: 1,
        },
        actor
      )
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(await assessNoiseReadiness(service.id)).toMatchObject({
      ready: false,
      shadowDecisions: 0,
    });
    const on = await saveNoiseControlPolicy(
      {
        serviceId: service.id,
        mode: 'ON',
        definition: { schemaVersion: 1 },
        expectedRevision: 1,
        acknowledgeReadiness: true,
      },
      actor
    );
    expect(on).toMatchObject({ mode: 'ON', revision: 2 });
    const audits = await db.auditLog.findMany({
      where: { action: 'intelligence.noise.policy.saved' },
    });
    expect(audits).toHaveLength(2);
    const snapshot = await loadPrePagingSnapshot();
    expect(snapshot.policies.get(`service:${service.id}`)).toMatchObject({
      mode: 'ON',
      revision: 2,
    });
  });
});

describe('maintenance windows and suppression rules end to end', () => {
  it('suppresses during a window, downgrades by rule, and stops matching once ended early', async () => {
    const { service, actor } = await setup();
    await saveNoiseControlPolicy(
      {
        mode: 'ON',
        definition: { schemaVersion: 1 },
        expectedRevision: 0,
        acknowledgeReadiness: true,
      },
      actor
    );
    const now = new Date();
    const window = await createMaintenanceWindow(
      {
        name: 'Checkout patching',
        scope: 'SERVICE',
        serviceId: service.id,
        startsAt: new Date(now.getTime() - 60_000).toISOString(),
        endsAt: new Date(now.getTime() + 3_600_000).toISOString(),
        recurrence: 'FREQ=WEEKLY',
      },
      actor
    );
    await createSuppressionRule(
      {
        name: 'Info is low',
        matchers: [{ field: 'severity', op: 'equals', value: 'info' }],
        effect: 'DOWNGRADE',
        downgradeUrgency: 'LOW',
      },
      actor
    );
    const listed = await listMaintenanceWindows();
    expect(listed[0]).toMatchObject({ id: window.id, active: true, serviceName: service.name });
    const lookups = prismaLookups(db);
    const inWindow = await evaluatePrePagingControls(
      alertInput(service.id),
      await loadPrePagingSnapshot(),
      lookups
    );
    expect(inWindow).toMatchObject({
      action: 'SUPPRESS',
      control: 'MAINTENANCE',
      apply: true,
      sourceId: window.id,
    });
    const other = await createTestService('Other');
    const downgraded = await evaluatePrePagingControls(
      alertInput(other.id, { severity: 'info' }),
      await loadPrePagingSnapshot(),
      lookups
    );
    expect(downgraded).toMatchObject({
      action: 'DOWNGRADE',
      control: 'SUPPRESSION',
      urgency: 'LOW',
    });

    expect(await endMaintenanceWindow(window.id, actor)).toBe('ended');
    const after = await evaluatePrePagingControls(
      alertInput(service.id),
      await loadPrePagingSnapshot(),
      lookups
    );
    expect(after.action).toBe('NONE');
    expect((await listMaintenanceWindows({ includePast: true }))[0]).toMatchObject({
      active: false,
      endedAt: expect.any(Date),
    });
  });
});

describe('content dedup, decisions and reversal', () => {
  it('appends to the open incident with the same content, records the decision, and reversing re-ingests the alert so it pages', async () => {
    const { service, actor } = await setup();
    await saveNoiseControlPolicy(
      {
        serviceId: service.id,
        mode: 'ON',
        definition: {
          schemaVersion: 1,
          contentDedup: { enabled: true, windowSeconds: 900, requireLabelSubset: true },
        },
        expectedRevision: 0,
        acknowledgeReadiness: true,
      },
      actor
    );
    const open = await createTestIncident('Checkout pool exhausted', service.id, {
      urgency: 'MEDIUM',
    });
    const alert = await db.alert.create({
      data: {
        incidentId: open.id,
        serviceId: service.id,
        dedupKey: 'pool-1',
        fingerprintHash: 'fp-pool',
        labels: { env: 'prod', region: 'eu' },
        payload: { summary: 'Checkout pool exhausted', source: 'prometheus', severity: 'error' },
      },
    });
    await db.$transaction(tx => indexIncident(open.id, tx));
    const snapshot = await loadPrePagingSnapshot();
    const decision = await evaluatePrePagingControls(
      alertInput(service.id),
      snapshot,
      prismaLookups(db)
    );
    expect(decision).toMatchObject({
      action: 'APPEND',
      control: 'CONTENT_DEDUP',
      targetIncidentId: open.id,
      apply: true,
    });
    expect(decision.elapsedMs).toBeLessThan(250);

    const id = await recordPrePagingDecision(db, decision, {
      serviceId: service.id,
      alertId: alert.id,
    });
    expect(id).not.toBeNull();
    expect(await listPrePagingDecisions({ serviceId: service.id })).toMatchObject([
      { control: 'CONTENT_DEDUP', action: 'APPEND', applied: true, incidentId: open.id },
    ]);

    const reversal = await reversePrePagingDecision(id!, actor);
    expect(reversal.outcome).toBe('reversed');
    if (reversal.outcome !== 'reversed' || !reversal.incidentId)
      throw new Error('expected a re-ingested incident');
    const paged = await db.incident.findUniqueOrThrow({ where: { id: reversal.incidentId } });
    expect(paged).toMatchObject({
      status: 'OPEN',
      serviceId: service.id,
      title: 'Checkout pool exhausted',
    });
    expect(paged.id).not.toBe(open.id);
    expect(
      (await db.prePagingDecision.findUniqueOrThrow({ where: { id: id! } })).reversedAt
    ).not.toBeNull();
    expect(await reversePrePagingDecision(id!, actor)).toEqual({ outcome: 'already_reversed' });
    const kpis = await getNoiseControlKpis({ days: 1, serviceId: service.id });
    expect(kpis).toMatchObject({ pagesAvoided: 1, grouped: 1, ungrouped: 1, falseGroupRate: 1 });
  });

  it('fails open when a lookup throws, so the event pages as before', async () => {
    const { service, actor } = await setup();
    await saveNoiseControlPolicy(
      {
        serviceId: service.id,
        mode: 'ON',
        definition: { schemaVersion: 1, storm: { enabled: true } },
        expectedRevision: 0,
        acknowledgeReadiness: true,
      },
      actor
    );
    const broken = {
      ...prismaLookups(db),
      countRecentIncidents: async () => {
        throw new Error('connection reset');
      },
    };
    const decision = await evaluatePrePagingControls(
      alertInput(service.id),
      await loadPrePagingSnapshot(),
      broken
    );
    expect(decision).toMatchObject({ action: 'NONE', apply: false, failOpen: { reason: 'error' } });
    // Ingestion itself is untouched by the controls: a trigger still opens an incident.
    const result = await processEvent(
      {
        event_action: 'trigger',
        dedup_key: 'fail-open',
        payload: { summary: 'Still pages', source: 'test', severity: 'warning' },
      },
      service.id,
      'noise-test'
    );
    expect(result.action).toBe('triggered');
  });
});

describe('heartbeat monitors', () => {
  it('raises an incident through normal ingestion when pings stop, and resolves it when they return', async () => {
    const { service, actor } = await setup();
    const { monitor, token } = await createHeartbeatMonitor(
      {
        name: 'Nightly backup',
        serviceId: service.id,
        intervalSeconds: 60,
        graceSeconds: 30,
        urgency: 'HIGH',
      },
      actor
    );
    expect(monitor.tokenHash).not.toContain(token);
    expect(await recordHeartbeat('not-a-real-token-at-all-000000')).toBe('unknown');
    expect(await recordHeartbeat(token)).toBe('ok');
    const pinged = await db.heartbeatMonitor.findUniqueOrThrow({ where: { id: monitor.id } });
    expect(pinged.state).toBe('HEALTHY');

    const later = new Date(pinged.lastPingAt!.getTime() + 61_000);
    expect(await sweepHeartbeatMonitors(later)).toMatchObject({
      checked: 1,
      late: 1,
      missing: 0,
      raised: 0,
    });
    const missingAt = new Date(pinged.lastPingAt!.getTime() + 95_000);
    expect(await sweepHeartbeatMonitors(missingAt)).toMatchObject({ missing: 1, raised: 1 });
    const missing = await db.heartbeatMonitor.findUniqueOrThrow({ where: { id: monitor.id } });
    expect(missing.state).toBe('MISSING');
    const incident = await db.incident.findUniqueOrThrow({
      where: { id: missing.lastIncidentId! },
    });
    expect(incident).toMatchObject({ serviceId: service.id, status: 'OPEN', urgency: 'HIGH' });
    expect(incident.title).toContain('Heartbeat "Nightly backup" missing');
    // A second sweep does not raise twice.
    expect(await sweepHeartbeatMonitors(new Date(missingAt.getTime() + 60_000))).toMatchObject({
      missing: 1,
      raised: 0,
    });

    expect(await recordHeartbeat(token)).toBe('recovered');
    expect((await db.incident.findUniqueOrThrow({ where: { id: incident.id } })).status).toBe(
      'RESOLVED'
    );
    expect((await db.heartbeatMonitor.findUniqueOrThrow({ where: { id: monitor.id } })).state).toBe(
      'HEALTHY'
    );
  });

  it('sweeps expired rules and old decisions alongside heartbeats, never throwing', async () => {
    const { service, actor } = await setup();
    await createSuppressionRule(
      {
        name: 'Expired',
        matchers: [{ field: 'source', op: 'exists' }],
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      },
      actor
    );
    await db.prePagingDecision.create({
      data: {
        serviceId: service.id,
        control: 'SUPPRESSION',
        action: 'SUPPRESS',
        mode: 'SHADOW',
        applied: false,
        reason: 'old',
        evidence: {},
        createdAt: new Date(Date.now() - 400 * 86_400_000),
      },
    });
    const sweep = await sweepPrePagingControls();
    expect(sweep).toMatchObject({ expiredRulesDisabled: 1, decisionsPurged: 1 });
    expect((await db.suppressionRule.findFirstOrThrow()).enabled).toBe(false);
  });
});

describe('suggestions, simulation and correlation upgrades', () => {
  it('suggests a downgrade for a noisy service and the simulation predicts its effect', async () => {
    const { admin, service, actor } = await setup();
    const authorization = (await resolveUserActor(admin.id))!;
    for (let i = 0; i < 6; i += 1) {
      const createdAt = new Date(Date.now() - (i + 1) * 3_600_000);
      const incident = await createTestIncident(`Blip ${i}`, service.id, {
        createdAt,
        resolvedAt: new Date(createdAt.getTime() + 60_000),
        status: 'RESOLVED',
        urgency: 'MEDIUM',
      });
      await db.alert.create({
        data: {
          incidentId: incident.id,
          serviceId: service.id,
          createdAt,
          dedupKey: `blip-${i}`,
          severity: 'warning',
          fingerprintHash: `fp-${i}`,
          labels: {},
          payload: { summary: `Blip ${i}`, source: 'synthetic', severity: 'warning' },
        },
      });
    }
    const suggestions = await suggestSuppressionRules(authorization);
    expect(suggestions).toMatchObject([
      {
        serviceId: service.id,
        severity: 'warning',
        rule: { effect: 'DOWNGRADE', origin: 'SUGGESTED' },
      },
    ]);
    await createSuppressionRule(suggestions[0].rule, actor);
    await saveNoiseControlPolicy(
      {
        serviceId: service.id,
        mode: 'SHADOW',
        definition: { schemaVersion: 1 },
        expectedRevision: 0,
      },
      actor
    );
    const outcome = await simulatePrePagingControls(settings, {
      serviceId: service.id,
      days: 7,
      createdById: admin.id,
    });
    expect(outcome).toMatchObject({
      incidentsEvaluated: 6,
      downgraded: 6,
      pagesAvoided: 0,
      failOpen: 0,
    });
    expect(outcome.byControl).toEqual({ SUPPRESSION: 6 });
    expect(
      (await db.intelligenceEvaluationRun.findUniqueOrThrow({ where: { id: outcome.runId } }))
        .status
    ).toBe('COMPLETED');
  });

  it('lets HIGH urgency join a rule that allows it, as a suggestion, and can propose parent/child links', async () => {
    const { admin, service } = await setup();
    const rule = {
      id: 'storm',
      kind: 'CONTENT_TEMPLATE' as const,
      enabled: true,
      keys: [],
      windowSeconds: 600,
      maxWindowSeconds: 3600,
      minScore: 0.8,
      linkType: 'PARENT_CHILD' as const,
      allowHighUrgency: true,
    };
    await publishPolicyVersion(
      {},
      {
        mode: 'SUGGEST',
        definition: {
          ...DEFAULT_POLICY_DEFINITION,
          correlation: { rules: [rule], criticalBypass: true },
        },
        expectedHeadVersion: 0,
      },
      { actorId: admin.id, source: 'UI' }
    );
    const first = await createTestIncident('Database errors on node-1', service.id, {
      urgency: 'HIGH',
    });
    const second = await createTestIncident('Database errors on node-2', service.id, {
      urgency: 'HIGH',
    });
    for (const incident of [first, second])
      await db.$transaction(tx => indexIncident(incident.id, tx));
    expect(await correlateIncident({ subjectKey: first.id }, settings)).toMatchObject({
      outcome: 'correlated',
      groups: 1,
    });
    expect(await correlateIncident({ subjectKey: second.id }, settings)).toMatchObject({
      outcome: 'correlated',
      suggestions: 1,
    });
    const link = await db.incidentRelationship.findFirstOrThrow({
      where: { sourceIncidentId: second.id },
    });
    expect(link).toMatchObject({
      targetIncidentId: first.id,
      type: 'PARENT_CHILD',
      decision: 'SUGGESTED',
    });

    // Without the opt-in, highest urgency stays out of grouping exactly as before.
    await publishPolicyVersion(
      {},
      {
        mode: 'SUGGEST',
        definition: {
          ...DEFAULT_POLICY_DEFINITION,
          correlation: { rules: [{ ...rule, allowHighUrgency: false }], criticalBypass: true },
        },
        expectedHeadVersion: 1,
      },
      { actorId: admin.id, source: 'UI' }
    );
    const third = await createTestIncident('Database errors on node-3', service.id, {
      urgency: 'HIGH',
    });
    await db.$transaction(tx => indexIncident(third.id, tx));
    expect(await correlateIncident({ subjectKey: third.id }, settings)).toMatchObject({
      outcome: 'skipped_critical',
    });
  });
});
