import { NextRequest } from 'next/server';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError, isAppError } from '@/lib/errors';
import { assertCanManageWarRoom } from '@/lib/rbac';
import { requestMicrosoftTeamsWarRoom } from '@/lib/war-room/microsoft-teams';

export async function POST(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    await assertCanManageWarRoom(id);
    const result = await requestMicrosoftTeamsWarRoom(id, {
      manual: true,
      allowNewGeneration: true,
    });
    if (!result.accepted)
      return jsonError(
        new AppError({
          code: 'VALIDATION_FAILED',
          userMessage: `Microsoft Teams war room cannot be created: ${result.code}.`,
        })
      );
    return jsonOk(result, 202);
  } catch (error) {
    return jsonError(
      isAppError(error)
        ? error
        : new AppError({
            code: 'INTERNAL_ERROR',
            userMessage: 'Unable to request Microsoft Teams war room.',
          })
    );
  }
}
