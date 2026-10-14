import 'server-only';
import prisma from '@/lib/prisma';
import { evaluateRunbookWorkerEvidence, type WorkerEvidence } from './worker-health-contract';
export async function recordWorkerHeartbeat(
  evidence: WorkerEvidence & { runbookEnabled: boolean; role: string }
) {
  await prisma.$executeRaw`
    INSERT INTO "RuntimeWorkerHeartbeat" ("instanceId", lane, role, "runbookEnabled", running, "lastSeenAt", "lastSuccessAt", "lastReconciledAt", "lastError")
    VALUES (${evidence.instanceId}, ${evidence.lane}, ${evidence.role}, ${evidence.runbookEnabled}, ${evidence.running}, CURRENT_TIMESTAMP, ${evidence.lastSuccessAt}, ${evidence.lastReconciledAt}, ${evidence.lastError ? 'Worker reported a fault. Inspect worker logs.' : null})
    ON CONFLICT ("instanceId") DO UPDATE SET running = EXCLUDED.running, "runbookEnabled" = EXCLUDED."runbookEnabled", "lastSeenAt" = CURRENT_TIMESTAMP,
      "lastSuccessAt" = EXCLUDED."lastSuccessAt", "lastReconciledAt" = EXCLUDED."lastReconciledAt", "lastError" = EXCLUDED."lastError"`;
}
export async function getRunbookWorkerEvidence(now: Date) {
  try {
    const workers = await prisma.runtimeWorkerHeartbeat.findMany({
      where: {
        runbookEnabled: true,
        lastSeenAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
      },
      orderBy: { lastSeenAt: 'desc' },
      take: 100,
    });
    return evaluateRunbookWorkerEvidence(workers, now);
  } catch {
    return {
      status: 'UNKNOWN' as const,
      instances: 0,
      healthyInstances: 0,
      reason: 'Shared worker evidence is unavailable. Check migrations and database connectivity.',
    };
  }
}
