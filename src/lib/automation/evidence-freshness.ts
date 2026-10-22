import type { Prisma } from '@prisma/client';

/** Bounded pending-observation sample using the service observation queue index.
 * Counts are a lower bound when truncated. Daily rollups do not claim event-time precision.
 */
export async function candidateEvidenceFreshness(
  tx: Prisma.TransactionClient,
  serviceId: string,
  versionId: string,
  latestBucketDate: Date | null
) {
  const pending = await tx.$queryRaw<Array<{ createdAt: Date }>>`
    SELECT "createdAt" FROM "BackgroundJob"
    WHERE type = 'SCHEDULED_TASK'::"JobType" AND status = 'PENDING'::"JobStatus"
      AND payload->>'task' = 'AUTOMATION_OBSERVE'
      AND payload->>'serviceId' = ${serviceId}
      AND payload->'shadow'->>'versionId' = ${versionId}
    ORDER BY "scheduledAt", id LIMIT 101`;
  return {
    latestEvidenceBucketDate: latestBucketDate?.toISOString() ?? null,
    pendingObservations: Math.min(pending.length, 100),
    pendingObservationsTruncated: pending.length > 100,
    oldestSampledPendingAgeMs: pending.length
      ? Math.max(0, Date.now() - Math.min(...pending.map(row => row.createdAt.getTime())))
      : null,
  };
}
