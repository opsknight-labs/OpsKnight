import 'server-only';
import type { Prisma } from '@prisma/client';
import { noiseControlDefinitionSchema } from './contract';
import { isWindowActiveAt } from './recurrence';

/** The open SLA pause that ingestion opens when a noise control suppresses an incident (see sweep.ts). */
const NOISE_PAUSE_REASON = 'noise-control-suppression';

/**
 * Whether a suppressed incident should page now because the same alert re-fired at HIGH urgency.
 *
 * - Only a hold that noise controls placed is theirs to lift: a manual suppression, or a legacy flapping hold,
 *   stays until a person (or its own release path) lifts it.
 * - A control the operator told to cover critical alerts keeps the incident suppressed, but only while it still
 *   applies: an ended or disabled window, an expired or disabled rule, or an orchestration rule that is gone,
 *   disabled, no longer suppressing, or in a policy that is no longer ON all release it.
 */
export async function shouldReleaseOnCriticalRefire(
  tx: Prisma.TransactionClient,
  incidentId: string,
  serviceId: string,
  now: Date = new Date()
): Promise<boolean> {
  const held = await tx.incidentSlaPause.findFirst({
    where: { incidentId, endedAt: null, reason: NOISE_PAUSE_REASON },
    select: { id: true },
  });
  if (!held) return false;
  return !(await coveringControlIsActive(tx, incidentId, serviceId, now));
}

async function coveringControlIsActive(
  tx: Prisma.TransactionClient,
  incidentId: string,
  serviceId: string,
  now: Date
): Promise<boolean> {
  const decision = await tx.prePagingDecision.findFirst({
    where: { incidentId, applied: true, action: 'SUPPRESS', reversedAt: null },
    orderBy: { createdAt: 'desc' },
    select: { control: true, sourceId: true },
  });
  const sourceId = decision?.sourceId;
  if (!sourceId) return false;
  if (decision.control === 'MAINTENANCE') {
    const window = await tx.noiseMaintenanceWindow.findUnique({ where: { id: sourceId } });
    return Boolean(
      window?.coversCritical &&
      window.enabled &&
      !(window.endedAt && window.endedAt <= now) &&
      isWindowActiveAt(window, now)
    );
  }
  if (decision.control === 'SUPPRESSION') {
    const rule = await tx.suppressionRule.findUnique({ where: { id: sourceId } });
    return Boolean(
      rule?.coversCritical && rule.enabled && !(rule.expiresAt && rule.expiresAt <= now)
    );
  }
  if (decision.control === 'ORCHESTRATION') {
    // The policy that applies to the service: its own, else the global one.
    const policies = await tx.noiseControlPolicy.findMany({
      where: { OR: [{ serviceId }, { serviceId: null }] },
      select: { serviceId: true, mode: true, definition: true },
    });
    const policy =
      policies.find(item => item.serviceId === serviceId) ??
      policies.find(item => item.serviceId === null);
    if (policy?.mode !== 'ON') return false;
    const parsed = noiseControlDefinitionSchema.safeParse(policy.definition);
    return (
      parsed.success &&
      parsed.data.orchestration.rules.some(
        rule =>
          rule.id === sourceId &&
          rule.enabled &&
          rule.coversCritical &&
          rule.actions.some(action => action.type === 'SUPPRESS')
      )
    );
  }
  return false;
}
