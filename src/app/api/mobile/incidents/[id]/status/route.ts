import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';

import { getAuthOptions } from '@/lib/auth';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError, isAppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { updateIncidentStatus } from '@/lib/incidents/operator-lifecycle';

const StatusSchema = z.object({
  status: z.enum(['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'SNOOZED', 'SUPPRESSED']),
  expectedStatus: z.enum(['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'SNOOZED', 'SUPPRESSED']).optional(),
});

const LEGACY_UNAUTHORIZED_MESSAGE =
  'You do not have permission to perform this action. Please contact an administrator if you believe this is an error.';
const LEGACY_INVALID_INPUT_MESSAGE = 'Please check your input and try again.';

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const session = await getServerSession(await getAuthOptions());
    if (!session?.user?.email) {
      return jsonError(
        new AppError({
          code: 'AUTHENTICATION_REQUIRED',
          userMessage: LEGACY_UNAUTHORIZED_MESSAGE,
        })
      );
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return jsonError(
        new AppError({ code: 'INVALID_JSON', userMessage: LEGACY_INVALID_INPUT_MESSAGE })
      );
    }

    const parsed = StatusSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(
        new AppError({
          code: 'VALIDATION_FAILED',
          userMessage: LEGACY_INVALID_INPUT_MESSAGE,
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

    const idempotencyKey = req.headers.get('idempotency-key')?.trim();
    const result = await updateIncidentStatus(
      params.id,
      parsed.data.status,
      parsed.data.expectedStatus,
      'MOBILE',
      idempotencyKey
        ? { key: idempotencyKey, principalId: session.user.email.toLowerCase() }
        : undefined
    );

    return jsonOk(
      { success: true, ...(result.replayed ? { duplicate: true } : {}) },
      200,
      result.replayed ? { 'Idempotency-Replayed': 'true' } : undefined
    );
  } catch (error) {
    logger.error('api.mobile.incident.update_failed', {
      component: 'mobile-incident-status',
      error,
      incidentId: params.id,
      errorCode: isAppError(error) ? error.code : 'INTERNAL_ERROR',
    });

    if (isAppError(error)) return jsonError(error);
    return jsonError(new AppError({ code: 'INTERNAL_ERROR' }));
  }
}

export const POST = PATCH;
