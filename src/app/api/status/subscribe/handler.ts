import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { jsonError } from '@/lib/api-response';
import { logger } from '@/lib/logger';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { resolveStatusPage } from '@/lib/status-page-resolver';
import { subscribeStatusPageRequest } from '@/lib/status-pages/subscriptions';

/**
 * Subscribe to Status Page Updates (Public API)
 * POST /api/status/subscribe
 */
export async function subscribeToStatusPage(req: NextRequest, slug?: string) {
  try {
    const ip = getClientIp(req.headers);
    const rate = await checkRateLimit(`api:status:subscribe:ip:${ip}`, 10, 60_000);
    if (!rate.allowed) {
      const retryAfter = Math.ceil((rate.resetAt - Date.now()) / 1000);
      return jsonError('Rate limit exceeded', 429, { retryAfter });
    }

    const body = await req.json();
    const email = typeof body?.email === 'string' ? body.email.trim() : '';
    const requestedPageId = typeof body?.statusPageId === 'string' ? body.statusPageId : '';
    const resolvedPage = slug ? await resolveStatusPage({ slug }) : null;
    const statusPageId = resolvedPage?.id ?? requestedPageId;

    if (!statusPageId || !email || !email.includes('@')) {
      return jsonError('Valid statusPageId and email are required', 400);
    }

    // Verify status page exists and is enabled
    const statusPage = await prisma.statusPage.findFirst({
      where: { id: statusPageId, enabled: true },
    });

    if (!statusPage) {
      return jsonError('Status page not found or disabled', 404);
    }

    // Redirect to status page subscribe endpoint
    // This endpoint exists for API compatibility
    return subscribeStatusPageRequest(
      new NextRequest(req.url, {
        method: 'POST',
        // The canonical endpoint also rate-limits by client address. Forward
        // the normalized address so this compatibility route does not collapse
        // every request into one server-side rate-limit bucket.
        headers: req.headers,
        body: JSON.stringify({ statusPageId, email }),
      })
    );
  } catch (error: unknown) {
    logger.error('api.status.subscribe.error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonError('Failed to subscribe', 500);
  }
}
