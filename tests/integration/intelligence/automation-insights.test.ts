import { beforeEach, describe, expect, it } from 'vitest';
import { resolveUserActor } from '@/lib/authorization-actors';
import { compileAutomation } from '@/lib/automation/compiler';
import type { Snapshot } from '@/lib/automation/contract';
import { parseSuggestedRule, SUGGESTED_RULE_PARAM } from '@/lib/automation/suggested-rule';
import { resetOpsInsightsSchedule, runOpsInsights } from '@/lib/intelligence/ops-insights/handlers';
import { automationRuleHealthProducer } from '@/lib/intelligence/ops-insights/producers/automation-rule-health';
import { automationSuggestedRulesProducer } from '@/lib/intelligence/ops-insights/producers/automation-suggested-rules';
import { updateOpsInsightSwitches } from '@/lib/intelligence/ops-insights/settings';
import { listInsightsForScope } from '@/lib/intelligence/ops-insights/view';
import { getIntelligenceSettings } from '@/lib/intelligence/settings/service';
import { generateOpsRollups } from '@/lib/metric-rollup';
import {
  createTestEscalationPolicy,
  createTestService,
  createTestTeam,
  createTestUser,
  resetDatabase,
  testPrisma as db,
} from '../../helpers/test-db';

const DAY = 86_400_000;
const MINUTE = 60_000;

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test')) {
    throw new Error('Dedicated test DB required');
  }
  await resetDatabase();
  resetOpsInsightsSchedule();
});

async function switchOn(automation = true) {
  const admin = await createTestUser({ role: 'ADMIN' });
  const current = await getIntelligenceSettings();
  await updateOpsInsightSwitches(
    {
      opsInsightsEnabled: true,
      opsInsightsAutomationEnabled: automation,
      opsInsightsEscalationEnabled: false,
      opsInsightsOnCallEnabled: false,
      opsInsightsPostmortemsEnabled: false,
      opsInsightsRunbooksEnabled: false,
      opsInsightsNotificationsEnabled: false,
      expectedRevision: current.revision,
    },
    { actorId: admin.id, source: 'UI' }
  );
  return admin;
}

const run = async (serviceId: string, kind: string) =>
  runOpsInsights(
    { subjectKey: `SERVICE:${serviceId}`, generation: 1, force: true },
    await getIntelligenceSettings(),
    {
      producers: [automationRuleHealthProducer, automationSuggestedRulesProducer].filter(
        producer => producer.kind === kind
      ),
    }
  );

/** An incident opened by one alert, optionally decided by automation and corrected by a person. */
async function incident(
  serviceId: string,
  index: number,
  options: {
    at: Date;
    payload: Record<string, unknown>;
    priority?: string | null;
    visibility?: 'PUBLIC' | 'PRIVATE';
    decision?: { versionId: string; policyId: string; ruleId: string };
    correctedAfterMinutes?: number;
    acknowledged?: boolean;
  }
) {
  const created = await db.incident.create({
    data: {
      title: `incident ${index}`,
      serviceId,
      status: 'OPEN',
      urgency: 'HIGH',
      priority: options.priority ?? null,
      visibility: options.visibility ?? 'PUBLIC',
      createdAt: options.at,
      acknowledgedAt: options.acknowledged ? new Date(options.at.getTime() + MINUTE) : null,
    },
  });
  await db.alert.create({
    data: {
      serviceId,
      incidentId: created.id,
      dedupKey: `k-${serviceId}-${index}`,
      createdAt: options.at,
      payload: { summary: 'x', ...options.payload },
    },
  });
  if (options.decision)
    await db.incidentAutomationDecision.create({
      data: {
        incidentId: created.id,
        serviceId,
        versionId: options.decision.versionId,
        mode: 'LIVE',
        routeType: 'ESCALATION_POLICY',
        escalationPolicyId: options.decision.policyId,
        matchedRouteRuleId: options.decision.ruleId,
        matchedRouteRuleName: 'Page critical',
        evaluationAt: options.at,
        summary: {},
        createdAt: options.at,
      },
    });
  if (options.correctedAfterMinutes !== undefined)
    await db.incidentEvent.create({
      data: {
        incidentId: created.id,
        message: `Priority updated to ${options.priority ?? 'P1'}`,
        createdAt: new Date(options.at.getTime() + options.correctedAfterMinutes * MINUTE),
      },
    });
  return created;
}

const healthSnapshot = (policyId: string): Snapshot => ({
  schemaVersion: 1,
  fields: [
    {
      fieldId: 'env',
      key: 'environment',
      label: 'Environment',
      type: 'ENUM',
      caseSensitive: false,
      allowedValues: ['production'],
      aliases: {},
      mappings: [{ source: 'EVENT', path: 'payload.custom_details.environment' }],
    },
  ],
  rules: [
    {
      id: 'tag-prod',
      name: 'Tag production',
      phase: 'ENRICH',
      enabled: true,
      conditions: [{ fieldKey: 'environment', operator: 'EQ', value: 'production' }],
      actions: [{ type: 'ADD_TAG', value: 'prod' }],
    },
    {
      id: 'page-critical',
      name: 'Page critical',
      phase: 'ROUTE',
      enabled: true,
      conditions: [{ fieldKey: 'severity', operator: 'EQ', value: 'critical' }],
      actions: [{ type: 'USE_ESCALATION_POLICY', policyId }],
    },
    {
      id: 'also-critical',
      name: 'Also critical',
      phase: 'ROUTE',
      enabled: true,
      conditions: [{ fieldKey: 'severity', operator: 'EQ', value: 'critical' }],
      actions: [{ type: 'NO_ESCALATION' }],
    },
    {
      id: 'never',
      name: 'Never',
      phase: 'ROUTE',
      enabled: true,
      conditions: [{ fieldKey: 'source', operator: 'EQ', value: 'nobody-sends-this' }],
      actions: [{ type: 'NO_ESCALATION' }],
    },
  ],
});

async function automate(serviceId: string, snapshot: Snapshot, publishedDaysAgo: number) {
  const admin = await createTestUser({ role: 'ADMIN' });
  const { compiled } = compileAutomation(snapshot);
  const version = await db.automationVersion.create({
    data: {
      serviceId,
      versionNumber: 1,
      snapshot,
      compiledSnapshot: compiled,
      checksum: 'c1',
      publishedBy: admin.id,
      publishedAt: new Date(Date.now() - publishedDaysAgo * DAY),
      lintReport: [],
    },
  });
  await db.serviceAutomationConfig.create({
    data: { serviceId, mode: 'LIVE', activeVersionId: version.id },
  });
  return version;
}

describe('automation rule health from real traffic', () => {
  it('finds never-matched, shadowed, unmapped, overridden and unacknowledged routes with known counts', async () => {
    await switchOn();
    const policy = await createTestEscalationPolicy('Quiet', []);
    const service = await createTestService('Checkout');
    const version = await automate(service.id, healthSnapshot(policy.id), 20);
    // 60 critical incidents over the last 6 days, all routed by "page-critical" to a policy nobody acks;
    // 20 had their priority changed within 5 minutes, and every one carries an unknown environment.
    for (let index = 0; index < 60; index++)
      await incident(service.id, index, {
        at: new Date(Date.now() - (2 + (index % 4)) * DAY - index * MINUTE),
        payload: { source: 'prom', severity: 'critical', custom_details: { environment: 'prd-x' } },
        priority: 'P1',
        decision: { versionId: version.id, policyId: policy.id, ruleId: 'page-critical' },
        correctedAfterMinutes: index < 20 ? 5 : undefined,
      });
    await generateOpsRollups(new Date(), { force: true });

    expect(await run(service.id, 'automation.rule_health')).toBe('computed');
    const rows = await db.opsInsight.findMany({ orderBy: { key: 'asc' } });
    expect(rows.map(row => [row.key, row.severity])).toEqual([
      ['never-matched:never', 'INFO'],
      ['never-matched:tag-prod', 'INFO'],
      ['overridden:page-critical', 'WARNING'],
      [`policy-no-ack:${policy.id}`, 'WARNING'],
      ['shadowed:also-critical', 'WARNING'],
      ['unmapped:environment', 'WARNING'],
    ]);
    const byKey = new Map(rows.map(row => [row.key, row]));
    expect(byKey.get('overridden:page-critical')!.evidence).toMatchObject({
      facts: [
        { label: 'Incidents routed', value: '60' },
        { label: 'Corrected within 15 minutes', value: '20' },
      ],
    });
    expect(byKey.get('never-matched:never')).toMatchObject({
      title: 'A route rule has not matched in 20 days',
      draftHref: `/services/${service.id}?tab=automation&automationRule=never`,
    });
    expect(byKey.get('shadowed:also-critical')!.evidence).toMatchObject({
      facts: [{ label: 'Conditions held', value: '60' }, expect.anything()],
    });
    // Nothing a service reader without automation access could not see: no rule, field or policy names.
    expect(JSON.stringify(rows.map(r => [r.title, r.summary, r.evidence]))).not.toMatch(
      /Page critical|Also critical|environment|Quiet/
    );
  });

  it('says nothing for a service without live automation, or while the area is off', async () => {
    await switchOn(false);
    const service = await createTestService('Manual');
    expect(await run(service.id, 'automation.rule_health')).toBe('computed');
    expect(await db.opsInsight.count()).toBe(0);
  });
});

describe('suggested rules mined from history', () => {
  it('suggests the correction people keep making, with known support, scoped to readers of the service', async () => {
    await switchOn();
    const team = await createTestTeam('Payments');
    const other = await createTestTeam('Search');
    const service = await createTestService('Payments API', team.id);
    // 12 critical alerts from "db" were all raised to P1 by a person; 20 warnings from "db" were left alone.
    // Private incidents never feed a suggestion.
    let index = 0;
    for (; index < 12; index++)
      await incident(service.id, index, {
        at: new Date(Date.now() - 3 * DAY - index * MINUTE),
        payload: { source: 'DB', severity: 'critical' },
        priority: 'P1',
        correctedAfterMinutes: 30,
      });
    for (; index < 32; index++)
      await incident(service.id, index, {
        at: new Date(Date.now() - 4 * DAY - index * MINUTE),
        payload: { source: 'db', severity: 'warning' },
        priority: 'P3',
      });
    for (; index < 52; index++)
      await incident(service.id, index, {
        at: new Date(Date.now() - 4 * DAY - index * MINUTE),
        payload: { source: 'secret-host', severity: 'info' },
        priority: 'P2',
        visibility: 'PRIVATE',
        correctedAfterMinutes: 1,
      });

    expect(await run(service.id, 'automation.suggested_rule')).toBe('computed');
    const rows = await db.opsInsight.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: 'automation.suggested_rule',
      key: 'rule:severity=critical&source=>P1',
      title: 'Suggested rule: set P1 when severity is critical',
    });
    expect(rows[0].evidence).toMatchObject({
      facts: [
        { label: 'Incidents with these facts', value: '12' },
        { label: 'Changed to P1 by a person', value: '12' },
        expect.objectContaining({ label: 'Confidence (lower bound)' }),
      ],
    });
    expect(JSON.stringify(rows)).not.toContain('secret-host');
    const href = new URL(rows[0].draftHref!, 'https://app.example');
    expect(parseSuggestedRule(href.searchParams.get(SUGGESTED_RULE_PARAM))).toMatchObject({
      conditions: [{ fieldKey: 'severity', operator: 'EQ', value: 'critical' }],
      priority: 'P1',
    });

    const member = await createTestUser({ role: 'USER' });
    await db.teamMember.create({ data: { userId: member.id, teamId: team.id, role: 'MEMBER' } });
    const outsider = await createTestUser({ role: 'USER' });
    await db.teamMember.create({ data: { userId: outsider.id, teamId: other.id, role: 'MEMBER' } });
    const scope = { type: 'SERVICE' as const, id: service.id };
    expect(await listInsightsForScope((await resolveUserActor(member.id))!, scope)).toHaveLength(1);
    expect(await listInsightsForScope((await resolveUserActor(outsider.id))!, scope)).toEqual([]);
  });

  it('does not suggest a rule the draft already has', async () => {
    await switchOn();
    const service = await createTestService('Has rule');
    const snapshot: Snapshot = {
      schemaVersion: 1,
      fields: [],
      rules: [
        {
          id: 'p1',
          name: 'Critical is P1',
          phase: 'ENRICH',
          enabled: true,
          conditions: [{ fieldKey: 'severity', operator: 'EQ', value: 'critical' }],
          actions: [{ type: 'SET_PRIORITY', value: 'P1' }],
        },
      ],
    };
    await automate(service.id, snapshot, 1);
    for (let index = 0; index < 12; index++)
      await incident(service.id, index, {
        at: new Date(Date.now() - 3 * DAY - index * MINUTE),
        payload: { source: 'db', severity: 'critical' },
        priority: 'P1',
        correctedAfterMinutes: 30,
      });
    for (let index = 12; index < 32; index++)
      await incident(service.id, index, {
        at: new Date(Date.now() - 4 * DAY - index * MINUTE),
        payload: { source: 'db', severity: 'warning' },
        priority: 'P3',
      });
    expect(await run(service.id, 'automation.suggested_rule')).toBe('computed');
    expect((await db.opsInsight.findMany()).map(r => r.key)).toEqual([]);
  });
});

describe('team hand-offs mined into policy routes', () => {
  it('suggests routing through the policy that pages the team people keep handing incidents to', async () => {
    await switchOn();
    const dba = await createTestTeam('DBA');
    const shared = await createTestTeam('Shared');
    const own = await db.escalationPolicy.create({ data: { name: 'Service default' } });
    const dbaPolicy = await db.escalationPolicy.create({
      data: {
        name: 'DBA first',
        steps: { create: [{ stepOrder: 0, targetType: 'TEAM', targetTeamId: dba.id }] },
      },
    });
    // The shared team is paged first by two policies: no single route to suggest.
    for (const name of ['Shared A', 'Shared B'])
      await db.escalationPolicy.create({
        data: {
          name,
          steps: { create: [{ stepOrder: 0, targetType: 'TEAM', targetTeamId: shared.id }] },
        },
      });
    const service = await createTestService('Orders');
    await db.service.update({ where: { id: service.id }, data: { escalationPolicyId: own.id } });

    const handOff = async (
      index: number,
      source: string,
      team: { id: string; name: string } | null
    ) => {
      const at = new Date(Date.now() - 3 * DAY - index * MINUTE);
      await incident(service.id, index, { at, payload: { source, severity: 'warning' } });
      if (!team) return;
      const row = await db.incident.findFirstOrThrow({
        where: { serviceId: service.id, title: `incident ${index}` },
      });
      await db.incident.update({ where: { id: row.id }, data: { teamId: team.id } });
      await db.incidentEvent.create({
        data: {
          incidentId: row.id,
          type: 'ASSIGNMENT',
          message: `Incident assigned to team: ${team.name}`,
          createdAt: new Date(at.getTime() + 10 * MINUTE),
        },
      });
    };
    let index = 0;
    for (; index < 10; index++) await handOff(index, 'postgres', dba);
    for (; index < 20; index++) await handOff(index, 'queue', shared);
    for (; index < 40; index++) await handOff(index, 'web', null);

    expect(await run(service.id, 'automation.suggested_rule')).toBe('computed');
    const rows = await db.opsInsight.findMany();
    expect(rows.map(row => row.key)).toEqual([`rule:severity=&source=postgres>team:${dba.id}`]);
    expect(rows[0].title).toBe(
      "Suggested rule: route through the team's policy when source is postgres"
    );
    expect(JSON.stringify(rows)).not.toContain('DBA first');
    const href = new URL(rows[0].draftHref!, 'https://app.example');
    expect(parseSuggestedRule(href.searchParams.get(SUGGESTED_RULE_PARAM))).toMatchObject({
      conditions: [{ fieldKey: 'source', operator: 'EQ', value: 'postgres' }],
      policyId: dbaPolicy.id,
    });
  });
});
