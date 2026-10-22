import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import { assertAdmin } from '@/lib/rbac';
import prisma from '@/lib/prisma';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError, isAppError } from '@/lib/errors';
import { prismaToAppError } from '@/lib/prisma-errors';
import { logger } from '@/lib/logger';
import { emitAuditEvent } from '@/lib/audit';
import { Prisma } from '@prisma/client';
import { updateDefinitionSchema, validateDefinition } from '@/lib/custom-fields/definitions';

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

    const actor = await assertAdmin();
    const { id } = await params;

    let body: unknown;
    try {
      body = await req.json();
    } catch (error) {
      return jsonError(new AppError({ code: 'INVALID_JSON', cause: error }));
    }

    const parsed = updateDefinitionSchema.safeParse(body);
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

    const updatedField = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "CustomField" WHERE "id" = ${id} FOR UPDATE`;
      const existing = await tx.customField.findUnique({ where: { id } });
      if (!existing) {
        throw new AppError({ code: 'RESOURCE_NOT_FOUND', userMessage: 'Custom field not found.' });
      }

      const nextOptions = options === undefined
        ? (Array.isArray(existing.options) ? existing.options.filter((item): item is string => typeof item === 'string') : null)
        : options;
      validateDefinition({
        name: name ?? existing.name, type: existing.type,
        required: required ?? existing.required,
        defaultValue: defaultValue === undefined ? existing.defaultValue : defaultValue,
        options: nextOptions,
      });
      if (existing.type === 'SELECT' && options !== undefined) {
        const incompatible = await tx.customFieldValue.count({
          where: { customFieldId: id, value: { not: null, notIn: nextOptions ?? [] } },
        });
        if (incompatible) throw new AppError({ code: 'RESOURCE_CONFLICT', userMessage: 'Existing incident values use options being removed.' });
      }

      const updated = await tx.customField.update({
        where: { id },
        data: updateData,
      });

      await emitAuditEvent(
        {
          action: 'custom_field.updated',
          source: 'UI',
          target: { type: 'CUSTOM_FIELD', id },
          actor: { type: 'USER', id: actor.id, email: actor.email, name: actor.name },
          oldValue: {
            name: existing.name,
            required: existing.required,
            defaultValue: existing.defaultValue,
            options: existing.options as Prisma.InputJsonValue,
            showInList: existing.showInList,
            order: existing.order,
          },
          newValue: {
            name: updated.name,
            required: updated.required,
            defaultValue: updated.defaultValue,
            options: updated.options as Prisma.InputJsonValue,
            showInList: updated.showInList,
            order: updated.order,
          },
        },
        tx
      );

      return updated;
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

    const actor = await assertAdmin();
    const { id } = await params;

    await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "CustomField" WHERE "id" = ${id} FOR UPDATE`;
      const existing = await tx.customField.findUnique({ where: { id } });
      if (!existing) {
        throw new AppError({ code: 'RESOURCE_NOT_FOUND', userMessage: 'Custom field not found.' });
      }

      const usageCount = await tx.customFieldValue.count({ where: { customFieldId: id } });
      if (usageCount) throw new AppError({
        code: 'RESOURCE_CONFLICT', userMessage: 'Remove incident values before deleting this field.',
      });
      await tx.customField.delete({ where: { id } });

      await emitAuditEvent(
        {
          action: 'custom_field.deleted',
          source: 'UI',
          target: { type: 'CUSTOM_FIELD', id },
          actor: { type: 'USER', id: actor.id, email: actor.email, name: actor.name },
          oldValue: {
            name: existing.name,
            key: existing.key,
            type: existing.type,
            required: existing.required,
            defaultValue: existing.defaultValue,
            options: existing.options as Prisma.InputJsonValue,
            showInList: existing.showInList,
            order: existing.order,
          },
          metadata: { cascade: 'customFieldValue' },
        },
        tx
      );
    });

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
