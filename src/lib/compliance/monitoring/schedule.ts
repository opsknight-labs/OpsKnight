import { Prisma, type PrismaClient, type ComplianceControlState } from '@prisma/client';
import prismaClient from '../../prisma';
import type { ComplianceControlEvaluator } from '../evaluators/types';
import { getComplianceMonitoringConfig } from './config';

export interface ShouldEvaluateControlResult {
  readonly due: boolean;
  readonly reason: string;
}

/**
 * Pure helper determining whether a runtime control is due for evaluation.
 */
export function shouldEvaluateControl(params: {
  state: ComplianceControlState | null | undefined;
  evaluator: ComplianceControlEvaluator | undefined;
  now: Date;
  intervalMinutes: number;
}): ShouldEvaluateControlResult {
  const { state, evaluator, now, intervalMinutes } = params;

  if (!state) {
    return { due: true, reason: 'NO_PREVIOUS_EVALUATION' };
  }

  if (evaluator && evaluator.version !== state.evaluatorVersion) {
    return { due: true, reason: 'EVALUATOR_VERSION_CHANGED' };
  }

  if (state.validUntil && state.validUntil.getTime() <= now.getTime()) {
    return { due: true, reason: 'EVALUATION_EXPIRED' };
  }

  const ageMs = now.getTime() - state.evaluatedAt.getTime();
  const intervalMs = intervalMinutes * 60 * 1000;

  if (ageMs >= intervalMs) {
    return { due: true, reason: 'INTERVAL_ELAPSED' };
  }

  return { due: false, reason: 'CURRENT' };
}

/**
 * Ensures a pending or processing compliance monitoring sweep job exists.
 * Protected by a transaction-scoped PostgreSQL advisory lock for HA safety across replicas.
 */
export async function ensureComplianceMonitoringScheduled(
  prisma: PrismaClient = prismaClient,
  now: Date = new Date()
): Promise<{ scheduled: boolean; monitorRunId?: string; reason?: string }> {
  const config = getComplianceMonitoringConfig();
  if (!config.enabled) {
    return { scheduled: false, reason: 'MONITORING_DISABLED' };
  }

  return await prisma.$transaction(
    async tx => {
      // 1. Acquire advisory lock for scheduler bootstrap
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('compliance-monitor-scheduler', 0))`;

      // 2. Check for active or pending monitoring runs
      const existingRun = await tx.complianceMonitoringRun.findFirst({
        where: { status: { in: ['PENDING', 'RUNNING'] } },
        orderBy: { scheduledFor: 'asc' },
      });

      if (existingRun) {
        // Verify if a background job specifically for this monitoring run exists
        const activeJobs = await tx.backgroundJob.findMany({
          where: {
            type: 'COMPLIANCE_EVALUATION_SWEEP',
            status: { in: ['PENDING', 'PROCESSING'] },
          },
        });

        const jobForThisRun = activeJobs.find(
          j => (j.payload as { monitorRunId?: string } | null)?.monitorRunId === existingRun.id
        );

        if (jobForThisRun) {
          return { scheduled: false, monitorRunId: existingRun.id, reason: 'ALREADY_SCHEDULED' };
        }

        if (existingRun.status === 'PENDING') {
          // Recreate missing background job for the existing pending run
          const scheduledAt = existingRun.scheduledFor <= now ? now : existingRun.scheduledFor;
          await tx.backgroundJob.create({
            data: {
              type: 'COMPLIANCE_EVALUATION_SWEEP',
              scheduledAt,
              payload: { monitorRunId: existingRun.id },
            },
          });
          return {
            scheduled: true,
            monitorRunId: existingRun.id,
            reason: 'RECREATED_JOB_FOR_PENDING_RUN',
          };
        }

        // Stale RUNNING run without active job: mark FAILED and create replacement run
        await tx.complianceMonitoringRun.update({
          where: { id: existingRun.id },
          data: {
            status: 'FAILED',
            completedAt: now,
            errorSummary: { reason: 'ORPHAN_RUN_WITHOUT_ACTIVE_JOB' },
          },
        });
      }

      // 3. Create next monitoring run and background job atomically
      const scheduledFor = new Date(now.getTime());
      const run = await tx.complianceMonitoringRun.create({
        data: {
          scheduledFor,
          status: 'PENDING',
        },
      });

      await tx.backgroundJob.create({
        data: {
          type: 'COMPLIANCE_EVALUATION_SWEEP',
          scheduledAt: scheduledFor,
          payload: { monitorRunId: run.id },
        },
      });

      return { scheduled: true, monitorRunId: run.id };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      timeout: 10000,
    }
  );
}
