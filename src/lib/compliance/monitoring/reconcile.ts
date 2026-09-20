import type { PrismaClient } from '@prisma/client';

/**
 * Sweeps and reconciles timed-out zombie or terminal compliance monitoring background jobs,
 * ensuring both the BackgroundJob and its referenced ComplianceMonitoringRun are settled to FAILED
 * in a single atomic transaction.
 */
export async function reconcileTerminalComplianceMonitoringJobs(
  prismaClient: PrismaClient
): Promise<number> {
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
  const now = new Date();

  let reconciledCount = 0;

  // 1. Timed-out PROCESSING compliance monitoring sweep jobs with attempts >= maxAttempts
  const staleProcessingJobs = await prismaClient.backgroundJob.findMany({
    where: {
      type: 'COMPLIANCE_EVALUATION_SWEEP',
      status: 'PROCESSING',
      OR: [{ startedAt: null }, { startedAt: { lt: tenMinutesAgo } }],
    },
  });

  for (const job of staleProcessingJobs) {
    if (job.attempts >= job.maxAttempts) {
      const payload = job.payload as Record<string, unknown> | null;
      const monitorRunId =
        typeof payload?.monitorRunId === 'string' ? payload.monitorRunId.trim() : null;
      const errorMsg =
        'Compliance monitoring sweep job timed out in PROCESSING state after exceeding maxAttempts';

      await prismaClient.$transaction(async tx => {
        await tx.backgroundJob.updateMany({
          where: { id: job.id, status: 'PROCESSING' },
          data: { status: 'FAILED', failedAt: now, error: errorMsg },
        });

        if (monitorRunId) {
          await tx.complianceMonitoringRun.updateMany({
            where: { id: monitorRunId, status: { in: ['PENDING', 'RUNNING'] } },
            data: {
              status: 'FAILED',
              errorSummary: { error: errorMsg },
              completedAt: now,
            },
          });
        }
      });
      reconciledCount++;
    }
  }

  // 2. FAILED sweep jobs from the last 24 hours whose run is still PENDING or RUNNING
  const terminalFailedJobs = await prismaClient.backgroundJob.findMany({
    where: {
      type: 'COMPLIANCE_EVALUATION_SWEEP',
      status: 'FAILED',
      failedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    },
    select: { id: true, payload: true, error: true, failedAt: true },
  });

  for (const job of terminalFailedJobs) {
    const payload = job.payload as Record<string, unknown> | null;
    const monitorRunId =
      typeof payload?.monitorRunId === 'string' ? payload.monitorRunId.trim() : null;
    if (monitorRunId) {
      const result = await prismaClient.complianceMonitoringRun.updateMany({
        where: { id: monitorRunId, status: { in: ['PENDING', 'RUNNING'] } },
        data: {
          status: 'FAILED',
          errorSummary: {
            error: job.error
              ? job.error.slice(0, 1000)
              : 'Associated background job failed terminally',
          },
          completedAt: job.failedAt ?? now,
        },
      });
      if (result.count > 0) reconciledCount++;
    }
  }

  return reconciledCount;
}
