import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { getAuthOptions } from '@/lib/auth';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError, isAppError } from '@/lib/errors';
import { getRealtimeChangeGenerationAtLeast } from '@/lib/realtime-change-control-plane';
import { getLiveDashboardSnapshot } from '@/lib/dashboard/live-incidents';
import {
  LIVE_ASSIGNMENT_OPTIONS,
  LIVE_INCIDENT_MAX_LIMIT,
  LIVE_INCIDENT_VIEWS,
  LIVE_SEARCH_MAX_LENGTH,
  LIVE_STATUS_OPTIONS,
  LIVE_URGENCY_OPTIONS,
} from '@/lib/dashboard/live-incidents-shared';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const id = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const querySchema = z
  .object({
    view: z.enum(LIVE_INCIDENT_VIEWS).default('active'),
    service: id.optional(),
    team: id.optional(),
    status: z.enum(LIVE_STATUS_OPTIONS).default('all'),
    urgency: z.enum(LIVE_URGENCY_OPTIONS).default('all'),
    assignment: z.enum(LIVE_ASSIGNMENT_OPTIONS).default('all'),
    q: z.string().trim().max(LIVE_SEARCH_MAX_LENGTH).default(''),
    limit: z.coerce.number().int().min(1).max(LIVE_INCIDENT_MAX_LIMIT).optional(),
    after: z
      .string()
      .regex(/^\d{1,20}$/)
      .optional(),
  })
  .strict();

function invalid(message: string) {
  return jsonError(new AppError({ code: 'INCIDENT_INVALID_ARGUMENT', userMessage: message }));
}

/**
 * Live dashboard projection: the incident feed for the requested view/facets plus responder
 * rail data, derived from one authorization-scoped active set shared by identical viewers.
 */
export async function GET(request: Request) {
  const session = await getServerSession(await getAuthOptions());
  if (!session) return jsonError(new AppError({ code: 'AUTHENTICATION_REQUIRED' }));

  const params = new URL(request.url).searchParams;
  const raw: Record<string, string> = {};
  for (const key of new Set(params.keys())) {
    if (params.getAll(key).length > 1) return invalid(`Duplicate ${key}`);
    raw[key] = params.get(key) ?? '';
  }
  const parsed = querySchema.safeParse(raw);
  if (!parsed.success) return invalid('Invalid live dashboard query');
  const input = parsed.data;

  try {
    const actor = await getCurrentAuthorizationActor();
    const generation = await getRealtimeChangeGenerationAtLeast(input.after ?? null).catch(
      () => null
    );
    const snapshot = await getLiveDashboardSnapshot(
      actor,
      {
        view: input.view,
        serviceId: input.service ?? null,
        teamId: input.team ?? null,
        status: input.status,
        urgency: input.urgency,
        assignment: input.assignment,
        search: input.q,
      },
      { limit: input.limit, generation }
    );
    return jsonOk(snapshot, 200, { 'Cache-Control': 'private, no-store', Vary: 'Cookie' });
  } catch (error) {
    if (isAppError(error)) return jsonError(error);
    logger.error('dashboard.live.failed', { error });
    return jsonError('Live dashboard temporarily unavailable', 503);
  }
}
