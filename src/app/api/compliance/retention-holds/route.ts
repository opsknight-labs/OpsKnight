import { NextRequest } from 'next/server';
import { z } from 'zod';
import prisma from '@/lib/prisma';
import { CAPABILITIES } from '@/lib/authorization';
import { assertCapability } from '@/lib/rbac';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError, isAppError } from '@/lib/errors';
import {
  createRetentionHold,
  listRetentionHolds,
  type ListRetentionHoldsOptions,
} from '@/lib/retention/holds';

const listQuerySchema = z.object({
  scopeType: z.enum(['USER', 'INCIDENT', 'PRIVACY_REQUEST']).optional(),
  scopeId: z.string().optional(),
  status: z.enum(['ACTIVE', 'EXPIRED', 'RELEASED', 'ALL']).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const createHoldSchema = z.object({
  scopeType: z.enum(['USER', 'INCIDENT', 'PRIVACY_REQUEST']),
  scopeId: z.string().min(1, 'scopeId is required'),
  reason: z.string().min(1, 'reason is required').max(2000),
  externalReference: z.string().max(255).nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

export async function GET(request: NextRequest) {
  try {
    await assertCapability(CAPABILITIES.RETENTION_READ);

    const parsed = listQuerySchema.safeParse({
      scopeType: request.nextUrl.searchParams.get('scopeType') ?? undefined,
      scopeId: request.nextUrl.searchParams.get('scopeId') ?? undefined,
      status: request.nextUrl.searchParams.get('status') ?? undefined,
      cursor: request.nextUrl.searchParams.get('cursor') ?? undefined,
      limit: request.nextUrl.searchParams.get('limit') ?? undefined,
    });

    if (!parsed.success) {
      return jsonError(
        new AppError({
          code: 'VALIDATION_FAILED',
          fields: parsed.error.issues.map(issue => ({
            field: issue.path.join('.') || 'request',
            code: issue.code,
            message: issue.message,
          })),
        })
      );
    }

    const { holds, nextCursor } = await listRetentionHolds(
      prisma,
      parsed.data as ListRetentionHoldsOptions
    );
    return jsonOk({ holds, nextCursor }, 200, { 'Cache-Control': 'private, no-store' });
  } catch (error) {
    if (isAppError(error)) return jsonError(error);
    return jsonError(new AppError({ code: 'INTERNAL_ERROR', cause: error }));
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await assertCapability(CAPABILITIES.RETENTION_HOLDS_MANAGE);

    let body: unknown;
    try {
      body = await request.json();
    } catch (error) {
      return jsonError(new AppError({ code: 'INVALID_JSON', cause: error }));
    }

    const parsed = createHoldSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(
        new AppError({
          code: 'VALIDATION_FAILED',
          fields: parsed.error.issues.map(issue => ({
            field: issue.path.join('.') || 'request',
            code: issue.code,
            message: issue.message,
          })),
        })
      );
    }

    const expiresAt = parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : undefined;
    if (expiresAt && expiresAt <= new Date()) {
      return jsonError(
        new AppError({
          code: 'VALIDATION_FAILED',
          fields: [
            { field: 'expiresAt', code: 'custom', message: 'expiresAt must be in the future' },
          ],
        })
      );
    }

    const result = await createRetentionHold(
      {
        scopeType: parsed.data.scopeType,
        scopeId: parsed.data.scopeId,
        reason: parsed.data.reason,
        externalReference: parsed.data.externalReference ?? undefined,
        expiresAt,
      },
      user.id
    );

    return jsonOk({ hold: result.hold }, 201);
  } catch (error) {
    if (isAppError(error)) return jsonError(error);
    if (error instanceof Error && error.message.includes('not found')) {
      return jsonError(
        new AppError({ code: 'RESOURCE_NOT_FOUND', userMessage: error.message }),
        404
      );
    }
    return jsonError(new AppError({ code: 'INTERNAL_ERROR', cause: error }));
  }
}
