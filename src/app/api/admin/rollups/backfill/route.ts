import { NextRequest, NextResponse } from 'next/server';
import { assertAdmin } from '@/lib/rbac';
import { backfillRollups } from '@/lib/metric-rollup';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * Admin-only manual rollup backfill.
 *
 * The daily cron already self-heals gaps, but ops may want to force
 * a focused backfill — e.g., after fixing a rollup-gen bug, after
 * importing historical data, or to populate a specific service that
 * was created mid-window.
 *
 * Body (JSON):
 *   {
 *     "fromDate": "2025-01-01",     // required, YYYY-MM-DD
 *     "toDate":   "2025-12-31",     // required
 *     "serviceId": "cux..."         // optional; omit for all services
 *   }
 *
 * Response: 202 Accepted with the kicked-off summary. The backfill
 * runs synchronously within the request (bounded by Prisma timeout),
 * so callers should issue narrow ranges or call repeatedly.
 */
export async function POST(req: NextRequest) {
  try {
    await assertAdmin();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unauthorized' },
      { status: 403 }
    );
  }

  let body: { fromDate?: string; toDate?: string; serviceId?: string };
  try {
    body = (await req.json()) as { fromDate?: string; toDate?: string; serviceId?: string };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.fromDate || !body.toDate) {
    return NextResponse.json(
      { error: 'fromDate and toDate (YYYY-MM-DD) are required' },
      { status: 400 }
    );
  }

  const fromDate = new Date(body.fromDate);
  const toDate = new Date(body.toDate);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    return NextResponse.json({ error: 'Invalid date format; use YYYY-MM-DD' }, { status: 400 });
  }
  if (fromDate > toDate) {
    return NextResponse.json({ error: 'fromDate must be <= toDate' }, { status: 400 });
  }

  // Cap to a year per call so an accidental decade-long backfill
  // doesn't tie up a single Prisma connection. Caller can chunk.
  const MAX_DAYS_PER_CALL = 366;
  const dayCount =
    Math.floor((toDate.getTime() - fromDate.getTime()) / (24 * 60 * 60 * 1000)) + 1;
  if (dayCount > MAX_DAYS_PER_CALL) {
    return NextResponse.json(
      {
        error: `Range exceeds ${MAX_DAYS_PER_CALL} days; chunk into multiple calls`,
        requestedDays: dayCount,
        maxDays: MAX_DAYS_PER_CALL,
      },
      { status: 400 }
    );
  }

  const startedAt = Date.now();
  try {
    await backfillRollups(fromDate, toDate, body.serviceId);
    const durationMs = Date.now() - startedAt;
    logger.info('[Admin] Backfill complete', {
      fromDate: body.fromDate,
      toDate: body.toDate,
      serviceId: body.serviceId,
      durationMs,
    });
    return NextResponse.json({
      status: 'completed',
      fromDate: body.fromDate,
      toDate: body.toDate,
      serviceId: body.serviceId ?? null,
      durationMs,
    });
  } catch (err) {
    logger.error('[Admin] Backfill failed', {
      fromDate: body.fromDate,
      toDate: body.toDate,
      serviceId: body.serviceId,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: 'Backfill failed' }, { status: 500 });
  }
}
