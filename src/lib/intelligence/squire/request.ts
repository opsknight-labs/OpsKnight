import 'server-only';
import { jsonError } from '@/lib/api-response';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import { squireRequestSchema, type SquireRequest } from './contract';

const MAX_BODY_BYTES = 65_536;

export const denySquire = (status: number, error: string) =>
  jsonError(error, status, undefined, { 'Cache-Control': 'no-store' });

/**
 * The checks every endpoint that starts a Squire turn makes, in this order: same-origin browsers only, a JSON
 * body, a signed-in person (never an API key), at most 64 KiB read (a body that lies about its length is cut
 * off as it streams in), and a valid request. Returns the person and the request, or the response to send.
 *
 * Cross-site use is refused three ways: browsers send `Sec-Fetch-Site`, which page script cannot forge and
 * proxies do not change (comparing `Origin` with the server's own idea of its origin breaks behind a reverse
 * proxy); a JSON body needs a CORS preflight that is never granted; and the session cookie is SameSite=Lax.
 */
export async function readSquireRequest(
  request: Request
): Promise<{ actor: AuthorizationActor; data: SquireRequest } | Response> {
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none')
    return denySquire(403, 'Cross-site requests are not allowed');
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return denySquire(415, 'Send application/json');
  }

  let actor: AuthorizationActor;
  try {
    actor = await getCurrentAuthorizationActor();
  } catch {
    return denySquire(401, 'Sign in to use the assistant');
  }

  if (actor.apiKey) return denySquire(403, 'The assistant is only available in the app');
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > MAX_BODY_BYTES) return denySquire(413, 'Request is too large');
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  if (reader) {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > MAX_BODY_BYTES) {
          await reader.cancel();
          return denySquire(413, 'Request is too large');
        }
        chunks.push(value);
      }
    } catch {
      return denySquire(400, 'Could not read request');
    } finally {
      reader.releaseLock();
    }
  }
  let body: unknown;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return denySquire(400, 'Invalid JSON');
  }
  const parsed = squireRequestSchema.safeParse(body);
  if (!parsed.success) return denySquire(400, 'Invalid request');
  return { actor, data: parsed.data };
}
