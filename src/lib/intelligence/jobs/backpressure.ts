import 'server-only';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';

/**
 * Backpressure signal: how long the oldest due paging-critical job has been waiting. Intelligence
 * yields whenever this grows, so a flood of analysis can never delay escalation or notifications.
 * Uses the existing (type, status, scheduledAt) index and reads at most one row.
 */
export async function getCriticalBacklogLagMs(client: typeof prisma = prisma): Promise<number> {
  const [row] = await client.$queryRaw<Array<{ lag_ms: number | null }>>(Prisma.sql`
    WITH oldest AS (
      (SELECT "scheduledAt" FROM "BackgroundJob"
       WHERE "type" IN ('ESCALATION'::"JobType", 'NOTIFICATION'::"JobType")
         AND "status" IN ('PENDING'::"JobStatus", 'PENDING_V2'::"JobStatus") AND "scheduledAt" <= now()
       ORDER BY "scheduledAt" LIMIT 1)
      UNION ALL
      (SELECT "scheduledAt" FROM "BackgroundJob"
       WHERE "type" = 'SCHEDULED_TASK' AND "status" IN ('PENDING', 'PENDING_V2')
         AND "scheduledAt" <= now() AND "payload"->>'task' = 'EVENT_SIDE_EFFECT'
         AND "payload"->>'lane' IN ('PERSONAL_NOTIFICATION', 'ORDINARY_DISPATCH')
       ORDER BY "scheduledAt" LIMIT 1)
    ) SELECT (EXTRACT(EPOCH FROM (now() - min("scheduledAt"))) * 1000)::float8 AS lag_ms FROM oldest
  `);
  return Math.max(0, row?.lag_ms ?? 0);
}

export interface PauseState {
  paused: boolean;
}

/**
 * Pause when the critical lag exceeds the configured threshold; resume only once it falls below
 * half of it, so the lane does not flap on and off around the boundary.
 */
export function evaluatePause(
  state: PauseState,
  lagMs: number,
  thresholdMs: number
): { paused: boolean; changed: boolean } {
  const paused = state.paused ? lagMs > thresholdMs / 2 : lagMs > thresholdMs;
  return { paused, changed: paused !== state.paused };
}
