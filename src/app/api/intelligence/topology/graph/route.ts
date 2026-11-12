import type { NextRequest } from 'next/server';
import { jsonError, jsonOk } from '@/lib/api-response';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import { checkRateLimit } from '@/lib/rate-limit';
import { getServiceGraphForActor } from '@/lib/intelligence/dependencies/graph-view';

export const dynamic = 'force-dynamic';
const HEADERS = { 'Cache-Control': 'no-store' };
const deny = (status: number, message: string) => jsonError(message, status, undefined, HEADERS);

/** GET /api/intelligence/topology/graph — the service dependency graph with open-incident overlay, as the caller may see it. */
export async function GET(request: NextRequest) {
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none')
    return deny(403, 'Cross-site requests are not allowed');
  let actor;
  try {
    actor = await getCurrentAuthorizationActor();
  } catch {
    return deny(401, 'Sign in to view the service graph');
  }
  if (actor.status !== 'ACTIVE') return deny(403, 'Account is not active');
  if (!(await checkRateLimit(`intelligence:topology-graph:${actor.id}`, 30, 60_000)).allowed)
    return deny(429, 'Too many requests. Try again in a minute.');
  try {
    const graph = await getServiceGraphForActor(actor);
    return graph ? jsonOk({ graph }, 200, HEADERS) : deny(403, 'Graph access denied');
  } catch {
    return deny(503, 'The service graph is temporarily unavailable');
  }
}
