import { createHash } from 'node:crypto';
import { z } from 'zod';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError, isAppError } from '@/lib/errors';
import { getRealtimeChangeGenerationAtLeast } from '@/lib/realtime-change-control-plane';
import { getLiveDashboardSnapshot } from '@/lib/dashboard/live-incidents';
import {
  LIVE_ASSIGNMENT_OPTIONS,
  LIVE_INCIDENT_MAX_LIMIT,
  LIVE_INCIDENT_VIEWS,
  LIVE_MAX_PINS,
  LIVE_SCOPES,
  LIVE_SEARCH_MAX_LENGTH,
  LIVE_SORTS,
  LIVE_STATUS_OPTIONS,
  LIVE_URGENCY_OPTIONS,
} from '@/lib/dashboard/live-incidents-shared';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const id = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const querySchema = z
  .object({
    scope: z.enum(LIVE_SCOPES).default('all'),
    sort: z.enum(LIVE_SORTS).default('newest'),
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
    // Personally pinned incidents, comma separated; still resolved inside the authorized set.
    ids: z
      .string()
      .max(LIVE_MAX_PINS * 101)
      .transform(value => value.split(','))
      .pipe(z.array(id).min(1).max(LIVE_MAX_PINS))
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
  const timings: string[] = [];
  const measure = async <T>(name: string, work: () => Promise<T> | T): Promise<T> => {
    const startedAt = performance.now();
    try {
      return await work();
    } finally {
      timings.push(`${name};dur=${(performance.now() - startedAt).toFixed(1)}`);
    }
  };

  // One authentication pass: the actor lookup validates the session and fails closed itself.
  let actor: Awaited<ReturnType<typeof getCurrentAuthorizationActor>>;
  try {
    actor = await measure('auth', () => getCurrentAuthorizationActor());
  } catch (error) {
    if (isAppError(error)) return jsonError(error);
    logger.error('dashboard.live.auth_failed', { error });
    return jsonError('Live dashboard temporarily unavailable', 503);
  }

  const params = new URL(request.url).searchParams;
  const keys = [...new Set(params.keys())];
  const duplicate = keys.find(key => params.getAll(key).length > 1);
  if (duplicate) return invalid(`Duplicate ${duplicate}`);
  const raw = Object.fromEntries(keys.map(key => [key, params.get(key) ?? '']));
  const parsed = querySchema.safeParse(raw);
  if (!parsed.success) return invalid('Invalid live dashboard query');
  const input = parsed.data;

  try {
    const generation = await measure('generation', () =>
      getRealtimeChangeGenerationAtLeast(input.after ?? null).catch(() => null)
    );
    const snapshot = await measure('snapshot', () =>
      getLiveDashboardSnapshot(
        actor,
        {
          scope: input.scope,
          sort: input.sort,
          view: input.view,
          serviceId: input.service ?? null,
          teamId: input.team ?? null,
          status: input.status,
          urgency: input.urgency,
          assignment: input.assignment,
          search: input.q,
        },
        { limit: input.limit, generation, pinIds: input.ids }
      )
    );
    // Validator over the material projection (not the read timestamp or generation), so an
    // unchanged view answers with an empty 304 instead of a full body and a client re-render.
    const { asOf: _asOf, generation: _generation, ...material } = snapshot;
    const etag = await measure(
      'etag',
      () => `W/"${createHash('sha1').update(JSON.stringify(material)).digest('base64url')}"`
    );
    const headers = {
      'Cache-Control': 'private, no-store',
      Vary: 'Cookie',
      ETag: etag,
      'Server-Timing': timings.join(', '),
    };
    if (request.headers.get('if-none-match') === etag) {
      return new Response(null, { status: 304, headers });
    }
    // No legacy top-level aliases: they would serialize the whole projection twice.
    return await measure('encode', () => jsonOk(snapshot, 200, headers, {}));
  } catch (error) {
    if (isAppError(error)) return jsonError(error);
    logger.error('dashboard.live.failed', { error });
    return jsonError('Live dashboard temporarily unavailable', 503);
  }
}
