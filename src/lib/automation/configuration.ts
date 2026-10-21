import type { Prisma } from '@prisma/client';
import { AppError } from '@/lib/errors';
import { getAutomationSettings } from './settings';
import { candidateEvidenceFreshness } from './evidence-freshness';

const versionSummary = {
  id: true,
  versionNumber: true,
  checksum: true,
  publishedAt: true,
} as const;

/** Public effective configuration projection. Draft and version validators are
 * separate resources; global OFF always wins over a stored service mode.
 */
export async function readAutomationConfiguration(tx: Prisma.TransactionClient, serviceId: string) {
  const service = await tx.service.findUnique({
    where: { id: serviceId },
    select: {
      id: true,
      automationDraft: { select: { revision: true } },
      automationConfig: {
        select: {
          revision: true,
          mode: true,
          activeVersionId: true,
          candidateVersionId: true,
          activeVersion: { select: versionSummary },
          candidateVersion: { select: versionSummary },
        },
      },
    },
  });
  if (!service) throw new AppError({ code: 'SERVICE_NOT_FOUND' });
  const enabled = (await getAutomationSettings(tx)).automationEnabled;
  const config = service.automationConfig;
  const readHealth = async (versionId: string | null) => {
    if (!versionId) return null;
    const evidence = await tx.automationShadowAggregate.aggregate({
      where: { serviceId, versionId, bucketDate: { gte: new Date(Date.now() - 7 * 86400000) } },
      _sum: {
        evaluated: true,
        same: true,
        routeDifferent: true,
        priorityDifferent: true,
        noEscalationDifferent: true,
        errors: true,
        fallbacks: true,
      },
      _max: { bucketDate: true },
    });
    return {
      versionId,
      evaluated: evidence._sum.evaluated ?? 0,
      same: evidence._sum.same ?? 0,
      routeDifferent: evidence._sum.routeDifferent ?? 0,
      priorityDifferent: evidence._sum.priorityDifferent ?? 0,
      noEscalationDifferent: evidence._sum.noEscalationDifferent ?? 0,
      errors: evidence._sum.errors ?? 0,
      fallbacks: evidence._sum.fallbacks ?? 0,
      latestEvidenceBucketDate: evidence._max.bucketDate?.toISOString() ?? null,
    };
  };
  const [activeHealth, candidateHealth] = await Promise.all([
    readHealth(config?.activeVersionId ?? null),
    readHealth(config?.candidateVersionId ?? null),
  ]);
  const freshness = config?.candidateVersionId
    ? await candidateEvidenceFreshness(
        tx,
        serviceId,
        config.candidateVersionId,
        candidateHealth?.latestEvidenceBucketDate
          ? new Date(candidateHealth.latestEvidenceBucketDate)
          : null
      )
    : null;
  return {
    serviceId,
    revision: config?.revision ?? 0,
    globalEnabled: enabled,
    mode: config?.mode ?? 'DISABLED',
    effectiveMode: enabled ? (config?.mode ?? 'DISABLED') : 'DISABLED',
    activeVersionId: config?.activeVersionId ?? null,
    candidateVersionId: config?.candidateVersionId ?? null,
    draftRevision: service.automationDraft?.revision ?? 0,
    activeVersion: config?.activeVersion ?? null,
    candidateVersion: config?.candidateVersion ?? null,
    health: {
      windowDays: 7,
      active: activeHealth,
      candidate: candidateHealth,
      candidateEvidenceFreshness: freshness,
    },
  };
}
