import type { PrismaClient, ComplianceMonitoringRun } from '@prisma/client';
import prismaClient from '../../prisma';
import { getComplianceMonitoringConfig } from './config';

export interface ComplianceMonitoringStatusSummary {
  readonly enabled: boolean;
  readonly intervalMinutes: number;
  readonly lastRun: ComplianceMonitoringRun | null;
  readonly nextRunAt: string | null;
  readonly isStale: boolean;
  readonly openDriftCount: number;
  readonly acknowledgedDriftCount: number;
}

/**
 * Retrieves the operational health and status of continuous compliance monitoring.
 */
export async function getComplianceMonitoringStatus(
  prisma: PrismaClient = prismaClient,
  now: Date = new Date()
): Promise<ComplianceMonitoringStatusSummary> {
  const config = getComplianceMonitoringConfig();

  const [lastRun, nextRun, openDriftCount, acknowledgedDriftCount] = await Promise.all([
    prisma.complianceMonitoringRun.findFirst({
      where: { status: { in: ['COMPLETED', 'PARTIAL_FAILED', 'FAILED'] } },
      orderBy: { completedAt: 'desc' },
    }),
    prisma.complianceMonitoringRun.findFirst({
      where: { status: 'PENDING' },
      orderBy: { scheduledFor: 'asc' },
    }),
    prisma.complianceDriftEvent.count({
      where: { status: 'OPEN' },
    }),
    prisma.complianceDriftEvent.count({
      where: { status: 'ACKNOWLEDGED' },
    }),
  ]);

  let isStale = false;
  if (config.enabled) {
    if (!lastRun || !lastRun.completedAt) {
      isStale = false;
    } else {
      const ageMs = now.getTime() - lastRun.completedAt.getTime();
      const expectedWindowMs = config.intervalMinutes * 2 * 60 * 1000;
      if (ageMs > expectedWindowMs) {
        isStale = true;
      }
    }
  }

  return {
    enabled: config.enabled,
    intervalMinutes: config.intervalMinutes,
    lastRun,
    nextRunAt: nextRun ? nextRun.scheduledFor.toISOString() : null,
    isStale,
    openDriftCount,
    acknowledgedDriftCount,
  };
}
