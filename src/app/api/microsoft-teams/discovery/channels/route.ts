import { NextRequest } from 'next/server';
import { assertAdmin, assertCanModifyService } from '@/lib/rbac';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError, isAppError } from '@/lib/errors';
import { listMicrosoftTeamsChannelsForDiscovery } from '@/lib/microsoft-teams/client';

/**
 * GET /api/microsoft-teams/discovery/channels?teamId=...&serviceId=...
 * Lists channels in a Team via Graph `GET /teams/{team}/channels`.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const teamId = searchParams.get('teamId');
    const serviceId = searchParams.get('serviceId');

    if (!teamId?.trim()) {
      return jsonError(new AppError({ code: 'VALIDATION_FAILED', userMessage: 'teamId is required.' }));
    }

    if (serviceId) {
      await assertCanModifyService(serviceId);
    } else {
      await assertAdmin();
    }

    const result = await listMicrosoftTeamsChannelsForDiscovery(teamId.trim());
    if (result.error) {
      return jsonError(
        new AppError({
          code: 'NOTIFICATION_PROVIDER_UNAVAILABLE',
          userMessage: result.error === 'NOT_CONFIGURED'
            ? 'Microsoft Teams is not configured.'
            : `Failed to list channels: ${result.error}`,
          retryable: result.error !== 'NOT_CONFIGURED',
          details: { provider: 'microsoft-teams', reason: result.error },
        }),
      );
    }

    return jsonOk({ channels: result.channels });
  } catch (error) {
    if (isAppError(error)) return jsonError(error);
    return jsonError('Internal server error', 500);
  }
}
