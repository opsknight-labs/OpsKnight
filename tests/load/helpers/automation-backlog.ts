import type { PrismaClient } from '@prisma/client';

/** Delayed alert work must drain too. Future periodic sweeps are not prior-profile
 * work; incident escalation/unsnooze timers are fenced by closing test incidents. */
export async function countAutomationBacklog(
  db: Pick<PrismaClient, 'backgroundJob' | 'notification'>
) {
  const [jobs, intents] = await Promise.all([
    db.backgroundJob.count({
      where: {
        status: { in: ['PENDING', 'PROCESSING', 'PENDING_V2', 'PROCESSING_V2'] },
        NOT: [
          { type: { in: ['ESCALATION', 'AUTO_UNSNOOZE'] } },
          { type: 'COMPLIANCE_EVALUATION_SWEEP', scheduledAt: { gt: new Date() } },
        ],
      },
    }),
    db.notification.count({ where: { status: 'PENDING' } }),
  ]);
  return jobs + intents;
}
