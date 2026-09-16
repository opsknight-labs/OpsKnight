import { CAPABILITIES } from '@/lib/authorization';
import { assertCapability } from '@/lib/rbac';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError, isAppError } from '@/lib/errors';
import { createExportArtifact } from '@/lib/privacy/export/artifact';

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await assertCapability(CAPABILITIES.PRIVACY_EXPORT);
    const { id } = await params;

    const artifact = await createExportArtifact(id, { id: actor.id });
    return jsonOk({ artifact }, 201);
  } catch (error) {
    if (isAppError(error)) return jsonError(error);
    return jsonError(new AppError({ code: 'INTERNAL_ERROR', cause: error }));
  }
}
