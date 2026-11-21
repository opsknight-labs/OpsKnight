import 'server-only';
import prisma from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import { incidentReadWhere } from '@/lib/authorization-filters';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { resolveEffectivePolicy } from '../settings/service';
import { enqueueWorkItems, WORK_KINDS, MAX_WORK_ATTEMPTS } from '../jobs/work-queue';

/** Explicit operator request; dead letters still require their existing reviewed replay workflow. */
export async function requestIncidentAnalysis(
  actor: AuthorizationActor,
  incidentId: string
): Promise<'requested' | 'unavailable' | 'review_required' | 'off'> {
  if (
    actor.status !== 'ACTIVE' ||
    actor.apiKey ||
    !hasCapability(actor.role, CAPABILITIES.INTELLIGENCE_MANAGE)
  )
    return 'unavailable';
  return prisma.$transaction(async tx => {
    const incident = await tx.incident.findFirst({
      where: { AND: [{ id: incidentId }, incidentReadWhere(actor)] },
      select: { serviceId: true },
    });
    if (!incident) return 'unavailable';
    const policy = await resolveEffectivePolicy(incident.serviceId, tx);
    if (policy.effectiveMode === 'OFF') return 'off';
    const failed = await tx.intelligenceWorkItem.findFirst({
      where: {
        subjectKey: incidentId,
        kind: {
          in: [
            WORK_KINDS.INDEX_INCIDENT,
            WORK_KINDS.ANALYZE_INCIDENT,
            WORK_KINDS.ANALYZE_RESPONSE,
            WORK_KINDS.CORRELATE_INCIDENT,
          ],
        },
        OR: [{ failedAt: { not: null } }, { attempts: { gte: MAX_WORK_ATTEMPTS } }],
      },
      select: { id: true },
    });
    if (failed) return 'review_required';
    await enqueueWorkItems(
      [{ kind: WORK_KINDS.INDEX_INCIDENT, subjectKey: incidentId, force: true }],
      tx
    );
    await logAudit(
      {
        action: 'intelligence.analysis.requested',
        entityType: 'INCIDENT',
        entityId: incidentId,
        actorId: actor.id,
        source: 'UI',
      },
      tx
    );
    return 'requested';
  });
}
