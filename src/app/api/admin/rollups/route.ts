import { NextRequest, NextResponse } from 'next/server';
import { assertAdmin } from '@/lib/rbac';
import { invalidateRollups } from '@/lib/metric-rollup';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * Admin-only rollup invalidation (delete in a date range).
 *
 * Use case: a rollup-gen bug was fixed and historical rollups need
 * to be regenerated. Run DELETE first, then the self-healing cron
 * (or a POST /backfill call) re-creates them with the fixed logic.
 *
 * Query params:
 *   - fromDate    YYYY-MM-DD (required)
 *   - toDate      YYYY-MM-DD (required)
 *   - serviceId   optional; omit for all services
 *
 * Returns: { deleted: <count> }
 */
export async function DELETE(req: NextRequest) {
  try {
    await assertAdmin();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unauthorized' },
      { status: 403 }
    );
  }

  const { searchParams } = new URL(req.url);
  const fromDateStr = searchParams.get('fromDate');
  const toDateStr = searchParams.get('toDate');
  const serviceId = searchParams.get('serviceId') ?? undefined;

  if (!fromDateStr || !toDateStr) {
    return NextResponse.json(
      { error: 'fromDate and toDate (YYYY-MM-DD) are required' },
      { status: 400 }
    );
  }

  const fromDate = new Date(fromDateStr);
  const toDate = new Date(toDateStr);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    return NextResponse.json({ error: 'Invalid date format; use YYYY-MM-DD' }, { status: 400 });
  }
  if (fromDate > toDate) {
    return NextResponse.json({ error: 'fromDate must be <= toDate' }, { status: 400 });
  }

  try {
    const deleted = await invalidateRollups(fromDate, toDate, serviceId);
    return NextResponse.json({
      deleted,
      fromDate: fromDateStr,
      toDate: toDateStr,
      serviceId: serviceId ?? null,
    });
  } catch (err) {
    logger.error('[Admin] Rollup invalidate failed', {
      fromDate: fromDateStr,
      toDate: toDateStr,
      serviceId,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: 'Invalidate failed' }, { status: 500 });
  }
}
