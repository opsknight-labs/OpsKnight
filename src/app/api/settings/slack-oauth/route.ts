import { NextRequest } from 'next/server';
import { saveSlackOAuthConfig } from '@/app/(app)/settings/slack-oauth/actions';
import { assertAdmin, getCurrentUser } from '@/lib/rbac';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError, isAppError } from '@/lib/errors';

export async function POST(request: NextRequest) {
  try {
    await assertAdmin();

    const formData = await request.formData();
    const result = await saveSlackOAuthConfig(formData);

    if (result?.error) {
      return jsonError(
        new AppError({
          code: 'VALIDATION_FAILED',
          userMessage: result.error,
        })
      );
    }

    return jsonOk({ success: true });
  } catch (error) {
    if (isAppError(error)) return jsonError(error);
    return jsonError('Failed to save configuration', 500);
  }
}

export async function DELETE(_request: NextRequest) {
  try {
    await assertAdmin();

    const prisma = (await import('@/lib/prisma')).default;
    await prisma.slackOAuthConfig.deleteMany({});

    const { logAudit } = await import('@/lib/audit');
    const user = await getCurrentUser();

    await logAudit({
      action: 'slack.oauth.config.deleted',
      entityType: 'USER',
      entityId: user.id,
      actorId: user.id,
      details: { configType: 'slack-oauth' },
    });

    return jsonOk({ success: true });
  } catch (error) {
    if (isAppError(error)) return jsonError(error);
    return jsonError('Failed to delete configuration', 500);
  }
}
