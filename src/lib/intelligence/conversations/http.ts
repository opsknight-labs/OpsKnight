import 'server-only';
import { jsonError } from '@/lib/api-response';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import { getHistoryStatus } from './store';

const NO_STORE = { 'Cache-Control': 'no-store' };

export const denyConversation = (status: number, error: string) => jsonError(error, status, undefined, NO_STORE);

/**
 * Shared guard for the saved-conversation endpoints: same-origin browsers only, a signed-in person
 * (never an API key), and history switched on. Returns the actor or a response to send instead.
 */
export async function conversationActor(request: Request): Promise<AuthorizationActor | Response> {
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') return denyConversation(403, 'Cross-site requests are not allowed');
  let actor: AuthorizationActor;
  try {
    actor = await getCurrentAuthorizationActor();
  } catch {
    return denyConversation(401, 'Sign in to see your conversations');
  }
  if (actor.apiKey) return denyConversation(403, 'Saved conversations are only available in the app');
  if (!(await getHistoryStatus()).enabled) return denyConversation(404, 'Saved conversations are turned off');
  return actor;
}

export { NO_STORE };
