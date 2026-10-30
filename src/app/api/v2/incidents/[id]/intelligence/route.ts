import { NextRequest } from 'next/server';
import { apiV2Error, apiV2Success, authenticateV2Request, enforceV2Authorization, enforceV2RateLimit } from '@/lib/api-v2';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { requireIncidentDiagnosticAccess } from '@/lib/api-v2/incident-diagnostics';
import { withV2Observability } from '@/lib/api-v2/observability';
import { buildIncidentIntelligence } from '@/lib/intelligence/api/incident-intelligence';

/** Similar incidents, related incidents, possible causes and runbook suggestions for one incident. */
export const GET = withV2Observability(async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { apiKey, actor } = await authenticateV2Request(req);
    const rlHeaders = await enforceV2RateLimit(apiKey.id, 'SEARCH_EXPORT');
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.INCIDENT_READ);
    const { id } = await params;
    await requireIncidentDiagnosticAccess(actor, id);
    return apiV2Success(await buildIncidentIntelligence(id, actor), {
      headers: { ...rlHeaders, 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return apiV2Error(error, req);
  }
});
