import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import { assertAdmin } from '@/lib/rbac';
import prisma from '@/lib/prisma';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError, isAppError } from '@/lib/errors';
import { prismaToAppError } from '@/lib/prisma-errors';
import { CustomFieldUpdateSchema } from '@/lib/validation';
import { logger } from '@/lib/logger';
import { Prisma } from '@prisma/client';

/**
 * Update Custom Field
 * PATCH /api/settings/custom-fields/[id]
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(await getAuthOptions());
    if (!session) {
      return jsonError(new AppError({ code: 'AUTHENTICATION_REQUIRED' }));
    }

    await assertAdmin();
    const { id } = await params;

    let body: unknown;
    try {
      body = await req.json();
    } catch (error) {
      return jsonError(new AppError({ code: 'INVALID_JSON', cause: error }));
    }

    const parsed = CustomFieldUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(
        new AppError({
          code: 'VALIDATION_FAILED',
          userMessage: 'Invalid update payload.',
          fields: parsed.error.issues.map(issue => ({
            field: issue.path.join('.') || 'request',
            code: issue.code,
            message: issue.message,
          })),
        }),
        undefined,
        { issues: parsed.error.issues }
      );
    }

    const { name, required, defaultValue, options, showInList, order } = parsed.data;

    const updateData: Prisma.CustomFieldUpdateInput = {};
    if (name !== undefined) updateData.name = name;
    if (required !== undefined) updateData.required = required;
    if (defaultValue !== undefined) updateData.defaultValue = defaultValue;
    if (showInList !== undefined) updateData.showInList = showInList;
    if (order !== undefined) updateData.order = order;
    if (options !== undefined) {
      updateData.options = (options as Prisma.InputJsonValue) ?? Prisma.DbNull;
    }

    const updatedField = await prisma.customField.update({
      where: { id },
      data: updateData,
    });

    logger.info('api.custom_fields.updated', { customFieldId: id });
    return jsonOk({ success: true, field: updatedField }, 200);
  } catch (error) {
    const prismaError = prismaToAppError(error, {
      notFound: {
        code: 'RESOURCE_NOT_FOUND',
        userMessage: 'Custom field not found.',
      },
    });
    if (prismaError) return jsonError(prismaError);
    if (isAppError(error)) return jsonError(error);

    logger.error('api.custom_fields.update_error', { error });
    return jsonError('Failed to update custom field', 500);
  }
}

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
