import { beforeEach, describe, expect, it } from 'vitest';
import { resolveUserActor } from '@/lib/authorization-actors';
import { compileAutomation } from '@/lib/automation/compiler';
import type { Snapshot } from '@/lib/automation/contract';
import { parseSuggestedRule, SUGGESTED_RULE_PARAM } from '@/lib/automation/suggested-rule';
import { buildProposal } from '@/lib/intelligence/squire/actions/proposals';
import { buildAutomationTools } from '@/lib/intelligence/squire/tools-automation';
import {
  createTestEscalationPolicy,
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

const actorOf = async (role: 'ADMIN' | 'RESPONDER' | 'USER', teamId?: string) => {
  const user = await createTestUser({ role });
  if (teamId) await db.teamMember.create({ data: { userId: user.id, teamId, role: 'MEMBER' } });
  return (await resolveUserActor(user.id))!;
};

async function setup() {
  const team = await createTestTeam('Payments');
  const outsiders = await createTestTeam('Search');
  const policy = await createTestEscalationPolicy('Payments urgent', []);
  const service = await createTestService('Payments API', team.id);
  const snapshot: Snapshot = {
    schemaVersion: 1,
    fields: [],
    rules: [
      {
        id: 'page-critical',
        name: 'Page critical',
        phase: 'ROUTE',
        enabled: true,
        conditions: [{ fieldKey: 'severity', operator: 'EQ', value: 'critical' }],
        actions: [{ type: 'USE_ESCALATION_POLICY', policyId: policy.id }],
      },
    ],
  };
  const admin = await createTestUser({ role: 'ADMIN' });
  const version = await db.automationVersion.create({
    data: {
      serviceId: service.id,
      versionNumber: 3,
      snapshot,
      compiledSnapshot: compileAutomation(snapshot).compiled,
      checksum: 'c',
      publishedBy: admin.id,
      lintReport: [],
    },
  });
  await db.serviceAutomationConfig.create({
    data: { serviceId: service.id, mode: 'LIVE', activeVersionId: version.id },
  });
  const incident = await createTestIncident('Card payments failing', service.id);
  await db.incidentAutomationDecision.create({
    data: {
      incidentId: incident.id,
      serviceId: service.id,
      versionId: version.id,
      mode: 'LIVE',
      routeType: 'ESCALATION_POLICY',
      escalationPolicyId: policy.id,
      escalationPolicyNameSnapshot: 'Payments urgent',
      matchedRouteRuleId: 'page-critical',
      matchedRouteRuleName: 'Page critical',
      basePriority: 'P3',
      finalPriority: 'P1',
      evaluationAt: new Date(),
      summary: {},
    },
  });
  return { team, outsiders, policy, service, incident };
}

const tool = (tools: ReturnType<typeof buildAutomationTools>, name: string) =>
  tools.find(candidate => candidate.name === name)!;

describe('Squire automation read tools', () => {
  it('explains a routing decision and a rule to people who may read automation', async () => {
    const { team, service, incident, policy } = await setup();
    const tools = buildAutomationTools(await actorOf('RESPONDER', team.id));
    expect(tools.map(t => t.name)).toEqual(['get_automation_decision', 'explain_automation_rule']);

    const decision = (await tool(tools, 'get_automation_decision').execute!({
      incidentId: incident.id,
    })) as { decision: Record<string, unknown>; explanation: string };
    expect(decision.decision).toMatchObject({
      mode: 'LIVE',
      versionNumber: 3,
      matchedRule: { id: 'page-critical', name: 'Page critical' },
      basePriority: 'P3',
      finalPriority: 'P1',
    });
    expect(decision.explanation).toBe(
      'The route rule “Page critical” matched first. The incident was routed to Payments urgent, and its priority changed from P3 to P1.'
    );

    const explained = (await tool(tools, 'explain_automation_rule').execute!({
      serviceId: service.id,
      ruleName: 'page critical',
    })) as { rule: Record<string, unknown>; explanation: string; matchesLast30Days: number };
    expect(explained.rule).toMatchObject({ id: 'page-critical', position: 1, of: 1 });
    expect(explained.explanation).toBe(
      `When severity is critical, it will route to ${policy.name}. Route rules are checked in order and the first match wins; this is number 1 of 1.`
    );
    expect(explained.matchesLast30Days).toBe(0);
  });

  it('offers nothing to people without automation access, and finds nothing they cannot read', async () => {
    const { team, service } = await setup();
    // Service members with the USER role read the service but not its automation.
    expect(buildAutomationTools(await actorOf('USER', team.id))).toEqual([]);
    const tools = buildAutomationTools(await actorOf('RESPONDER', team.id));
    expect(
      await tool(tools, 'get_automation_decision').execute!({ incidentId: 'no-such-incident' })
    ).toEqual({ error: 'Not found, or you do not have access to it.' });
    expect(
      await tool(tools, 'explain_automation_rule').execute!({
        serviceId: 'no-such-service',
        ruleId: 'x',
      })
    ).toEqual({ error: 'Not found, or you do not have access to it.' });
    expect(
      await tool(tools, 'explain_automation_rule').execute!({ serviceId: service.id })
    ).toEqual({ error: 'Give the service id and a rule id or name.' });
  });
});

describe('draft_automation_rule proposal', () => {
  it('is a link to the pre-filled editor, never a write, and only for people who can edit automation', async () => {
    const { team, service, incident, policy } = await setup();
    const responder = await actorOf('RESPONDER', team.id);
    const proposal = await buildProposal(responder, 'draft_automation_rule', {
      incidentId: incident.id,
      conditions: [{ fieldKey: 'source', operator: 'EQ', value: 'stripe' }],
      policyId: policy.id,
    });
    expect(proposal).toMatchObject({
      kind: 'NAVIGATE',
      action: 'draft_automation_rule',
      title: 'Draft an automation rule',
      impact: 'AUTOMATION',
    });
    expect(proposal!.detail).toContain('when source is stripe, route to Payments urgent');
    const href = new URL(proposal!.href!, 'https://app.example');
    expect(href.pathname).toBe(`/services/${service.id}`);
    expect(parseSuggestedRule(href.searchParams.get(SUGGESTED_RULE_PARAM))).toMatchObject({
      policyId: policy.id,
      conditions: [{ fieldKey: 'source', operator: 'EQ', value: 'stripe' }],
    });
    expect(await db.automationDraft.count()).toBe(0);

    // Unknown fields, two outcomes, archived policies and people who cannot edit automation get no card.
    const invalid = [
      {
        conditions: [{ fieldKey: 'customer_tier', operator: 'EQ', value: 'gold' }],
        priority: 'P1',
      },
      {
        conditions: [{ fieldKey: 'severity', operator: 'EQ', value: 'critical' }],
        priority: 'P1',
        noEscalation: true,
      },
    ];
    for (const input of invalid)
      expect(
        await buildProposal(responder, 'draft_automation_rule', {
          incidentId: incident.id,
          ...input,
        })
      ).toBeNull();
    await db.escalationPolicy.update({
      where: { id: policy.id },
      data: { archivedAt: new Date() },
    });
    expect(
      await buildProposal(responder, 'draft_automation_rule', {
        incidentId: incident.id,
        conditions: [{ fieldKey: 'severity', operator: 'EQ', value: 'critical' }],
        policyId: policy.id,
      })
    ).toBeNull();
    const viewer = await actorOf('USER', team.id);
    expect(
      await buildProposal(viewer, 'draft_automation_rule', {
        incidentId: incident.id,
        conditions: [{ fieldKey: 'severity', operator: 'EQ', value: 'critical' }],
        priority: 'P1',
      })
    ).toBeNull();
  });
});
