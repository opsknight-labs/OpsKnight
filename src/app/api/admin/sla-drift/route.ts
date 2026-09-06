import { NextRequest, NextResponse } from 'next/server';
import { assertAdmin } from '@/lib/rbac';
import { runSLADriftDetection } from '@/lib/sla-drift-detection';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * Admin-only endpoint that runs a one-shot drift check between the
 * live SLA aggregate path and the rollup path.
 *
 * Wired here as an on-demand trigger so an operator can verify
 * post-deploy that the two paths still agree on a known-historical
 * sample. The intended long-term home is a scheduled job (cron, EBS
 * task scheduler, or the project's internal job runner) calling
 * `runSLADriftDetection` directly — this endpoint is the manual
 * fallback and the integration-test surface.
 *
 * Query params:
 *   - `daysAgo` (optional, default `realTimeWindowDays + 30`):
 *     center of the sample window, in days back from today.
 *   - `tolerance` (optional, default 0.01): max acceptable divergence
 *     fraction; anything above triggers a `withinTolerance: false`.
 */
export async function GET(req: NextRequest) {
  try {
    await assertAdmin();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unauthorized' },
      { status: 403 }
    );
  }

  const { searchParams } = new URL(req.url);
  const daysAgoRaw = searchParams.get('daysAgo');
  const toleranceRaw = searchParams.get('tolerance');
  const daysAgoParsed = daysAgoRaw !== null ? Number.parseInt(daysAgoRaw, 10) : undefined;
  const toleranceParsed = toleranceRaw !== null ? Number.parseFloat(toleranceRaw) : undefined;

  // Bound input ranges defensively.
  const windowDaysAgo =
    daysAgoParsed !== undefined && Number.isFinite(daysAgoParsed) && daysAgoParsed > 0
      ? Math.min(Math.max(daysAgoParsed, 1), 3650)
      : undefined;
  const toleranceFraction =
    toleranceParsed !== undefined && Number.isFinite(toleranceParsed) && toleranceParsed >= 0
      ? Math.min(toleranceParsed, 1)
      : undefined;

  try {
    const report = await runSLADriftDetection({ windowDaysAgo, toleranceFraction });
    return NextResponse.json(report);
  } catch (err) {
    logger.error('[SLA-Drift] Endpoint failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: 'Drift detection failed' }, { status: 500 });
  }
}
