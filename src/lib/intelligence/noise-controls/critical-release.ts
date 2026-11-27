import 'server-only';
import type { Prisma } from '@prisma/client';
import { noiseControlDefinitionSchema } from './contract';

/**
 * Whether the control that suppressed this incident was told to cover critical alerts. A worse re-fire of an
 * alert that a window, rule or orchestration rule hid on purpose, with that opt-in, stays hidden; any other
 * suppression (flapping, a control without the opt-in, one that no longer exists) is released so the
 * re-fire pages.
 */
export async function suppressionCoversCritical(
  tx: Prisma.TransactionClient,
  incidentId: string,
  serviceId: string
): Promise<boolean> {
  const decision = await tx.prePagingDecision.findFirst({
    where: { incidentId, applied: true, action: 'SUPPRESS', reversedAt: null },
    orderBy: { createdAt: 'desc' },
    select: { control: true, sourceId: true },
  });
  const sourceId = decision?.sourceId;
  if (!sourceId) return false;
  if (decision.control === 'MAINTENANCE')
    return (
      (
        await tx.noiseMaintenanceWindow.findUnique({
          where: { id: sourceId },
          select: { coversCritical: true },
        })
      )?.coversCritical === true
    );
  if (decision.control === 'SUPPRESSION')
    return (
      (
        await tx.suppressionRule.findUnique({
          where: { id: sourceId },
          select: { coversCritical: true },
        })
      )?.coversCritical === true
    );
  if (decision.control === 'ORCHESTRATION') {
    // The policy that applies to the service: its own, else the global one.
    const policies = await tx.noiseControlPolicy.findMany({
      where: { OR: [{ serviceId }, { serviceId: null }] },
      select: { serviceId: true, definition: true },
    });
    const policy = policies.find(item => item.serviceId === serviceId) ?? policies[0];
    const parsed = noiseControlDefinitionSchema.safeParse(policy?.definition);
    return (
      parsed.success &&
      parsed.data.orchestration.rules.some(rule => rule.id === sourceId && rule.coversCritical)
    );
  }
  return false;
}
