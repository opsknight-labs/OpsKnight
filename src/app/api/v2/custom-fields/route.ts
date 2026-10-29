import { z } from 'zod/v3';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import { defineV2Route, logV2Audit } from '@/lib/api-v2';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { createDefinitionSchema, validateDefinition } from '@/lib/custom-fields/definitions';

const querySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().trim().min(1).max(100).optional(),
  })
  .strict();

export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.CUSTOM_FIELD_READ,
  querySchema,
  rateLimitTier: 'SEARCH_EXPORT',
  handler: async ({ query }) => {
    if (query.cursor && !(await prisma.customField.count({ where: { id: query.cursor } }))) {
      throw new AppError({
        code: 'VALIDATION_FAILED',
        userMessage: 'Unknown custom-field cursor.',
      });
    }
    const rows = await prisma.customField.findMany({
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      orderBy: { id: 'asc' },
      take: query.limit + 1,
      include: { _count: { select: { values: true } } },
    });
    return {
      headers: { 'Cache-Control': 'private, no-store' },
      data: {
        fields: rows
          .slice(0, query.limit)
          .map(({ _count, ...field }) => ({ ...field, usageCount: _count.values })),
        nextCursor: rows.length > query.limit ? rows[query.limit - 1].id : null,
      },
    };
  },
});

export const POST = defineV2Route({
  action: AUTHORIZATION_ACTIONS.CUSTOM_FIELD_MANAGE,
  querySchema: z.object({}).strict(),
  bodySchema: createDefinitionSchema,
  idempotent: true,
  idempotencyRequired: true,
  handler: async ({ body, actor, apiKey, tx }) => {
    validateDefinition(body);
    const db = tx ?? prisma;
    // Shared with the UI create flow: ordering and key uniqueness are serialized.
    await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('settings:custom-fields:order', 0))`;
    if (await db.customField.count({ where: { key: body.key } })) {
      throw new AppError({
        code: 'RESOURCE_CONFLICT',
        userMessage: 'A custom field with this key already exists.',
      });
    }
    const maximum = await db.customField.aggregate({ _max: { order: true } });
    const field = await db.customField.create({
      data: {
        name: body.name,
        key: body.key,
        type: body.type,
        required: body.required,
        defaultValue: body.defaultValue,
        options: body.options === null ? undefined : (body.options as Prisma.InputJsonValue),
        showInList: body.showInList,
        order: (maximum._max.order ?? 0) + 1,
      },
    });
    await logV2Audit({
      action: 'custom_field.created',
      entityType: 'CUSTOM_FIELD',
      entityId: field.id,
      actorId: actor.id,
      apiKeyId: apiKey.id,
      details: { key: field.key, type: field.type },
      tx,
    });
    return { status: 201, headers: { 'Cache-Control': 'private, no-store' }, data: field };
  },
});
