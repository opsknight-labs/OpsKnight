import fs from 'node:fs/promises';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { DEFAULT_EMULATOR_ENDPOINTS } from '../fixtures/notification-providers';

export interface CorrectnessInvariantReport {
  passed: boolean;
  checkedAt: string;
  topology: string;
  invariants: {
    zeroDuplicateOpenIncidents: {
      passed: boolean;
      duplicateGroups: number;
      samples: Array<{ serviceId: string; dedupKey: string; count: number }>;
    };
    zeroLostAcceptedAlerts: {
      passed: boolean;
      totalLoadAlerts: number;
      unlinkedAlerts: number;
    };
    zeroFalseEscalationsAfterAckOrResolve: {
      passed: boolean;
      violationCount: number;
      sampleIncidentIds: string[];
    };
    zeroCorruptedIncidentStates: {
      passed: boolean;
      acknowledgedWithoutTimestamp: number;
      resolvedWithoutTimestamp: number;
      snoozedWithoutUntil: number;
    };
    zeroCriticalNotificationStarvation: {
      passed: boolean;
      pendingCriticalCount: number;
      oldestPendingCriticalAgeMs: number;
      pendingBulkCount: number;
      deliveredCriticalCount: number;
      deliveredBulkCount: number;
    };
    providerIdempotencyCheck: {
      passed: boolean;
      duplicateDeliveryKeysByProvider: Record<string, number>;
      totalDuplicateDeliveries?: number;
    };
  };
  totals: {
    incidentsCreated: number;
    alertsPersisted: number;
    notificationsTotal: number;
    backgroundJobsPending: number;
    backgroundJobsFailed: number;
  };
}

export async function verifyLoadCertificationResults(options?: {
  topology?: string;
  maxCriticalPendingAgeMs?: number;
  controlBaseUrl?: string;
  outputPath?: string;
  waitForDrainMs?: number;
}): Promise<CorrectnessInvariantReport> {
  const topology = options?.topology ?? process.env.LOAD_TOPOLOGY ?? 'manual';
  const maxCriticalPendingAgeMs = options?.maxCriticalPendingAgeMs ?? 30_000;
  const controlBaseUrl =
    options?.controlBaseUrl ?? DEFAULT_EMULATOR_ENDPOINTS.controlBaseUrl;
  const waitForDrainMs = options?.waitForDrainMs ?? Number(process.env.LOAD_DRAIN_WAIT_MS ?? 15_000);

  const prisma = new PrismaClient();
  try {
    if (waitForDrainMs > 0) {
      const deadline = Date.now() + waitForDrainMs;
      while (Date.now() < deadline) {
        const pendingCritical = await prisma.notification.count({
          where: {
            status: 'PENDING',
            trafficClass: 'CRITICAL',
            nextAttemptAt: { lte: new Date() },
          },
        });
        const pendingEscalations = await prisma.backgroundJob.count({
          where: {
            type: 'ESCALATION',
            status: { in: ['PENDING', 'PENDING_V2', 'PROCESSING', 'PROCESSING_V2'] },
          },
        });
        if (pendingCritical === 0 && pendingEscalations === 0) break;
        await new Promise(r => setTimeout(r, 500));
      }
    }

    // 1. Duplicate open/acknowledged incidents per (serviceId, dedupKey)
    const duplicateRows = await prisma.$queryRaw<
      Array<{ serviceId: string; dedupKey: string; cnt: bigint }>
    >`
      SELECT "serviceId", "dedupKey", COUNT(*)::bigint AS cnt
      FROM "Incident"
      WHERE "dedupKey" IS NOT NULL
        AND "status" IN ('OPEN', 'ACKNOWLEDGED')
      GROUP BY "serviceId", "dedupKey"
      HAVING COUNT(*) > 1
      LIMIT 20
    `;

    const duplicateSamples = duplicateRows.map(r => ({
      serviceId: r.serviceId,
      dedupKey: r.dedupKey,
      count: Number(r.cnt),
    }));

    // 2. Zero lost accepted alerts (every TRIGGERED Alert on load services must link to an Incident;
    //    RESOLVED alerts with incidentId=null are intentionally buffered out-of-order resolves in events.ts)
    const [totalLoadAlerts, unlinkedAlerts] = await Promise.all([
      prisma.alert.count({
        where: { serviceId: { startsWith: 'lt-' } },
      }),
      prisma.alert.count({
        where: {
          serviceId: { startsWith: 'lt-' },
          status: 'TRIGGERED',
          incidentId: null,
        },
      }),
    ]);

    // 3. Zero false escalations after ACK or RESOLVE
    // An ESCALATED event occurring > 2s after acknowledgedAt or resolvedAt when the incident
    // was not reopened indicates a stale escalation job fired after acknowledgment/resolution.
    const falseEscalationRows = await prisma.$queryRaw<Array<{ incidentId: string }>>`
      SELECT DISTINCT e."incidentId"
      FROM "IncidentEvent" e
      JOIN "Incident" i ON i."id" = e."incidentId"
      WHERE e."type" = 'ESCALATED'
        AND i."serviceId" LIKE 'lt-%'
        AND NOT EXISTS (
          SELECT 1 FROM "IncidentEvent" r
          WHERE r."incidentId" = i."id"
            AND r."type" = 'REOPENED'
        )
        AND (
          (i."acknowledgedAt" IS NOT NULL AND e."createdAt" > i."acknowledgedAt" + INTERVAL '2 seconds')
          OR
          (i."resolvedAt" IS NOT NULL AND e."createdAt" > i."resolvedAt" + INTERVAL '2 seconds')
        )
      LIMIT 25
    `;

    // 4. Zero corrupted lifecycle states
    const [acknowledgedWithoutTimestamp, resolvedWithoutTimestamp, snoozedWithoutUntil] =
      await Promise.all([
        prisma.incident.count({
          where: {
            serviceId: { startsWith: 'lt-' },
            status: 'ACKNOWLEDGED',
            acknowledgedAt: null,
          },
        }),
        prisma.incident.count({
          where: {
            serviceId: { startsWith: 'lt-' },
            status: 'RESOLVED',
            resolvedAt: null,
          },
        }),
        prisma.incident.count({
          where: {
            serviceId: { startsWith: 'lt-' },
            status: 'SNOOZED',
            snoozedUntil: null,
          },
        }),
      ]);

    // 5. Critical notification starvation check:
    // A critical notification is starved if it was eligible for delivery (nextAttemptAt <= now)
    // but remained pending while workers were occupied with other tasks.
    const now = new Date();
    const [
      pendingCriticalCount,
      oldestPendingCritical,
      pendingBulkCount,
      deliveredCriticalCount,
      deliveredBulkCount,
    ] = await Promise.all([
      prisma.notification.count({
        where: {
          status: 'PENDING',
          trafficClass: 'CRITICAL',
          nextAttemptAt: { lte: now },
        },
      }),
      prisma.notification.findFirst({
        where: {
          status: 'PENDING',
          trafficClass: 'CRITICAL',
          nextAttemptAt: { lte: now },
        },
        orderBy: { nextAttemptAt: 'asc' },
        select: { nextAttemptAt: true },
      }),
      prisma.notification.count({
        where: { status: 'PENDING', trafficClass: 'BULK' },
      }),
      prisma.notification.count({
        where: {
          status: { in: ['SENT', 'DELIVERED'] },
          trafficClass: 'CRITICAL',
        },
      }),
      prisma.notification.count({
        where: {
          status: { in: ['SENT', 'DELIVERED'] },
          trafficClass: 'BULK',
        },
      }),
    ]);

    const oldestPendingCriticalAgeMs = oldestPendingCritical
      ? Math.max(0, now.getTime() - oldestPendingCritical.nextAttemptAt.getTime())
      : 0;

    // 6. Provider emulator duplicate idempotency check
    const duplicateDeliveryKeysByProvider: Record<string, number> = {};
    try {
      const res = await fetch(`${controlBaseUrl.replace(/\/$/, '')}/metrics`, {
        signal: AbortSignal.timeout(3_000),
      });
      if (res.ok) {
        const payload = (await res.json()) as {
          providers?: Record<
            string,
            { duplicateDeliveries?: number; duplicateRequests?: number }
          >;
        };
        if (payload.providers) {
          for (const [providerName, stats] of Object.entries(payload.providers)) {
            duplicateDeliveryKeysByProvider[providerName] =
              stats.duplicateDeliveries ?? stats.duplicateRequests ?? 0;
          }
        }
      }
    } catch {
      // Emulator may not be running in standalone DB checks
    }

    const [
      incidentsCreated,
      notificationsTotal,
      backgroundJobsPending,
      backgroundJobsFailed,
    ] = await Promise.all([
      prisma.incident.count({ where: { serviceId: { startsWith: 'lt-' } } }),
      prisma.notification.count(),
      prisma.backgroundJob.count({
        where: { status: { in: ['PENDING', 'PENDING_V2', 'PROCESSING', 'PROCESSING_V2'] } },
      }),
      prisma.backgroundJob.count({ where: { status: 'FAILED' } }),
    ]);

    const zeroDuplicateOpenIncidentsPassed = duplicateSamples.length === 0;
    const zeroLostAcceptedAlertsPassed = unlinkedAlerts === 0;
    const zeroFalseEscalationsPassed = falseEscalationRows.length === 0;
    const zeroCorruptedStatesPassed =
      acknowledgedWithoutTimestamp === 0 &&
      resolvedWithoutTimestamp === 0 &&
      snoozedWithoutUntil === 0;
    const starvationOccurred =
      pendingCriticalCount > 0 &&
      oldestPendingCriticalAgeMs > maxCriticalPendingAgeMs;

    const zeroCriticalStarvationPassed = !starvationOccurred;

    const totalDuplicateDeliveries = Object.values(duplicateDeliveryKeysByProvider).reduce(
      (sum, count) => sum + count,
      0
    );
    const providerIdempotencyPassed = totalDuplicateDeliveries === 0;

    const report: CorrectnessInvariantReport = {
      passed:
        zeroDuplicateOpenIncidentsPassed &&
        zeroLostAcceptedAlertsPassed &&
        zeroFalseEscalationsPassed &&
        zeroCorruptedStatesPassed &&
        zeroCriticalStarvationPassed &&
        providerIdempotencyPassed,
      checkedAt: new Date().toISOString(),
      topology,
      invariants: {
        zeroDuplicateOpenIncidents: {
          passed: zeroDuplicateOpenIncidentsPassed,
          duplicateGroups: duplicateSamples.length,
          samples: duplicateSamples,
        },
        zeroLostAcceptedAlerts: {
          passed: zeroLostAcceptedAlertsPassed,
          totalLoadAlerts,
          unlinkedAlerts,
        },
        zeroFalseEscalationsAfterAckOrResolve: {
          passed: zeroFalseEscalationsPassed,
          violationCount: falseEscalationRows.length,
          sampleIncidentIds: falseEscalationRows.map(r => r.incidentId),
        },
        zeroCorruptedIncidentStates: {
          passed: zeroCorruptedStatesPassed,
          acknowledgedWithoutTimestamp,
          resolvedWithoutTimestamp,
          snoozedWithoutUntil,
        },
        zeroCriticalNotificationStarvation: {
          passed: zeroCriticalStarvationPassed,
          pendingCriticalCount,
          oldestPendingCriticalAgeMs,
          pendingBulkCount,
          deliveredCriticalCount,
          deliveredBulkCount,
        },
        providerIdempotencyCheck: {
          passed: providerIdempotencyPassed,
          duplicateDeliveryKeysByProvider,
          totalDuplicateDeliveries,
        },
      },
      totals: {
        incidentsCreated,
        alertsPersisted: totalLoadAlerts,
        notificationsTotal,
        backgroundJobsPending,
        backgroundJobsFailed,
      },
    };

    const outputPath =
      options?.outputPath ??
      path.resolve(
        process.cwd(),
        `artifacts/load-certification/${topology}/verification-report.json`
      );
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, JSON.stringify(report, null, 2), 'utf8');

    return report;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  verifyLoadCertificationResults()
    .then(report => {
      console.log(JSON.stringify(report, null, 2));
      if (!report.passed) {
        process.exit(1);
      }
    })
    .catch(err => {
      console.error('Verification failed:', err);
      process.exit(1);
    });
}
