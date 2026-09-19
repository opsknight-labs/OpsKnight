import prisma from '@/lib/prisma';
import { CAPABILITIES } from '@/lib/authorization';
import { assertCapability } from '@/lib/rbac';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError, isAppError } from '@/lib/errors';
import { getRetentionHold } from '@/lib/retention/holds';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await assertCapability(CAPABILITIES.RETENTION_READ);
    const { id } = await params;

    const hold = await getRetentionHold(prisma, id);
    if (!hold) {
      return jsonError('Retention hold not found', 404);
    }

    return jsonOk({ hold }, 200, { 'Cache-Control': 'private, no-store' });
  } catch (error) {
    if (isAppError(error)) return jsonError(error);
    return jsonError(new AppError({ code: 'INTERNAL_ERROR', cause: error }));
  }
}
