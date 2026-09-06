import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import { assertAdmin } from '@/lib/rbac';
import prisma from '@/lib/prisma';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError, isAppError } from '@/lib/errors';
import { prismaToAppError } from '@/lib/prisma-errors';
import { CustomFieldCreateSchema } from '@/lib/validation';
import { logger } from '@/lib/logger';
import type { Prisma } from '@prisma/client';

const CUSTOM_FIELD_KEY_CONFLICT = {
  code: 'VALIDATION_FAILED' as const,
  userMessage: 'A custom field with this key already exists',
  action: 'Choose a different custom-field key.',
  fields: [
    { field: 'key', code: 'duplicate', message: 'A custom field with this key already exists' },
  ],
};

/**
 * Create Custom Field
 * POST /api/settings/custom-fields
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(await getAuthOptions());
    if (!session) {
      return jsonError(new AppError({ code: 'AUTHENTICATION_REQUIRED' }));
    }

    await assertAdmin();

    let body: unknown;
    try {
      body = await req.json();
    } catch (error) {
      return jsonError(new AppError({ code: 'INVALID_JSON', cause: error }));
    }

    const parsed = CustomFieldCreateSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(
        new AppError({
          code: 'VALIDATION_FAILED',
          userMessage: 'Invalid request body.',
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
    const { name, key, type, required, defaultValue, options, showInList } = parsed.data;

    const existing = await prisma.customField.findUnique({ where: { key } });
    if (existing) {
      return jsonError(new AppError(CUSTOM_FIELD_KEY_CONFLICT));
    }

    const maxOrder = await prisma.customField.aggregate({ _max: { order: true } });

    const fieldData: Prisma.CustomFieldCreateInput = {
      name,
      key,
      type,
      required: required || false,
      defaultValue: defaultValue || null,
      showInList: showInList || false,
      order: (maxOrder._max.order || 0) + 1,
    };

    if (options !== undefined && options !== null) {
      fieldData.options = options as Prisma.InputJsonValue;
    }

    const customField = await prisma.customField.create({ data: fieldData });

    logger.info('api.custom_fields.created', { customFieldId: customField.id });
    return jsonOk({ success: true, field: customField }, 200);
  } catch (error) {
    const prismaError = prismaToAppError(error, { unique: CUSTOM_FIELD_KEY_CONFLICT });
    if (prismaError) return jsonError(prismaError);
    if (isAppError(error)) return jsonError(error);

    logger.error('api.custom_fields.create_error', { error });
    return jsonError('Failed to create custom field', 500);
  }
}

/**
 * Get All Custom Fields
 * GET /api/settings/custom-fields
 */
export async function GET() {
  try {
    const session = await getServerSession(await getAuthOptions());
    if (!session) {
      return jsonError(new AppError({ code: 'AUTHENTICATION_REQUIRED' }));
    }

    const customFields = await prisma.customField.findMany({
      orderBy: { order: 'asc' },
      include: {
        _count: {
          select: { values: true },
        },
      },
    });

    return jsonOk({ fields: customFields }, 200);
  } catch (error) {
    if (isAppError(error)) return jsonError(error);
    logger.error('api.custom_fields.fetch_error', { error });
    return jsonError('Failed to fetch custom fields', 500);
  }
}
