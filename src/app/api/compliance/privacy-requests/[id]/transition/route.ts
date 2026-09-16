import { z } from 'zod';
import { CAPABILITIES } from '@/lib/authorization';
import { assertCapability } from '@/lib/rbac';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError, isAppError } from '@/lib/errors';
import { transitionPrivacyRequest } from '@/lib/privacy/requests';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await assertCapability(CAPABILITIES.PRIVACY_REQUESTS_MANAGE);
    const { id } = await params;

    let body: unknown;
    try {
      body = await request.json();
    } catch (error) {
      return jsonError(new AppError({ code: 'INVALID_JSON', cause: error }));
    }

    const updated = await transitionPrivacyRequest(
      { ...(body as object), requestId: id },
      { id: actor.id }
    );
    return jsonOk({ request: updated });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonError(
        new AppError({
          code: 'VALIDATION_FAILED',
          fields: error.issues.map(issue => ({
            field: issue.path.join('.') || 'request',
            code: issue.code,
            message: issue.message,
          })),
        })
      );
    }
    if (isAppError(error)) return jsonError(error);
    return jsonError('Failed to transition privacy request', 500);
  }
}
