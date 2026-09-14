import { revalidatePath } from 'next/cache';
import { NextRequest } from 'next/server';
import { z } from 'zod';

import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError } from '@/lib/errors';
import { logger, withRequestContext } from '@/lib/logger';
import { checkRateLimit } from '@/lib/rate-limit';
import { IncidentCreateSchema } from '@/lib/validation';
import { assertCanCreateIncidentForService, getCurrentUser } from '@/lib/rbac';
import { executeIdempotentIncidentCreation } from '@/lib/incidents/idempotent-commands';

const BrowserIncidentCreateSchema = IncidentCreateSchema.extend({
  assigneeId: z.string().trim().max(100).optional().nullable(),
  visibility: z.enum(['PUBLIC', 'PRIVATE']).optional(),
}).strict();

const IDEMPOTENCY_HEADER = 'idempotency-key';
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 30;

async function createBrowserIncident(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    const rate = await checkRateLimit(
      `browser:${user.id}:incident-create`,
      RATE_LIMIT_MAX,
      RATE_LIMIT_WINDOW_MS
    );
    if (!rate.allowed) {
      return jsonError(
        new AppError({
          code: 'RATE_LIMIT_EXCEEDED',
          userMessage: 'Too many incident creation attempts. Please retry shortly.',
          details: { retryAfter: Math.ceil((rate.resetAt - Date.now()) / 1000) },
        }),
        undefined,
        undefined,
        { 'Retry-After': String(Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1000))) }
      );
    }

    const idempotencyKey = request.headers.get(IDEMPOTENCY_HEADER)?.trim();
    if (!idempotencyKey) {
      throw new AppError({
        code: 'IDEMPOTENCY_KEY_INVALID',
        userMessage: 'A stable request identifier is required to create an incident safely.',
      });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new AppError({ code: 'INVALID_JSON', userMessage: 'Invalid incident request.' });
    }
    const parsed = BrowserIncidentCreateSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError({
        code: 'VALIDATION_FAILED',
        userMessage: 'Please check the incident details and try again.',
        fields: parsed.error.issues.map(issue => ({
          field: issue.path.join('.') || 'incident',
          code: issue.code,
          message: issue.message,
        })),
      });
    }

    await assertCanCreateIncidentForService(parsed.data.serviceId);
    const execution = await executeIdempotentIncidentCreation(
      {
        title: parsed.data.title,
        description: parsed.data.description ?? null,
        serviceId: parsed.data.serviceId,
        urgency: parsed.data.urgency,
        priority: parsed.data.priority ?? null,
        assigneeId: parsed.data.assigneeId || null,
        visibility: parsed.data.visibility,
        source: 'MOBILE',
        actor: { id: user.id, name: user.name ?? undefined },
      },
      { key: idempotencyKey, principalId: user.id }
    );

    revalidatePath('/');
    revalidatePath('/incidents');
    revalidatePath('/m');
    revalidatePath('/m/incidents');
    revalidatePath(`/incidents/${execution.value.id}`);
    revalidatePath(`/m/incidents/${execution.value.id}`);

    logger.info('browser.incident.created', {
      component: 'incident-create-api',
      userId: user.id,
      incidentId: execution.value.id,
      outcome: execution.value.outcome,
      idempotencyReplayed: execution.replayed,
    });

    return jsonOk(
      {
        id: execution.value.id,
        outcome: execution.value.outcome,
        replayed: execution.replayed,
      },
      execution.replayed ? 200 : 201,
      execution.replayed ? { 'Idempotency-Replayed': 'true' } : undefined
    );
  } catch (error) {
    logger.warn('browser.incident.create_failed', {
      component: 'incident-create-api',
      error,
    });
    return jsonError(error);
  }
}

export const POST = withRequestContext(createBrowserIncident, 'api.incidents.browser-create');
