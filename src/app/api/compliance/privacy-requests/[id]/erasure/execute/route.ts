import { CAPABILITIES } from '@/lib/authorization';
import { assertCapability } from '@/lib/rbac';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError, isAppError } from '@/lib/errors';
import { executeErasure } from '@/lib/privacy/erasure/execute';

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await assertCapability(CAPABILITIES.PRIVACY_ERASURE);
    const { id } = await params;

    const result = await executeErasure(id, { id: actor.id });
    return jsonOk({ execution: result }, 200);
  } catch (error) {
    if (isAppError(error)) return jsonError(error);
    return jsonError(new AppError({ code: 'INTERNAL_ERROR', cause: error }));
  }
}
