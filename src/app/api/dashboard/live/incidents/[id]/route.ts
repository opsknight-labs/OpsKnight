import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError } from '@/lib/errors';
import { getLiveIncidentDetail } from '@/lib/dashboard/live-incidents';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(await getAuthOptions());
  if (!session) return jsonError(new AppError({ code: 'AUTHENTICATION_REQUIRED' }));

  const { id } = await params;
  if (!id || !/^[A-Za-z0-9_-]{1,100}$/.test(id)) {
    return jsonError(
      new AppError({
        code: 'INCIDENT_INVALID_ARGUMENT',
        userMessage: 'Invalid incident ID format.',
      })
    );
  }

  try {
    const actor = await getCurrentAuthorizationActor();
    const incident = await getLiveIncidentDetail(actor, id);
    if (!incident) {
      return jsonError(
        new AppError({
          code: 'RESOURCE_NOT_FOUND',
          userMessage: 'Incident not found or outside authorization scope.',
        })
      );
    }
    return jsonOk({ incident });
  } catch (error) {
    logger.error('dashboard.live.incident_detail_failed', { error, incidentId: id });
    return jsonError(
      new AppError({
        code: 'INTERNAL_ERROR',
        userMessage: 'Failed to retrieve incident details.',
        cause: error,
      })
    );
  }
}
