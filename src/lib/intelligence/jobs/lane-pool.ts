import 'server-only';
import { withIntelligenceDatabase } from '@/lib/database-workload';
import {
  DEFAULT_INTELLIGENCE_LANE_POOL_SIZE,
  intelligenceLanePoolSize,
  isIntelligenceLaneThread,
} from '@/lib/prisma-datasource';
import { getOpsKnightProcessRole } from '@/lib/runtime-role';

/**
 * Where the lane's database work runs. In a process it shares with ingestion and paging (`integrated`,
 * `worker`, `general-worker`) the lane gets a small pool of its own, so an analysis transaction can
 * never hold a connection that `processEvent` is queueing for. The dedicated `intelligence-worker`
 * role is the lane alone and keeps the process pool. `INTELLIGENCE_LANE_DATABASE_POOL_SIZE=0` restores
 * the shared pool. In a lane thread (see lane-thread.ts) the thread's whole Prisma client is the lane's pool,
 * sized like the in-process lane pool, so nothing is switched per call but concurrency is still capped.
 */
export interface LanePoolPlan {
  ownPool: boolean;
  size: number;
}

export function resolveLanePool(
  role: string = getOpsKnightProcessRole(),
  size: number = intelligenceLanePoolSize(),
  laneThread: boolean = isIntelligenceLaneThread()
): LanePoolPlan {
  if (laneThread)
    return { ownPool: false, size: size > 0 ? size : DEFAULT_INTELLIGENCE_LANE_POOL_SIZE };
  if (role === 'intelligence-worker' || size <= 0) return { ownPool: false, size: 0 };
  return { ownPool: true, size };
}

/** Connections held back from handlers for claims, lease renewal, enqueues and cancelling a statement. */
const LANE_POOL_RESERVE = 2;

/**
 * Handlers run in transactions and may read outside them, so concurrency is capped below the lane pool
 * size: a full pool would make handlers queue on each other until the pool timeout. With the default
 * pool of 10 that cap is 8, above the default `maxConcurrency` of 2. On the shared pool (size 0) the
 * operator's setting applies unchanged.
 */
export function laneConcurrency(plan: LanePoolPlan, maxConcurrency: number): number {
  if (plan.size <= 0) return maxConcurrency;
  return Math.max(1, Math.min(maxConcurrency, plan.size - LANE_POOL_RESERVE));
}

export function runOnLanePool<T>(plan: LanePoolPlan, work: () => Promise<T>): Promise<T> {
  return plan.ownPool ? withIntelligenceDatabase(work) : work();
}
