/**
 * Escalation reconciliation.
 *
 * Durable state, not the job row, is the source of truth: an incident that says
 * "step 2, due at T" owes a page whether or not the job meant to deliver it
 * still exists. This scanner walks the gap between the two and repairs it.
 *
 * Every repair here is idempotent and safe to run concurrently with live
 * workers — a duplicate job loses the claim compare-and-set, and an
 * initialization only touches an incident with no escalation state at all.
 */
import { Prisma } from '@prisma/client';
import prisma from '../prisma';
import { runSerializableTransaction } from '../db-utils';
import { logger } from '../logger';
import { ESCALATION_LOCK_TIMEOUT_MS } from '../config';
import { initializeEscalationExecution, recreateDueEscalationJob } from './repository';

export interface EscalationReconciliationReport {
  /** OPEN incidents whose service has a policy but which carried no execution. */
  executionsInitialized: number;
  /** Due executions whose job row was missing and has been recreated. */
  dueJobsRecreated: number;
  /** PENDING jobs belonging to a generation the incident has moved past. */
  staleJobsCancelled: number;
  /** Expired processing leases released for reclaim. */
  leasesReleased: number;
  errors: string[];
}

const DEFAULT_LIMIT = 200;

/** Incident IDs that currently have escalation work queued or running. */
async function incidentsWithActiveEscalationJobs(): Promise<Set<string>> {
  const rows = await prisma.$queryRaw<Array<{ incidentId: string | null }>>(Prisma.sql`
    SELECT DISTINCT "payload"->>'incidentId' AS "incidentId"
    FROM "BackgroundJob"
    WHERE "type" = 'ESCALATION'::"JobType"
      AND "status" IN ('PENDING', 'PROCESSING')
  `);
  return new Set(
    rows.map(row => row.incidentId).filter((id): id is string => typeof id === 'string')
  );
}

/**
 * Case A: an OPEN incident whose service has a policy but whose execution was
 * never armed. Reachable when the creation-time initialization predates this
 * code, or when a policy is attached to a service after the incident opened.
 */
async function initializeUnarmedExecutions(
  limit: number,
  now: Date,
  report: EscalationReconciliationReport
): Promise<void> {
  const candidates = await prisma.incident.findMany({
    where: {
      status: 'OPEN',
      escalationStatus: null,
      service: { policy: { steps: { some: {} } } },
    },
    select: { id: true, serviceId: true },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });

  for (const incident of candidates) {
    try {
      const result = await runSerializableTransaction(tx =>
        initializeEscalationExecution(tx, {
          incidentId: incident.id,
          serviceId: incident.serviceId,
          now,
        })
      );
      if (result.initialized) {
        report.executionsInitialized += 1;
        logger.warn('escalation.recovery.execution_initialized', {
          incidentId: incident.id,
          dueAt: result.dueAt?.toISOString(),
        });
      }
    } catch (error) {
      report.errors.push(
        `initialize ${incident.id}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}

/**
 * Case B: escalation state says a step is due, but no job exists to run it.
 * The fallback scanner would eventually pick these up; recreating the job
 * restores the low-latency path and keeps the two representations consistent.
 */
async function recreateMissingDueJobs(
  limit: number,
  now: Date,
  report: EscalationReconciliationReport
): Promise<void> {
  const [due, queued] = await Promise.all([
    prisma.incident.findMany({
      where: {
        status: 'OPEN',
        escalationStatus: 'ESCALATING',
        nextEscalationAt: { lte: now },
      },
      select: {
        id: true,
        currentEscalationStep: true,
        escalationGeneration: true,
        nextEscalationAt: true,
      },
      orderBy: { nextEscalationAt: 'asc' },
      take: limit,
    }),
    incidentsWithActiveEscalationJobs(),
  ]);

  for (const incident of due) {
    if (queued.has(incident.id)) continue;
    try {
      const jobId = await recreateDueEscalationJob({
        incidentId: incident.id,
        generation: incident.escalationGeneration ?? 0,
        stepIndex: incident.currentEscalationStep ?? 0,
        scheduledAt: incident.nextEscalationAt ?? now,
      });
      if (!jobId) continue;
      report.dueJobsRecreated += 1;
      logger.warn('escalation.recovery.job_recreated', {
        incidentId: incident.id,
        generation: incident.escalationGeneration ?? 0,
        stepIndex: incident.currentEscalationStep ?? 0,
        dueAt: incident.nextEscalationAt?.toISOString(),
      });
    } catch (error) {
      report.errors.push(
        `recreate ${incident.id}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}

/**
 * Case C: a PENDING job whose payload names a generation the incident has
 * moved past. The executor would refuse it anyway; cancelling keeps the queue
 * honest and stops the job burning retries. Jobs with no generation in their
 * payload are left alone — they cannot be judged stale.
 */
async function cancelStaleGenerationJobs(report: EscalationReconciliationReport): Promise<void> {
  try {
    report.staleJobsCancelled += await prisma.$executeRaw(Prisma.sql`
      UPDATE "BackgroundJob" AS job
      SET "status" = 'CANCELLED',
          "error" = 'Superseded by a newer escalation generation',
          "completedAt" = NOW()
      WHERE job."type" = 'ESCALATION'::"JobType"
        AND job."status" = 'PENDING'
        AND job."payload"->>'generation' IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM "Incident" AS incident
          WHERE incident."id" = job."payload"->>'incidentId'
            AND (job."payload"->>'generation')::int <> incident."escalationGeneration"
        )
    `);
  } catch (error) {
    report.errors.push(
      `cancel stale jobs: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Case D: a processing lease whose owner died. Releasing it lets the next
 * worker claim the step instead of waiting out the full timeout again.
 */
async function releaseExpiredLeases(
  now: Date,
  report: EscalationReconciliationReport
): Promise<void> {
  try {
    const released = await prisma.incident.updateMany({
      where: {
        status: 'OPEN',
        escalationStatus: 'ESCALATING',
        escalationProcessingAt: { lt: new Date(now.getTime() - ESCALATION_LOCK_TIMEOUT_MS) },
      },
      data: { escalationProcessingAt: null },
    });
    report.leasesReleased += released.count;
    if (released.count > 0) {
      logger.warn('escalation.worker.lease_expired', { released: released.count });
    }
  } catch (error) {
    report.errors.push(`release leases: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Finds and repairs escalations whose durable state and queued work disagree.
 *
 * Case E — a FAILED execution — is deliberately left alone. It is a terminal
 * operator-visible state, and silently retrying it would hide a policy that
 * cannot reach anyone.
 */
export async function reconcileEscalations(
  options: { limit?: number; now?: Date } = {}
): Promise<EscalationReconciliationReport> {
  const limit = Math.max(1, Math.min(options.limit ?? DEFAULT_LIMIT, 1000));
  const now = options.now ?? new Date();
  const report: EscalationReconciliationReport = {
    executionsInitialized: 0,
    dueJobsRecreated: 0,
    staleJobsCancelled: 0,
    leasesReleased: 0,
    errors: [],
  };

  // Ordered deliberately: clear stale work and dead leases first, so the
  // missing-job scan sees an accurate picture of what is actually queued.
  await cancelStaleGenerationJobs(report);
  await releaseExpiredLeases(now, report);
  await initializeUnarmedExecutions(limit, now, report);
  await recreateMissingDueJobs(limit, now, report);

  if (
    report.executionsInitialized > 0 ||
    report.dueJobsRecreated > 0 ||
    report.staleJobsCancelled > 0 ||
    report.errors.length > 0
  ) {
    logger.info('escalation.recovery.completed', { ...report });
  }

  return report;
}
