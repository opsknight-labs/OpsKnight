import 'server-only';
import type { NextRequest } from 'next/server';
import { authenticateApiKey, hasApiScopes } from '@/lib/api-auth';
import { resolveApiKeyActor } from '@/lib/authorization-actors';

export async function authorizeResponsePolicyApi(request: NextRequest, mode: 'read' | 'write') {
  const key = await authenticateApiKey(request);
  if (!key || !hasApiScopes(key.scopes, [`response-policy:${mode}`])) return null;
  const actor = await resolveApiKeyActor(key);
  if (!actor || actor.status !== 'ACTIVE' || actor.role !== 'ADMIN') return null;
  return { key, actor };
}
