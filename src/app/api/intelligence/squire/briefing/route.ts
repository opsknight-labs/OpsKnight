import type { NextRequest } from 'next/server';
import { z } from 'zod/v4';
import { jsonError, jsonOk } from '@/lib/api-response';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import { checkRateLimit } from '@/lib/rate-limit';
import { getPinnedBriefingForActor } from '@/lib/intelligence/squire/briefing-view';

export const dynamic = 'force-dynamic';

const HEADERS = { 'Cache-Control': 'no-store' };
const idSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/);
const deny = (status: number, message: string) => jsonError(message, status, undefined, HEADERS);

/**
 * GET /api/intelligence/squire/briefing?incidentId=<id>: the briefing the assistant panel pins above a
 * conversation about that incident.
 *
 * Session only. `briefing` is null whenever there is nothing to pin (assistant off, incident not
 * readable, intelligence off or in shadow for the service, no findings), so the response does not
 * reveal whether an incident exists.
 */
export async function GET(request: NextRequest) {
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none')
    return deny(403, 'Cross-site requests are not allowed');
  let actor;
  try {
    actor = await getCurrentAuthorizationActor();
  } catch {
    return deny(401, 'Sign in to use the assistant');
  }
  if (actor.apiKey || actor.status !== 'ACTIVE')
    return deny(403, 'The assistant is only available in the app');
  if (!hasCapability(actor.role, CAPABILITIES.INTELLIGENCE_SUGGESTIONS_READ))
    return deny(403, 'You do not have access to the assistant');
  const id = idSchema.safeParse(request.nextUrl.searchParams.get('incidentId'));
  if (!id.success) return deny(400, 'Invalid request');
  if (!(await checkRateLimit(`intelligence:squire-briefing:${actor.id}`, 60, 60_000)).allowed)
    return deny(429, 'Too many requests. Try again in a minute.');
  try {
    return jsonOk({ briefing: await getPinnedBriefingForActor(actor, id.data) }, 200, HEADERS);
  } catch {
    return deny(503, 'The briefing is temporarily unavailable');
  }
}
