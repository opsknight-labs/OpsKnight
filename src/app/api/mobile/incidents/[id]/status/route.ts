import { NextRequest } from 'next/server';
import { z } from 'zod';

import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError, isAppError } from '@/lib/errors';
import { logger, withRequestContext } from '@/lib/logger';
import { updateIncidentStatus } from '@/lib/incidents/operator-lifecycle';
import { getCurrentUser } from '@/lib/rbac';

const StatusSchema = z.object({
  status: z.enum(['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'SNOOZED', 'SUPPRESSED']),
  expectedStatus: z.enum(['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'SNOOZED', 'SUPPRESSED']).optional(),
});

const LEGACY_INVALID_INPUT_MESSAGE = 'Please check your input and try again.';

async function patchIncidentStatus(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const user = await getCurrentUser();

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
      idempotencyKey ? { key: idempotencyKey, principalId: user.id } : undefined
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

export const PATCH = withRequestContext(patchIncidentStatus, 'api.mobile.incident.status');
export const POST = PATCH;
