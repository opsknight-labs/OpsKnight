import { NextRequest } from 'next/server';
import { assertAdmin, assertCanModifyService } from '@/lib/rbac';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError, isAppError } from '@/lib/errors';
import { listMicrosoftTeamsForDiscovery } from '@/lib/microsoft-teams/client';

/**
 * GET /api/microsoft-teams/discovery/teams?serviceId=...
 * Lists Teams visible to the configured Azure AD app (Graph `GET /teams`).
 * RBAC: assertCanModifyService(serviceId) or assertAdmin()
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const serviceId = searchParams.get('serviceId');
    if (serviceId) {
      await assertCanModifyService(serviceId);
    } else {
      await assertAdmin();
    }

    const result = await listMicrosoftTeamsForDiscovery();
    if (result.error) {
      const retryable = /GRAPH_TOKEN_FAILED|TENANT_REQUIRED/.test(result.error) ? false : true;
      return jsonError(
        new AppError({
          code: 'NOTIFICATION_PROVIDER_UNAVAILABLE',
          userMessage: result.error === 'NOT_CONFIGURED'
            ? 'Microsoft Teams is not configured. Save Azure credentials in Settings → Integrations → Microsoft Teams.'
            : `Failed to list Teams: ${result.error}`,
          retryable,
          details: { provider: 'microsoft-teams', reason: result.error },
        }),
      );
    }

    return jsonOk({ teams: result.teams });
  } catch (error) {
    if (isAppError(error)) return jsonError(error);
    return jsonError('Internal server error', 500);
  }
}
