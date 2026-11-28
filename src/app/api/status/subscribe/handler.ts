import { NextRequest } from 'next/server';
import { jsonError } from '@/lib/api-response';
import { logger } from '@/lib/logger';
import { resolveStatusPage } from '@/lib/status-page-resolver';
import { subscribeStatusPageRequest } from '@/lib/status-pages/subscriptions';

/**
 * Subscribe to Status Page Updates (Public API)
 * POST /api/status/subscribe
 */
export async function subscribeToStatusPage(req: NextRequest, slug?: string) {
  try {
    const body = await req.json();
    const email = typeof body?.email === 'string' ? body.email.trim() : '';
    const requestedPageId = typeof body?.statusPageId === 'string' ? body.statusPageId : '';
    // A slug in the path names the page. An unknown one is not found; it must not fall back to a
    // page id the caller put in the body.
    const resolvedPage = slug ? await resolveStatusPage({ slug }) : null;
    if (slug && !resolvedPage) return jsonError('Status page not found or disabled', 404);
    const statusPageId = resolvedPage?.id ?? requestedPageId;

    if (!statusPageId || !email || !email.includes('@')) {
      return jsonError('Valid statusPageId and email are required', 400);
    }

    // This endpoint exists for API compatibility. The canonical endpoint checks that the page is
    // enabled and applies the per-address and per-email rate limits, so this one adds neither a
    // second lookup nor a second bucket; it forwards the client address and everything it accepts.
    return subscribeStatusPageRequest(
      new NextRequest(req.url, {
        method: 'POST',
        headers: req.headers,
        body: JSON.stringify({
          statusPageId,
          email,
          ...(body.timezone !== undefined ? { timezone: body.timezone } : {}),
          ...(body.preferences !== undefined ? { preferences: body.preferences } : {}),
        }),
      })
    );
  } catch (error: unknown) {
    logger.error('api.status.subscribe.error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonError('Failed to subscribe', 500);
  }
}
