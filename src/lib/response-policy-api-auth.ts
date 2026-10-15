import 'server-only';
import type { NextRequest } from 'next/server';
import { authenticateApiKeyDetailed, hasApiScopes } from '@/lib/api-auth';
import { resolveApiKeyActor } from '@/lib/authorization-actors';

export async function authorizeResponsePolicyApi(request: NextRequest, mode: 'read' | 'write') {
  const auth = await authenticateApiKeyDetailed(request);
  if (auth.status === 'throttled')
    return {
      ok: false as const,
      status: 429 as const,
      message: `Too many authentication attempts. Retry in ${auth.retryAfter} seconds.`,
    };
  if (auth.status !== 'ok')
    return { ok: false as const, status: 401 as const, message: 'Authentication required' };
  const key = auth.key;
  if (!hasApiScopes(key.scopes, [`response-policy:${mode}`]))
    return { ok: false as const, status: 403 as const, message: 'Response-policy scope required' };
  const actor = await resolveApiKeyActor(key);
  if (!actor || actor.status !== 'ACTIVE' || actor.role !== 'ADMIN')
    return { ok: false as const, status: 403 as const, message: 'Admin access required' };
  return { ok: true as const, key, actor };
}
