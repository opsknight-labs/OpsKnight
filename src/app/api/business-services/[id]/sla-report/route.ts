import type { NextRequest } from 'next/server';
import { z } from 'zod/v3';
import { jsonError } from '@/lib/api-response';
import { isAppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import {
  getBusinessServiceSlaReport,
  slaReportCsv,
  slaReportPdf,
  SlaReportQuerySchema,
} from '@/lib/business-services/sla-report';

export const dynamic = 'force-dynamic';

const QuerySchema = SlaReportQuerySchema.extend({ format: z.enum(['csv', 'pdf']).default('csv') });

/** GET /api/business-services/{id}/sla-report?month=YYYY-MM&format=csv|pdf — the monthly SLA report as a file. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const query = QuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  const { id } = await params;
  if (!query.success || !id || id.length > 100) return jsonError('Invalid report request.', 400);
  try {
    const actor = await getCurrentAuthorizationActor();
    const report = await getBusinessServiceSlaReport(id, query.data.month, actor);
    const slug = report.name.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'service';
    const filename = `sla-${slug}-${report.month}.${query.data.format}`;
    const body =
      query.data.format === 'pdf' ? new Uint8Array(slaReportPdf(report)) : slaReportCsv(report);
    return new Response(body, {
      headers: {
        'Content-Type': query.data.format === 'pdf' ? 'application/pdf' : 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    if (isAppError(error) && error.status < 500) return jsonError(error.userMessage, error.status);
    logger.error('[BusinessService] SLA report failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonError('Unable to build the report right now.', 500);
  }
}
