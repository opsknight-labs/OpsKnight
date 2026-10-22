import { z } from 'zod';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import { defineV2Route, logV2Audit } from '@/lib/api-v2';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { etagHeaders, requireRevisionIfMatch } from '@/lib/api-v2/concurrency';
import { updateDefinitionSchema, validateDefinition } from '@/lib/custom-fields/definitions';

const paramsSchema = z.object({ id: z.string().trim().min(1).max(100) }).strict();

export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.CUSTOM_FIELD_READ,
  paramsSchema, querySchema: z.object({}).strict(),
  handler: async ({ params }) => {
    const field = await prisma.customField.findUnique({
      where: { id: params.id }, include: { _count: { select: { values: true } } },
    });
    if (!field) throw new AppError({ code: 'RESOURCE_NOT_FOUND' });
    const { _count, ...definition } = field;
    return { data: { ...definition, usageCount: _count.values },
      headers: { ...etagHeaders(field.revision), 'Cache-Control': 'private, no-store' } };
  },
});

export const PATCH = defineV2Route({
  action: AUTHORIZATION_ACTIONS.CUSTOM_FIELD_MANAGE,
  paramsSchema, querySchema: z.object({}).strict(), bodySchema: updateDefinitionSchema,
  preconditionRequired: true, idempotent: true, idempotencyRequired: true,
  replayAuthGuard: async ({ params, tx }) => {
    if (!await tx!.customField.count({ where: { id: params.id } })) throw new AppError({ code: 'RESOURCE_NOT_FOUND' });
  },
  handler: async ({ params, body, actor, apiKey, req, tx }) => {
    const expected = requireRevisionIfMatch(req);
    await tx!.$queryRaw`SELECT "id" FROM "CustomField" WHERE "id" = ${params.id} FOR UPDATE`;
    const existing = await tx!.customField.findUnique({ where: { id: params.id } });
    if (!existing) throw new AppError({ code: 'RESOURCE_NOT_FOUND' });
    if (existing.revision !== expected) throw new AppError({ code: 'PRECONDITION_FAILED' });
    const options = body.options === undefined
      ? (Array.isArray(existing.options) ? existing.options.filter((item): item is string => typeof item === 'string') : null)
      : body.options;
    const merged = {
      name: body.name ?? existing.name, type: existing.type,
      required: body.required ?? existing.required,
      defaultValue: body.defaultValue === undefined ? existing.defaultValue : body.defaultValue,
      options,
    };
    validateDefinition(merged);
    if (existing.type === 'SELECT' && body.options !== undefined) {
      const incompatible = await tx!.customFieldValue.count({
        where: { customFieldId: existing.id, value: { not: null, notIn: options ?? [] } },
      });
      if (incompatible) throw new AppError({ code: 'RESOURCE_CONFLICT', userMessage: 'Existing incident values use options being removed.' });
    }
    const changed = await tx!.customField.update({
      where: { id: existing.id }, data: {
        ...(body.name === undefined ? {} : { name: body.name }),
        ...(body.required === undefined ? {} : { required: body.required }),
        ...(body.defaultValue === undefined ? {} : { defaultValue: body.defaultValue }),
        ...(body.options === undefined ? {} : { options: body.options === null ? Prisma.DbNull : body.options }),
        ...(body.showInList === undefined ? {} : { showInList: body.showInList }),
        ...(body.order === undefined ? {} : { order: body.order }),
      },
    });
    const usageCount = await tx!.customFieldValue.count({ where: { customFieldId: existing.id } });
    await logV2Audit({
      action: 'custom_field.updated', entityType: 'CUSTOM_FIELD', entityId: existing.id,
      actorId: actor.id, apiKeyId: apiKey.id,
      details: { changes: Object.keys(body) }, tx,
    });
    return { data: { ...changed, usageCount },
      headers: { ...etagHeaders(changed.revision), 'Cache-Control': 'private, no-store' } };
  },
});

export const DELETE = defineV2Route({
  action: AUTHORIZATION_ACTIONS.CUSTOM_FIELD_MANAGE,
  paramsSchema, querySchema: z.object({}).strict(),
  preconditionRequired: true, idempotent: true, idempotencyRequired: true,
  replayAuthGuard: async ({ params, tx }) => {
    if (!await tx!.customField.count({ where: { id: params.id } })) throw new AppError({ code: 'RESOURCE_NOT_FOUND' });
  },
  handler: async ({ params, actor, apiKey, req, tx }) => {
    const expected = requireRevisionIfMatch(req);
    await tx!.$queryRaw`SELECT "id" FROM "CustomField" WHERE "id" = ${params.id} FOR UPDATE`;
    const existing = await tx!.customField.findUnique({ where: { id: params.id } });
    if (!existing) throw new AppError({ code: 'RESOURCE_NOT_FOUND' });
    if (existing.revision !== expected) throw new AppError({ code: 'PRECONDITION_FAILED' });
    const usageCount = await tx!.customFieldValue.count({ where: { customFieldId: existing.id } });
    if (usageCount) throw new AppError({ code: 'RESOURCE_CONFLICT', userMessage: 'Remove incident values before deleting this field.' });
    await tx!.customField.delete({ where: { id: existing.id } });
    await logV2Audit({
      action: 'custom_field.deleted', entityType: 'CUSTOM_FIELD', entityId: existing.id,
      actorId: actor.id, apiKeyId: apiKey.id,
      details: { key: existing.key }, tx,
    });
    return { status: 204 };
  },
});
