import { NextRequest } from 'next/server';
import { apiV2Error, apiV2Success, authenticateV2Request, enforceV2Authorization, enforceV2RateLimit } from '@/lib/api-v2';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { listIncidentExecutionPage, requireIncidentDiagnosticAccess } from '@/lib/api-v2/incident-diagnostics';
import { withV2Observability } from '@/lib/api-v2/observability';

export const GET = withV2Observability(async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { apiKey, actor } = await authenticateV2Request(req);
    const rlHeaders = await enforceV2RateLimit(apiKey.id, 'READ');
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.INCIDENT_READ);
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.RUNBOOK_READ);
    const { id } = await params;
    await requireIncidentDiagnosticAccess(actor, id);
    const page = await listIncidentExecutionPage(actor, id, new URL(req.url).searchParams);
    return apiV2Success(page.data, {
      pagination: page.pagination,
      headers: { ...rlHeaders, 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return apiV2Error(error, req);
  }
});
