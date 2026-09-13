import 'server-only';

import type { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';

import { getAuthOptions } from '@/lib/auth';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError, isAppError } from '@/lib/errors';
import { logger, withRequestContext } from '@/lib/logger';
import { updateIncidentStatus } from '@/lib/incidents/operator-lifecycle';
import type { IncidentLifecycleSource } from '@/lib/incidents/lifecycle';

const IncidentStatusSchema = z.enum([
  'OPEN',
  'ACKNOWLEDGED',
  'RESOLVED',
  'SNOOZED',
  'SUPPRESSED',
]);

const StatusMutationSchema = z
  .object({
    status: IncidentStatusSchema,
    expectedStatus: IncidentStatusSchema.optional(),
  })
  .strict();

const LEGACY_UNAUTHORIZED_MESSAGE =
  'You do not have permission to perform this action. Please contact an administrator if you believe this is an error.';
const LEGACY_INVALID_INPUT_MESSAGE = 'Please check your input and try again.';

export type BrowserIncidentLifecycleSource = Extract<IncidentLifecycleSource, 'WEB' | 'MOBILE'>;

type RouteProps = { params: Promise<{ id: string }> };

/**
 * Canonical cookie-authenticated HTTP boundary for human incident status changes.
 *
 * Business semantics intentionally live in operator-lifecycle/idempotent-commands.
 * This module owns transport concerns only: authentication, validation,
 * idempotency context, canonical error envelopes and request logging.
 */
export function createIncidentStatusRoute(
  source: BrowserIncidentLifecycleSource,
  requestContextName: string
) {
  return withRequestContext(async (req: NextRequest, props: RouteProps) => {
    const { id } = await props.params;

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

      const parsed = StatusMutationSchema.safeParse(body);
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
      if (idempotencyKey && idempotencyKey.length > 200) {
        return jsonError(
          new AppError({
            code: 'VALIDATION_FAILED',
            userMessage: LEGACY_INVALID_INPUT_MESSAGE,
            fields: [
              {
                field: 'Idempotency-Key',
                code: 'too_long',
                message: 'Idempotency-Key must be 200 characters or fewer.',
              },
            ],
          })
        );
      }

      const result = await updateIncidentStatus(
        id,
        parsed.data.status,
        parsed.data.expectedStatus,
        source,
        idempotencyKey
          ? {
              key: idempotencyKey,
              // Preserve the existing principal identity so retries created before
              // this transport consolidation remain replay-compatible.
              principalId: session.user.email.toLowerCase(),
            }
          : undefined
      );

      return jsonOk(
        {
          success: true,
          status: parsed.data.status,
          ...(result.replayed ? { duplicate: true } : {}),
        },
        200,
        result.replayed ? { 'Idempotency-Replayed': 'true' } : undefined
      );
    } catch (error) {
      logger.error('api.incident.status.update_failed', {
        component: 'incident-status-http',
        source,
        error,
        incidentId: id,
        errorCode: isAppError(error) ? error.code : 'INTERNAL_ERROR',
      });

      if (isAppError(error)) return jsonError(error);
      return jsonError(new AppError({ code: 'INTERNAL_ERROR' }));
    }
  }, requestContextName);
}
