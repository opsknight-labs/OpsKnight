import { z } from 'zod/v4';
import { jsonError, jsonOk } from '@/lib/api-response';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import { checkRateLimit } from '@/lib/rate-limit';
import { readSquireActionOutcome } from '@/lib/intelligence/squire/actions/outcomes';

export const dynamic = 'force-dynamic';
const NO_STORE = { 'Cache-Control': 'no-store' };

/** Read-only, owner-scoped result recovery remains available after the write proposal expires. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none')
    return jsonError('Cross-site requests are not allowed', 403, undefined, NO_STORE);
  let actor;
  try {
    actor = await getCurrentAuthorizationActor();
  } catch {
    return jsonError('Sign in to check the action result', 401, undefined, NO_STORE);
  }
  if (actor.apiKey)
    return jsonError('Action results are only available in the app', 403, undefined, NO_STORE);
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success)
    return jsonError('Action result not found', 404, undefined, NO_STORE);
  if (!(await checkRateLimit(`squire:action-result:${actor.id}`, 60, 60_000)).allowed)
    return jsonError('Too many requests. Try again in a minute.', 429, undefined, NO_STORE);
  const outcome = await readSquireActionOutcome(actor, id);
  return outcome
    ? jsonOk({ outcome }, 200, NO_STORE)
    : jsonError('Action result not found', 404, undefined, NO_STORE);
}
