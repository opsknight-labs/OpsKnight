import { NextResponse } from 'next/server';
import { assertAdmin } from '@/lib/rbac';
import { getRollupCoverage } from '@/lib/metric-rollup';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * Admin-only rollup health endpoint.
 *
 * Returns coverage stats answering "do we have usable rollup data
 * for the >90-day analytics queries?". Used by ops to confirm the
 * self-healing backfill is making progress and by the drift-detection
 * job to gate on coverage before comparing.
 *
 * Response:
 *   {
 *     "oldestRollupDate": "2025-05-22",   // null if table is empty
 *     "newestRollupDate": "2026-05-22",
 *     "daysCovered": 365,                   // global rollups in retention window
 *     "daysExpected": 365,                  // metricsRetentionDays
 *     "coveragePercent": 100,
 *     "globalRollupCount": 365,
 *     "totalRollupCount": 18250,            // global + per-service + per-team
 *     "retentionDays": 365
 *   }
 */
export async function GET() {
  try {
    await assertAdmin();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unauthorized' },
      { status: 403 }
    );
  }

  try {
    const coverage = await getRollupCoverage();
    return NextResponse.json(coverage);
  } catch (err) {
    logger.error('[Admin] Rollup health query failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: 'Failed to load coverage' }, { status: 500 });
  }
}
