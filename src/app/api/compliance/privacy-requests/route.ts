import { NextRequest } from 'next/server';
import { z } from 'zod';
import type { PrivacyRequestStatus, PrivacyRequestType } from '@prisma/client';
import { CAPABILITIES } from '@/lib/authorization';
import { assertCapability } from '@/lib/rbac';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError, isAppError } from '@/lib/errors';
import { createPrivacyRequest, listPrivacyRequests } from '@/lib/privacy/requests';

const listQuerySchema = z.object({
  status: z
    .enum([
      'RECEIVED',
      'IDENTITY_VERIFICATION',
      'IN_REVIEW',
      'PROCESSING',
      'BLOCKED',
      'COMPLETED',
      'REJECTED',
    ])
    .optional(),
  requestType: z
    .enum(['ACCESS', 'RECTIFICATION', 'ERASURE', 'RESTRICTION', 'OBJECTION', 'PORTABILITY'])
    .optional(),
});

export async function GET(request: NextRequest) {
  try {
    await assertCapability(CAPABILITIES.PRIVACY_READ);

    const parsed = listQuerySchema.safeParse({
      status: request.nextUrl.searchParams.get('status') ?? undefined,
      requestType: request.nextUrl.searchParams.get('requestType') ?? undefined,
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

    const requests = await listPrivacyRequests({
      status: parsed.data.status as PrivacyRequestStatus | undefined,
      requestType: parsed.data.requestType as PrivacyRequestType | undefined,
    });
    return jsonOk({ requests }, 200, { 'Cache-Control': 'private, no-store' });
  } catch (error) {
    if (isAppError(error)) return jsonError(error);
    return jsonError('Failed to list privacy requests', 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await assertCapability(CAPABILITIES.PRIVACY_REQUESTS_MANAGE);

    let body: unknown;
    try {
      body = await request.json();
    } catch (error) {
      return jsonError(new AppError({ code: 'INVALID_JSON', cause: error }));
    }

    const created = await createPrivacyRequest(body, { id: actor.id });
    return jsonOk({ request: created }, 201);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonError(
        new AppError({
          code: 'VALIDATION_FAILED',
          fields: error.issues.map(issue => ({
            field: issue.path.join('.') || 'request',
            code: issue.code,
            message: issue.message,
          })),
        })
      );
    }
    if (isAppError(error)) return jsonError(error);
    return jsonError('Failed to create privacy request', 500);
  }
}
