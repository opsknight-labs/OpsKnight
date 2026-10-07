import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { AppError } from '@/lib/errors';
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
}> {
  const decision = client.incidentAutomationDecision
    ? await client.incidentAutomationDecision.findUnique({ where: { incidentId } })
    : null;
  if (decision?.mode === 'LIVE' && decision.routeType === 'NO_ESCALATION')
    return { type: 'NO_ESCALATION', policy: null };
  if (decision?.mode === 'LIVE' && decision.escalationPolicyId) {
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
