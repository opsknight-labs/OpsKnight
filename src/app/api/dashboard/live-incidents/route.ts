import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { getAuthOptions } from '@/lib/auth';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError, isAppError } from '@/lib/errors';
import { getRealtimeChangeGeneration } from '@/lib/realtime-change-control-plane';
import { getLiveIncidentFeed } from '@/lib/dashboard/live-incidents';
import {
  LIVE_INCIDENT_FILTERS,
  LIVE_INCIDENT_MAX_LIMIT,
} from '@/lib/dashboard/live-incidents-shared';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const querySchema = z
  .object({
    filter: z.enum(LIVE_INCIDENT_FILTERS).default('active'),
    limit: z.coerce.number().int().min(1).max(LIVE_INCIDENT_MAX_LIMIT).optional(),
  })
  .strict();

function invalid(message: string) {
  return jsonError(new AppError({ code: 'INCIDENT_INVALID_ARGUMENT', userMessage: message }));
}

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
  if (!parsed.success) return invalid('Invalid live incident filter');

  try {
    const actor = await getCurrentAuthorizationActor();
    // Read the generation before the snapshot so a change committed in between
    // is always followed by a newer generation and therefore another reconcile.
    const generation = await getRealtimeChangeGeneration().catch(() => null);
    const feed = await getLiveIncidentFeed(actor, parsed.data.filter, {
      limit: parsed.data.limit,
      generation,
    });
    return jsonOk(feed, 200, { 'Cache-Control': 'private, no-store', Vary: 'Cookie' });
  } catch (error) {
    if (isAppError(error)) return jsonError(error);
    logger.error('dashboard.live_incidents.failed', { error });
    return jsonError('Live incidents temporarily unavailable', 503);
  }
}
