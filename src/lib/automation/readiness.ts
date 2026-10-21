import type { Prisma } from '@prisma/client';
import { getAutomationSettings } from './settings';

/** A bounded transaction snapshot of readiness. Daily aggregates cannot claim
 * exact event-time freshness. Pending includes claimed work; the query stops as
 * soon as the configured queue allowance has been exceeded.
 */
export async function readAutomationReadiness(
  tx: Prisma.TransactionClient,
  serviceId: string,
  versionId: string
) {
  const settings = await getAutomationSettings(tx);
  const policy = settings.automationReadinessPolicy;
  const [evidence, pending] = await Promise.all([
    tx.automationShadowAggregate.aggregate({
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
    }),
    tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "BackgroundJob"
      WHERE type = 'SCHEDULED_TASK'::"JobType" AND status IN ('PENDING'::"JobStatus", 'PROCESSING'::"JobStatus")
        AND payload->>'task' = 'AUTOMATION_OBSERVE' AND payload->>'serviceId' = ${serviceId}
        AND payload->'shadow'->>'versionId' = ${versionId}
      ORDER BY "scheduledAt", id LIMIT ${policy.maximumPendingObservations + 1}`,
  ]);
  const evaluated = evidence._sum.evaluated ?? 0;
  // Errors and fallbacks may describe the same failed evaluation. Do not add them.
  const errorRate = evaluated
    ? Math.max(evidence._sum.errors ?? 0, evidence._sum.fallbacks ?? 0) / evaluated
    : 0;
  const latestBucketDate = evidence._max.bucketDate;
  const evidenceAgeHours = latestBucketDate
    ? Math.max(0, (Date.now() - latestBucketDate.getTime()) / 3600000)
    : null;
  return {
    settingsRevision: settings.automationSettingsRevision,
    policy,
    policyValid: settings.automationReadinessPolicyValid,
    windowDays: 7,
    evaluated,
    errorRate,
    latestEvidenceBucketDate: latestBucketDate?.toISOString() ?? null,
    evidenceAgeHours,
    sufficientRecentEvidence:
      evaluated >= policy.minimumEvaluations &&
      evidenceAgeHours !== null &&
      evidenceAgeHours <= policy.maximumEvidenceAgeHours,
    pendingObservations: pending.length,
    pendingObservationsTruncated: pending.length > policy.maximumPendingObservations,
    backlogWithinPolicy: pending.length <= policy.maximumPendingObservations,
    errorsWithinPolicy: errorRate <= policy.maximumErrorRate,
    counts: evidence._sum,
  };
}
