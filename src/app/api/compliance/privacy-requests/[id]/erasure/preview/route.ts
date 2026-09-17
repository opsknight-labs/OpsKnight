import { CAPABILITIES } from '@/lib/authorization';
import { assertCapability } from '@/lib/rbac';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError, isAppError } from '@/lib/errors';
import prisma from '@/lib/prisma';
import { buildSubjectErasurePlan } from '@/lib/privacy/erasure/plan';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    // Reading a preview requires the stronger erasure capability, not just
    // PRIVACY_READ — a plan preview enumerates exactly what would be deleted,
    // which is itself sensitive.
    await assertCapability(CAPABILITIES.PRIVACY_ERASURE);
    const { id } = await params;

    const request = await prisma.privacyRequest.findUnique({ where: { id } });
    if (!request) {
      return jsonError(new AppError({ code: 'PRIVACY_REQUEST_NOT_FOUND' }));
    }
    if (request.requestType !== 'ERASURE' || request.subjectType !== 'USER') {
      return jsonError(
        new AppError({
          code: 'PRIVACY_ERASURE_PREREQUISITES_NOT_MET',
          details: { requestType: request.requestType, subjectType: request.subjectType },
        })
      );
    }

    const plan = await buildSubjectErasurePlan(request.subjectId);
    return jsonOk({ plan }, 200, { 'Cache-Control': 'private, no-store' });
  } catch (error) {
    if (isAppError(error)) return jsonError(error);
    return jsonError(new AppError({ code: 'INTERNAL_ERROR', cause: error }));
  }
}
