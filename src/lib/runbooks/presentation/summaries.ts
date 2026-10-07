import 'server-only';
import { cache } from 'react';
import prisma from '@/lib/prisma';
import { ACTIVE_EXECUTION_STATUSES, getSuccessRate, type NavigationSummary } from './contracts';
import { CIRCUIT_BREAKER_FAIL_THRESHOLD } from '../types';
import { getJobWorkerStatus } from '@/lib/job-worker';

export const getRunbookDatabaseNow = cache(async () => {
  const [clock] = await prisma.$queryRaw<Array<{ now: Date }>>`SELECT NOW() AS now`;
  if (!clock) throw new Error('Database clock query returned no rows.');
  return clock.now;
});
export type FleetSummary = { enrolled: number; online: number; degraded: number; offline: number; enrolling: number; unhealthy: number; spoolDepth: number; deadLetterDepth: number; activeJobs: number };
export const getRunbookFleetSummary = cache(async (): Promise<FleetSummary> => {
  // Whole-fleet, bounded payload. The clock and freshness rule also drive row presentation.
  const now = await getRunbookDatabaseNow(); const since = new Date(now.getTime() - 90000);
  const [summary] = await prisma.$queryRaw<FleetSummary[]>`
    SELECT COUNT(*)::int AS enrolled,
      COUNT(*) FILTER (WHERE status = 'ONLINE' AND "lastHeartbeatAt" >= ${since})::int AS online,
      COUNT(*) FILTER (WHERE status = 'DEGRADED' AND "lastHeartbeatAt" >= ${since})::int AS degraded,
      COUNT(*) FILTER (WHERE status = 'OFFLINE' OR (status IN ('ONLINE', 'DEGRADED') AND ("lastHeartbeatAt" IS NULL OR "lastHeartbeatAt" < ${since})))::int AS offline,
      COUNT(*) FILTER (WHERE status = 'ENROLLING')::int AS enrolling,
      COUNT(*) FILTER (WHERE status != 'ONLINE' OR "lastHeartbeatAt" IS NULL OR "lastHeartbeatAt" < ${since} OR COALESCE("lastError", '') != '' OR "deadLetterDepth" > 0)::int AS unhealthy,
      COALESCE(SUM("spoolDepth"), 0)::int AS "spoolDepth",
      COALESCE(SUM("deadLetterDepth"), 0)::int AS "deadLetterDepth",
      COALESCE(SUM("activeAttemptCount"), 0)::int AS "activeJobs"
    FROM "RunbookAgent" WHERE status != 'REVOKED'`;
  if (!summary) throw new Error('Fleet summary returned no rows.');
  return summary;
});
export const getActiveExecutionCount = cache(() => prisma.runbookExecution.count({ where: { status: { in: ACTIVE_EXECUTION_STATUSES } } }));
export const getRunbookExecutionSummary = cache(async () => {
  const now = await getRunbookDatabaseNow();
  const [active, running, waitingApproval, last24h, outcomes] = await Promise.all([
    getActiveExecutionCount(),
    prisma.runbookExecution.count({ where: { status: 'RUNNING' } }),
    prisma.runbookExecution.count({ where: { status: 'WAITING_APPROVAL' } }),
    prisma.runbookExecution.count({ where: { createdAt: { gte: new Date(now.getTime() - 86400000) } } }),
    prisma.runbookExecution.groupBy({ by: ['status'], where: { completedAt: { gte: new Date(now.getTime() - 7 * 86400000) }, status: { in: ['SUCCEEDED', 'FAILED', 'TIMED_OUT'] } }, _count: { id: true } }),
  ]);
  return { active, running, waitingApproval, last24h, successRate: getSuccessRate(outcomes) };
});
export const getRunbookHealthSummary = cache(async () => {
  const now = await getRunbookDatabaseNow();
  const [fleet, unknown, expiredLeases, oldestPending, circuits] = await Promise.all([
    getRunbookFleetSummary(),
    prisma.runbookStepAttempt.count({ where: { status: 'UNKNOWN' } }),
    prisma.runbookStepAttempt.count({ where: { status: { in: ['CLAIMED', 'RUNNING'] }, leaseExpiresAt: { lt: now } } }),
    prisma.runbookStepAttempt.findFirst({ where: { status: 'PENDING' }, orderBy: { availableAt: 'asc' }, select: { availableAt: true } }),
    prisma.$queryRaw<Array<{ count: number }>>`SELECT COUNT(*)::int AS count FROM (SELECT "serviceId" FROM "RunbookExecution" WHERE "serviceId" IS NOT NULL AND status = 'FAILED' AND "completedAt" >= ${new Date(now.getTime() - 15 * 60000)} GROUP BY "serviceId" HAVING COUNT(*) >= ${CIRCUIT_BREAKER_FAIL_THRESHOLD}) tripped`,
  ]);
  const oldest = oldestPending ? Math.max(0, Math.round((now.getTime() - oldestPending.availableAt.getTime()) / 1000)) : 0;
  const circuitCount = circuits[0]?.count ?? 0;
  const localWorker = getJobWorkerStatus();
  const workerHasError = Boolean(localWorker.running && localWorker.lastError);
  const health = fleet.unhealthy || unknown || expiredLeases || circuitCount || oldest > 300 || workerHasError ? 'DEGRADED' : fleet.enrolled ? 'HEALTHY' : 'UNKNOWN';
  return { fleet, unknown, expiredLeases, oldest, circuits: circuitCount, health, workerLastError: workerHasError ? localWorker.lastError : null } as const;
});
export const getRunbookNavigationSummary = cache(async (): Promise<NavigationSummary> => {
  try {
    const [execution, health] = await Promise.all([getActiveExecutionCount(), getRunbookHealthSummary()]);
    return { activeExecutions: execution, onlineAgents: health.fleet.online, health: health.health };
  } catch {
    return { health: 'UNKNOWN' };
  }
});
