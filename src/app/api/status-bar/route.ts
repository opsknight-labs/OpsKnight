import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import { jsonError, jsonOk } from '@/lib/api-response';
import { logger } from '@/lib/logger';
import { checkRateLimit } from '@/lib/rate-limit';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import { getMyIncidentCounts, getWorkspaceHealth } from '@/lib/status-bar-data';

const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 60_000;

/** Status bar refresh: the user's work counts and active workspace signals, all read-scoped. */
export async function GET() {
  try {
    const session = await getServerSession(await getAuthOptions());
    if (!session?.user?.email) return jsonError('Unauthorized', 401);

    const rate = await checkRateLimit(
      `api:status-bar:${session.user.email}`,
      RATE_LIMIT_MAX,
      RATE_LIMIT_WINDOW_MS
    );
    if (!rate.allowed) {
      const retryAfter = Math.ceil((rate.resetAt - Date.now()) / 1000);
      return jsonError('Rate limit exceeded', 429, { retryAfter });
    }

    const actor = await getCurrentAuthorizationActor();
    const [my, health] = await Promise.all([getMyIncidentCounts(actor), getWorkspaceHealth(actor)]);
    return jsonOk({ my, health }, 200, {
      'Cache-Control': 'private, max-age=10, stale-while-revalidate=30',
    });
  } catch (error) {
    logger.error('api.status_bar.error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonError('Failed to fetch status bar data', 500);
  }
}
