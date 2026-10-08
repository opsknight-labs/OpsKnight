import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import { responderSnapshotSchema } from './automation-snapshot';
export const responderPolicyInclude = {
  steps: {
    include: { targetUser: true, targetTeam: true, targetSchedule: true },
    orderBy: { stepOrder: 'asc' as const },
  },
};
type Policy = Prisma.EscalationPolicyGetPayload<{ include: typeof responderPolicyInclude }>;
export async function resolveIncidentResponderRouting(
  incidentId: string,
  serviceId: string,
  client: Prisma.TransactionClient = prisma,
  defaultPolicy?: Policy | null
): Promise<{
  type: 'DEFAULT_POLICY' | 'SELECTED_POLICY' | 'NO_ESCALATION' | 'DEFAULT_FANOUT';
  policy: Policy | null;
  pinnedConditions?: Map<string, { field: string; operator: string; values: string[] }[]>;
}> {
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
    const policy = await client.escalationPolicy.findUnique({
      where: { id: decision.escalationPolicyId },
      include: responderPolicyInclude,
    });
    if (!policy) {
      throw new AppError({
        code: 'AUTOMATION_PINNED_POLICY_MISSING',
        userMessage:
          'The escalation policy pinned to this incident was deleted. Restore that policy before resuming escalation.',
      });
    }
    return {
      type: decision.routeType === 'ESCALATION_POLICY' ? 'SELECTED_POLICY' : 'DEFAULT_POLICY',
      policy,
    };
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
