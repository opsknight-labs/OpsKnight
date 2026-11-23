import type { NextRequest } from 'next/server';
import { jsonError } from '@/lib/api-response';
import { AuthorizationError, CAPABILITIES } from '@/lib/authorization';
import {
  getBusinessImpactReport,
  impactReportCsv,
  parseImpactReportParams,
} from '@/lib/business-services/impact-report';
import { logger } from '@/lib/logger';
import { assertCapability, getCurrentAuthorizationActor } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

/** GET /api/insights/business-impact/export — the business impact report as CSV, scoped to the caller. */
export async function GET(request: NextRequest) {
  try {
    await assertCapability(CAPABILITIES.REPORT_EXPORT);
  } catch (error) {
    return error instanceof AuthorizationError
      ? jsonError('You do not have permission to export analytics.', 403)
      : jsonError('Unauthorized', 401);
  }
  try {
    const actor = await getCurrentAuthorizationActor();
    const params = parseImpactReportParams(request.nextUrl.searchParams);
    const report = await getBusinessImpactReport(actor, params);
    const day = report.window.to.toISOString().slice(0, 10);
    return new Response(impactReportCsv(report), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="business-impact-${params.days}d-${day}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    logger.error('[BusinessImpact] export failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonError('Unable to export the report right now.', 500);
  }
}
