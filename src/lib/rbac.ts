import 'server-only';

import { getRequestActorContext } from '@/lib/request-actor-context';
import type { AuthorizationActor } from '@/lib/authorization-policy';

export async function getCurrentUser() {
  const context = await getRequestActorContext();
  return context?.user ?? null;
}

export async function getCurrentAuthorizationActor(): Promise<AuthorizationActor | null> {
  const context = await getRequestActorContext();
  return context?.actor ?? null;
}
