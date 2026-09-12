import 'server-only';
import type { NextRequest } from 'next/server';
import { authenticateApiKey, hasApiScopes } from '@/lib/api-auth';
import { resolveApiKeyActor } from '@/lib/authorization-actors';

export async function authorizeResponsePolicyApi(request: NextRequest, mode: 'read' | 'write') {
  const key = await authenticateApiKey(request);
  if (!key) return { ok: false as const, status: 401 as const, message: 'Authentication required' };
  if (!hasApiScopes(key.scopes, [`response-policy:${mode}`]))
    return { ok: false as const, status: 403 as const, message: 'Response-policy scope required' };
  const actor = await resolveApiKeyActor(key);
  if (!actor || actor.status !== 'ACTIVE' || actor.role !== 'ADMIN')
    return { ok: false as const, status: 403 as const, message: 'Admin access required' };
  return { ok: true as const, key, actor };
}
