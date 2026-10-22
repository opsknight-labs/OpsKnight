import { NextRequest } from 'next/server';
import {
  apiV2Error, apiV2Success, authenticateV2Request,
  enforceV2Authorization, enforceV2RateLimit,
} from '@/lib/api-v2';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { listIncidentExecutionPage, requireIncidentDiagnosticAccess } from '@/lib/api-v2/incident-diagnostics';
import { AppError } from '@/lib/errors';
import { withV2Observability } from '@/lib/api-v2/observability';

/** Discover incident-linked executions without exposing inputs, plans or agent output. */
export const GET = withV2Observability(async function GET(req: NextRequest) {
  try {
    const { apiKey, actor } = await authenticateV2Request(req);
    const rlHeaders = await enforceV2RateLimit(apiKey.id, 'READ');
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.RUNBOOK_READ);
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.INCIDENT_READ);
    const searchParams = new URL(req.url).searchParams;
    const incidentIds = searchParams.getAll('incidentId');
    if (incidentIds.length !== 1 || !incidentIds[0].trim() || incidentIds[0].length > 100) {
      throw new AppError({ code: 'VALIDATION_FAILED', userMessage: 'One incidentId is required.' });
    }
    const incidentId = incidentIds[0].trim();
    await requireIncidentDiagnosticAccess(actor, incidentId);
    const result = await listIncidentExecutionPage(actor, incidentId, searchParams);
    return apiV2Success(result.data, {
      pagination: result.pagination,
      headers: { ...rlHeaders, 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return apiV2Error(error, req);
  }
});
