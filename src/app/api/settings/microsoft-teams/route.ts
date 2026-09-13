import { NextRequest } from 'next/server';
import { assertAdmin, getCurrentUser } from '@/lib/rbac';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError, isAppError } from '@/lib/errors';
import { saveMicrosoftTeamsConfig } from '@/app/(app)/settings/integrations/microsoft-teams/actions';

export async function POST(request: NextRequest) {
  try {
    await assertAdmin();
    const formData = await request.formData();
    const result = await saveMicrosoftTeamsConfig(formData);
    if (result?.error) {
      return jsonError(new AppError({ code: 'VALIDATION_FAILED', userMessage: result.error }));
    }
    return jsonOk({ success: true });
  } catch (error) {
    if (isAppError(error)) return jsonError(error);
    return jsonError('Failed to save Microsoft Teams configuration', 500);
  }
}

export async function DELETE(_request: NextRequest) {
  try {
    await assertAdmin();
    const user = await getCurrentUser();
    const { disconnectMicrosoftTeamsIntegration } = await import('@/lib/microsoft-teams/lifecycle');
    await disconnectMicrosoftTeamsIntegration(user.id);
    return jsonOk({ success: true });
  } catch (error) {
    if (isAppError(error)) return jsonError(error);
    return jsonError('Failed to delete Microsoft Teams configuration', 500);
  }
}
