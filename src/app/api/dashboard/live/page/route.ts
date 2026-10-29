import { z } from 'zod/v3';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError, isAppError } from '@/lib/errors';
import {
  LIVE_PAGE_MAX,
  LIVE_PAGEABLE_VIEWS,
  decodeLiveCursor,
  getLiveIncidentPage,
} from '@/lib/dashboard/live-incidents';
import {
  LIVE_ASSIGNMENT_OPTIONS,
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
    view: z.enum(LIVE_PAGEABLE_VIEWS).default('active'),
    service: id.optional(),
    team: id.optional(),
    status: z.enum(LIVE_STATUS_OPTIONS).default('all'),
    urgency: z.enum(LIVE_URGENCY_OPTIONS).default('all'),
    assignment: z.enum(LIVE_ASSIGNMENT_OPTIONS).default('all'),
    q: z.string().trim().max(LIVE_SEARCH_MAX_LENGTH).default(''),
    cursor: z.string().max(300).optional(),
    limit: z.coerce.number().int().min(1).max(LIVE_PAGE_MAX).optional(),
  })
  .strict();

const invalid = (message: string) =>
  jsonError(new AppError({ code: 'INCIDENT_INVALID_ARGUMENT', userMessage: message }));

/**
 * Keyset-paginated read of active incidents beyond the dashboard's bounded working set. The
 * viewer's authorization scope is derived from the session on every request; a cursor is only a
 * position inside that scope.
 */
export async function GET(request: Request) {
  let actor: Awaited<ReturnType<typeof getCurrentAuthorizationActor>>;
  try {
    actor = await getCurrentAuthorizationActor();
  } catch (error) {
    if (isAppError(error)) return jsonError(error);
    logger.error('dashboard.live.page.auth_failed', { error });
    return jsonError('Live dashboard temporarily unavailable', 503);
  }

  const params = new URL(request.url).searchParams;
  const keys = [...new Set(params.keys())];
  if (keys.some(key => params.getAll(key).length > 1)) return invalid('Duplicate parameter');
  const parsed = querySchema.safeParse(Object.fromEntries(keys.map(k => [k, params.get(k) ?? ''])));
  if (!parsed.success) return invalid('Invalid live dashboard page query');
  const input = parsed.data;
  if (input.cursor && !decodeLiveCursor(input.cursor)) return invalid('Invalid cursor');

  try {
    const page = await getLiveIncidentPage(
      actor,
      {
        scope: input.scope,
        sort: LIVE_SORTS[0],
        view: input.view,
        serviceId: input.service ?? null,
        teamId: input.team ?? null,
        status: input.status,
        urgency: input.urgency,
        assignment: input.assignment,
        search: input.q,
      },
      { cursor: input.cursor, limit: input.limit }
    );
    return jsonOk(page, 200, { 'Cache-Control': 'private, no-store', Vary: 'Cookie' }, {});
  } catch (error) {
    if (isAppError(error)) return jsonError(error);
    logger.error('dashboard.live.page.failed', { error });
    return jsonError('Live dashboard temporarily unavailable', 503);
  }
}
