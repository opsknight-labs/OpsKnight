import 'server-only';
import { z } from 'zod/v4';
import prisma from '@/lib/prisma';
import { serviceReadWhere } from '@/lib/authorization-filters';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import {
  builtinFields,
  snapshotSchema,
  type Action,
  type Snapshot,
} from '@/lib/automation/contract';
import {
  automationHref,
  describeConditions,
  suggestedRuleSchema,
} from '@/lib/automation/suggested-rule';
import { OPS_ROLLUPS, queryOpsRollup } from '@/lib/metric-rollup';
import type { AiDataClass, AiToolDefinition } from '../ai/port';
import { listInsightsForScope } from '../ops-insights/view';
import { readIncidentForActor } from './deterministic';

/**
 * Squire's automation tools (plan J1.6). Reading only: why an incident was routed the way it was, and what
 * one rule of a service does and how it behaved. The one way Squire touches automation is the
 * `draft_automation_rule` proposal, a link that opens the workspace with the rule pre-filled; it joins the
 * draft only when a person adds it there, and is published through the review that replays it first.
 *
 * Offered only to people who may read automation (automation.read); rule definitions are configuration
 * (Internal), never alert payloads.
 */
export const AUTOMATION_TOOL_DATA_CLASS: Readonly<Record<string, AiDataClass>> = {
  get_automation_decision: 'INTERNAL',
  explain_automation_rule: 'INTERNAL',
};

const NOT_FOUND = { error: 'Not found, or you do not have access to it.' };
const id = z.string().trim().min(1).max(64);
const decisionInput = z.object({ incidentId: id }).strict();
const ruleInput = z
  .object({
    serviceId: id,
    ruleId: id.optional(),
    ruleName: z.string().trim().min(1).max(100).optional(),
  })
  .strict()
  .refine(input => input.ruleId || input.ruleName, { message: 'ruleId or ruleName is required' });

const canReadAutomation = (actor: AuthorizationActor) =>
  hasCapability(actor.role, CAPABILITIES.AUTOMATION_READ);

async function readableService(actor: AuthorizationActor, serviceId: string) {
  try {
    return await prisma.service.findFirst({
      where: { AND: [{ id: serviceId }, serviceReadWhere(actor)] },
      select: { id: true, name: true },
    });
  } catch {
    return null;
  }
}

/** Policy names for the actions of a rule; archived or missing policies are said so, not hidden. */
async function policyNames(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await prisma.escalationPolicy.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, archivedAt: true },
  });
  return new Map(rows.map(row => [row.id, row.archivedAt ? `${row.name} (archived)` : row.name]));
}

export function describeAction(action: Action, policies: ReadonlyMap<string, string>): string {
  switch (action.type) {
    case 'SET_PRIORITY':
      return `set priority ${action.value}`;
    case 'SET_CONTEXT':
      return `set ${action.fieldKey} to ${String(action.value)}`;
    case 'ADD_TAG':
      return `add the tag ${action.value}`;
    case 'USE_SERVICE_DEFAULT':
      return "use the service's default escalation policy";
    case 'USE_ESCALATION_POLICY':
      return `route to ${policies.get(action.policyId) ?? 'an escalation policy that no longer exists'}`;
    case 'NO_ESCALATION':
      return 'open the incident without paging anyone';
    case 'NOTIFY_CHANNEL':
      return `notify a ${action.provider === 'SLACK' ? 'Slack' : 'Teams'} channel`;
  }
}

export function buildAutomationTools(actor: AuthorizationActor): AiToolDefinition[] {
  if (!canReadAutomation(actor)) return [];
  return [
    {
      name: 'get_automation_decision',
      description:
        'Explain why automation routed and prioritised one incident: the mode, the route rule that matched (or that none did and the service default applied), the escalation policy, the priority before and after automation, and any fallback. Returns nothing for incidents without an automation decision.',
      kind: 'READ',
      inputSchema: {
        type: 'object',
        properties: { incidentId: { type: 'string', minLength: 1, maxLength: 64 } },
        required: ['incidentId'],
        additionalProperties: false,
      },
      execute: async input => {
        const parsed = decisionInput.safeParse(input);
        if (!parsed.success) return { error: 'Invalid input' };
        if (!(await readIncidentForActor(actor, parsed.data.incidentId))) return NOT_FOUND;
        const decision = await prisma.incidentAutomationDecision.findUnique({
          where: { incidentId: parsed.data.incidentId },
          select: {
            serviceId: true,
            mode: true,
            routeType: true,
            escalationPolicyId: true,
            escalationPolicyNameSnapshot: true,
            matchedRouteRuleId: true,
            matchedRouteRuleName: true,
            basePriority: true,
            finalPriority: true,
            fallbackReason: true,
            evaluationAt: true,
            version: { select: { versionNumber: true } },
          },
        });
        if (!decision)
          return { decision: null, note: 'Automation made no decision for this incident.' };
        const route =
          decision.routeType === 'NO_ESCALATION'
            ? 'opened without paging anyone'
            : decision.routeType === 'ESCALATION_POLICY'
              ? `routed to ${decision.escalationPolicyNameSnapshot ?? 'an escalation policy'}`
              : "routed to the service's default escalation policy";
        const why = decision.fallbackReason
          ? `Automation fell back (${decision.fallbackReason}), so the service default applied.`
          : decision.matchedRouteRuleName
            ? `The route rule “${decision.matchedRouteRuleName}” matched first.`
            : 'No route rule matched.';
        return {
          decision: {
            mode: decision.mode,
            versionNumber: decision.version?.versionNumber ?? null,
            routeType: decision.routeType,
            escalationPolicyId: decision.escalationPolicyId,
            escalationPolicyName: decision.escalationPolicyNameSnapshot,
            matchedRule: decision.matchedRouteRuleId
              ? { id: decision.matchedRouteRuleId, name: decision.matchedRouteRuleName }
              : null,
            basePriority: decision.basePriority,
            finalPriority: decision.finalPriority,
            fallbackReason: decision.fallbackReason,
            evaluatedAt: decision.evaluationAt.toISOString(),
          },
          explanation: `${why} The incident was ${route}${
            decision.basePriority !== decision.finalPriority
              ? `, and its priority changed from ${decision.basePriority ?? 'none'} to ${decision.finalPriority ?? 'none'}`
              : ''
          }.${decision.mode === 'SHADOW' ? ' Automation is in shadow mode, so this decision was recorded but not applied.' : ''}`,
          serviceId: decision.serviceId,
        };
      },
    },
    {
      name: 'explain_automation_rule',
      description:
        "Explain one automation rule of a service's live version: when it applies, what it does, where it sits in the order, how often it matched in the last 30 days, and open rule-health findings about it. Name the rule by id or by its name.",
      kind: 'READ',
      inputSchema: {
        type: 'object',
        properties: {
          serviceId: { type: 'string', minLength: 1, maxLength: 64 },
          ruleId: { type: 'string', minLength: 1, maxLength: 64 },
          ruleName: { type: 'string', minLength: 1, maxLength: 100 },
        },
        required: ['serviceId'],
        additionalProperties: false,
      },
      execute: async input => {
        const parsed = ruleInput.safeParse(input);
        if (!parsed.success) return { error: 'Give the service id and a rule id or name.' };
        const service = await readableService(actor, parsed.data.serviceId);
        if (!service) return NOT_FOUND;
        const config = await prisma.serviceAutomationConfig.findUnique({
          where: { serviceId: service.id },
          select: {
            mode: true,
            activeVersion: { select: { id: true, versionNumber: true, snapshot: true } },
          },
        });
        const snapshot = snapshotSchema.safeParse(config?.activeVersion?.snapshot);
        if (!config?.activeVersion || !snapshot.success)
          return { rule: null, note: 'This service has no published automation version.' };
        const wanted = parsed.data.ruleName?.toLowerCase();
        const rule = snapshot.data.rules.find(candidate =>
          parsed.data.ruleId
            ? candidate.id === parsed.data.ruleId
            : candidate.name.toLowerCase() === wanted
        );
        if (!rule)
          return {
            rule: null,
            rules: snapshot.data.rules
              .slice(0, 25)
              .map(r => ({ id: r.id, name: r.name, phase: r.phase })),
            note: 'No rule with that id or name in the live version. These are its rules.',
          };
        const samePhase = snapshot.data.rules.filter(r => r.phase === rule.phase);
        const policies = await policyNames(
          rule.actions.flatMap(action =>
            action.type === 'USE_ESCALATION_POLICY' ? [action.policyId] : []
          )
        );
        const now = new Date();
        const matches =
          rule.phase === 'ROUTE'
            ? (
                await queryOpsRollup(OPS_ROLLUPS.automationRuleMatch, {
                  from: new Date(now.getTime() - 30 * 86_400_000),
                  to: now,
                  subjectKey: config.activeVersion.id,
                })
              ).reduce(
                (sum, point) =>
                  (point.tags as { ruleId?: unknown } | null)?.ruleId === rule.id
                    ? sum + point.count
                    : sum,
                0
              )
            : null;
        const findings = (await listInsightsForScope(actor, { type: 'SERVICE', id: service.id }))
          .filter(
            insight =>
              insight.kind === 'automation.rule_health' && insight.key.endsWith(`:${rule.id}`)
          )
          .map(insight => ({
            severity: insight.severity,
            title: insight.title,
            summary: insight.summary,
          }));
        const when = rule.conditions.length
          ? describeConditions(rule.conditions)
          : 'every incident';
        return {
          rule: {
            id: rule.id,
            name: rule.name,
            phase: rule.phase,
            enabled: rule.enabled,
            position: samePhase.indexOf(rule) + 1,
            of: samePhase.length,
            conditions: rule.conditions,
            actions: rule.actions.map(action => describeAction(action, policies)),
          },
          explanation: `${rule.enabled ? '' : 'This rule is disabled. '}When ${when}, it will ${rule.actions
            .map(action => describeAction(action, policies))
            .join(' and ')}. ${
            rule.phase === 'ROUTE'
              ? `Route rules are checked in order and the first match wins; this is number ${samePhase.indexOf(rule) + 1} of ${samePhase.length}.`
              : 'Enrichment rules all apply, in order, before routing.'
          }`,
          matchesLast30Days: matches,
          mode: config.mode,
          versionNumber: config.activeVersion.versionNumber,
          findings,
        };
      },
    },
  ];
}

const short = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/**
 * The card for a `draft_automation_rule` proposal: a link into the incident's service automation with the
 * rule pre-filled. Null when it could not be used anyway: the person may not edit automation, the rule is
 * not valid, a field is unknown to the service, or the policy does not exist.
 */
export async function describeAutomationRuleDraft(
  actor: AuthorizationActor,
  incidentId: string,
  input: Record<string, unknown>
): Promise<{ title: string; detail: string; href: string; impact: 'AUTOMATION' } | null> {
  if (!hasCapability(actor.role, CAPABILITIES.AUTOMATION_EDIT)) return null;
  const incident = await prisma.incident.findUnique({
    where: { id: incidentId },
    select: { serviceId: true },
  });
  const service = incident && (await readableService(actor, incident.serviceId));
  if (!service) return null;
  const parsed = suggestedRuleSchema.safeParse({
    name: input.name ?? 'Suggested by Squire',
    conditions: input.conditions,
    priority: input.priority,
    policyId: input.policyId,
    noEscalation: input.noEscalation,
  });
  if (!parsed.success) return null;
  const rule = parsed.data;

  const config = await prisma.serviceAutomationConfig.findUnique({
    where: { serviceId: service.id },
    select: {
      activeVersion: { select: { snapshot: true } },
      draft: { select: { snapshot: true } },
    },
  });
  const known = new Set(builtinFields.map(field => field.key));
  for (const raw of [config?.activeVersion?.snapshot, config?.draft?.snapshot]) {
    const snapshot = snapshotSchema.safeParse(raw);
    if (snapshot.success)
      for (const field of (snapshot.data as Snapshot).fields) known.add(field.key);
  }
  if (rule.conditions.some(condition => !known.has(condition.fieldKey))) return null;
  let destination = rule.priority
    ? `set priority ${rule.priority}`
    : 'open the incident without paging anyone';
  if (rule.policyId) {
    const policy = await prisma.escalationPolicy.findFirst({
      where: { id: rule.policyId, archivedAt: null },
      select: { name: true },
    });
    if (!policy) return null;
    destination = `route to ${short(policy.name, 80)}`;
  }
  return {
    title: 'Draft an automation rule',
    detail: `Open automation for “${short(service.name, 80)}” with a new rule: when ${short(describeConditions(rule.conditions), 200)}, ${destination}. It joins the draft only if you add it there, and publishing replays it against recent incidents first.`,
    href: automationHref(service.id, { suggestion: rule }),
    impact: 'AUTOMATION',
  };
}
