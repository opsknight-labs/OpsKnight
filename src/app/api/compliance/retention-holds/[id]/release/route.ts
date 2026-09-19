import { CAPABILITIES } from '@/lib/authorization';
import { assertCapability } from '@/lib/rbac';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError, isAppError } from '@/lib/errors';
import { releaseRetentionHold } from '@/lib/retention/holds';

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await assertCapability(CAPABILITIES.RETENTION_HOLDS_MANAGE);
    const { id } = await params;

    const result = await releaseRetentionHold(id, actor.id);
    return jsonOk({ hold: result.hold, wasAlreadyReleased: result.wasAlreadyReleased });
  } catch (error) {
    if (isAppError(error)) return jsonError(error);
    if (error instanceof Error && error.message.includes('not found')) {
      return jsonError(error.message, 404);
    }
    return jsonError(new AppError({ code: 'INTERNAL_ERROR', cause: error }));
  }
}
