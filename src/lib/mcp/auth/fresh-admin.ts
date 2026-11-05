import 'server-only';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import { isAuthenticationFresh } from '@/lib/auth-control/actor';

/**
 * Whether the acting administrator signed in recently enough to widen MCP access: the same rule
 * as approving a destructive change on the review page. A stale or hijacked browser session can
 * still narrow access, never widen it.
 */
export async function requireFreshMcpAdmin(actorId: string) {
  try {
    const session = await getServerSession(await getAuthOptions());
    return session?.user?.id === actorId && isAuthenticationFresh(session.authenticatedAt, 'admin');
  } catch {
    // No readable session is never a fresh one.
    return false;
  }
}
