import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import { assertAdmin } from '@/lib/rbac';
import prisma from '@/lib/prisma';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError, isAppError } from '@/lib/errors';
import { prismaToAppError } from '@/lib/prisma-errors';
import { logger } from '@/lib/logger';

/**
 * Delete Custom Field
 * DELETE /api/settings/custom-fields/[id]
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(await getAuthOptions());
    if (!session) {
      return jsonError(new AppError({ code: 'AUTHENTICATION_REQUIRED' }));
    }

    await assertAdmin();
    const { id } = await params;

    await prisma.customFieldValue.deleteMany({ where: { customFieldId: id } });
    await prisma.customField.delete({ where: { id } });

    logger.info('api.custom_fields.deleted', { customFieldId: id });
    return jsonOk({ success: true }, 200);
  } catch (error) {
    const prismaError = prismaToAppError(error, {
      notFound: {
        code: 'RESOURCE_NOT_FOUND',
        userMessage: 'Custom field not found.',
      },
    });
    if (prismaError) return jsonError(prismaError);
    if (isAppError(error)) return jsonError(error);

    logger.error('api.custom_fields.delete_error', { error });
    return jsonError('Failed to delete custom field', 500);
  }
}
