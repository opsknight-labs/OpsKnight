import { logger } from '@/lib/logger';

/**
 * @deprecated Legacy SLASnapshot generation is permanently disabled. Remove
 * external schedules after confirming they no longer invoke this compatibility
 * entry point. Service-objective snapshots use the SLO snapshot job.
 */
export async function processSLASnapshots() {
  logger.info('[Legacy SLA] Snapshot generation retired');
  return { processed: 0, total: 0, deprecated: true as const };
}
