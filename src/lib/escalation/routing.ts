import type { Prisma } from '@prisma/client';
import type { z } from 'zod';
import prisma from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import { responderSnapshotSchema } from './automation-snapshot';
export const responderPolicyInclude = {
  steps: {
    include: { targetUser: true, targetTeam: true, targetSchedule: true },
    orderBy: { stepOrder: 'asc' as const },
  },
};
export type Policy = Prisma.EscalationPolicyGetPayload<{ include: typeof responderPolicyInclude }>;
export type ResponderRouting = {
  type: 'DEFAULT_POLICY' | 'SELECTED_POLICY' | 'NO_ESCALATION' | 'DEFAULT_FANOUT';
  policy: Policy | null;
  pinnedConditions?: Map<string, { field: string; operator: string; values: string[] }[]>;
};

export function buildResponderRoutingFromAutomation(
  automation: {
    mode: 'SHADOW' | 'LIVE';
    policyId: string | null;
    evaluationAt: Date;
    responderPolicy?: z.infer<typeof responderSnapshotSchema> | null;
    result: { outcome: { type: string } } | null;
  }
): ResponderRouting | null {
  if (automation.mode !== 'LIVE') return null;
  if (automation.result?.outcome.type === 'NO_ESCALATION') {
    return { type: 'NO_ESCALATION', policy: null };
  }
  if (automation.policyId) {
    const snapshot = automation.responderPolicy;
    if (!snapshot) return null;
    return {
      type: automation.result?.outcome.type === 'ESCALATION_POLICY' ? 'SELECTED_POLICY' : 'DEFAULT_POLICY',
      policy: {
        id: snapshot.id,
        name: snapshot.name,
        description: null,
        archivedAt: null,
        archivedBy: null,
        revision: 0,
        createdAt: automation.evaluationAt,
        updatedAt: automation.evaluationAt,
        steps: snapshot.steps.map(({ conditions: _conditions, ...step }) => ({
          ...step,
          targetUser: null,
          targetTeam: null,
          targetSchedule: null,
        })),
      },
      pinnedConditions: new Map(snapshot.steps.map(step => [step.id, step.conditions])),
    };
  }
  return { type: 'DEFAULT_FANOUT', policy: null };
}

export async function resolveIncidentResponderRouting(
  incidentId: string,
  serviceId: string,
  client: Prisma.TransactionClient = prisma,
  defaultPolicy?: Policy | null
): Promise<ResponderRouting> {
  const decision = client.incidentAutomationDecision
    ? await client.incidentAutomationDecision.findUnique({ where: { incidentId } })
    : null;
  if (decision?.mode === 'LIVE' && decision.routeType === 'NO_ESCALATION')
    return { type: 'NO_ESCALATION', policy: null };
  if (decision?.mode === 'LIVE' && decision.escalationPolicyId) {
    const summary = decision.summary;
    if (
      summary &&
      typeof summary === 'object' &&
      !Array.isArray(summary) &&
      'responderPolicy' in summary
    ) {
      const parsed = responderSnapshotSchema.safeParse(summary.responderPolicy);
      if (!parsed.success || parsed.data.id !== decision.escalationPolicyId)
        throw new AppError({
          code: 'AUTOMATION_PINNED_POLICY_INVALID',
          userMessage: 'The pinned escalation definition failed integrity validation.',
        });
      const snapshot = parsed.data;
      return {
        type: decision.routeType === 'ESCALATION_POLICY' ? 'SELECTED_POLICY' : 'DEFAULT_POLICY',
        policy: {
          id: snapshot.id,
          name: snapshot.name,
          description: null,
          // A pinned definition remains usable independently of today's archive state.
          archivedAt: null,
          archivedBy: null,
          // Synthetic in-memory policy: REST resource revisions apply only to stored rows.
          revision: 0,
          createdAt: decision.createdAt,
          updatedAt: decision.createdAt,
          steps: snapshot.steps.map(({ conditions: _conditions, ...step }) => ({
            ...step,
            targetUser: null,
            targetTeam: null,
            targetSchedule: null,
          })),
        },
        pinnedConditions: new Map(snapshot.steps.map(step => [step.id, step.conditions])),
      };
    }
    throw new AppError({
      code: 'AUTOMATION_PINNED_POLICY_MISSING',
      userMessage:
        'This LIVE incident has no valid pinned escalation definition. Escalation is paused for integrity review; the current mutable policy cannot be used.',
    });
  }
  // A default route that originally had no policy pins default fanout too.
  if (decision?.mode === 'LIVE' && !decision.escalationPolicyId)
    return { type: 'DEFAULT_FANOUT', policy: null };
  const policy =
    defaultPolicy !== undefined
      ? defaultPolicy
      : ((
          await client.service.findUnique({
            where: { id: serviceId },
            include: { policy: { include: responderPolicyInclude } },
          })
        )?.policy ?? null);
  return { type: policy?.steps.length ? 'DEFAULT_POLICY' : 'DEFAULT_FANOUT', policy };
}
