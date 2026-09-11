import { NextRequest, NextResponse } from 'next/server';
import { getBaseUrl } from '@/lib/env-validation';
import { logger } from '@/lib/logger';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import { authorizeStatusApiRequest } from '@/lib/status-api-auth';
import { createHash } from 'node:crypto';
import { getStatusPagePublicUrl } from '@/lib/status-page-url';
import { getStatusPageSnapshotByRoute } from '@/lib/status-pages/snapshot';
import { projectPublicStatusEvents } from '@/lib/status-pages/event-projection';
import {
  PRIVATE_STATUS_CACHE_CONTROL,
  PUBLIC_STATUS_CACHE_CONTROL,
} from '@/lib/status-pages/cache-policy';

export function opaqueRssIncidentGuid(
  baseUrl: string,
  statusPageId: string,
  incidentId: string
): string {
  const opaqueId = createHash('sha256').update(`${statusPageId}\u0000${incidentId}`).digest('hex');
  return `${baseUrl}/status#update-${opaqueId}`;
}

/**
 * RSS Feed for Status Page
 * GET /api/status/rss
 */
export async function GET(req: NextRequest) {
  return getStatusRssResponse(req);
}

export async function getStatusRssResponse(req: NextRequest, slug?: string) {
  try {
    const projected = await getStatusPageSnapshotByRoute(slug || 'default');
    if (!projected.pageId) {
      return new NextResponse('Status page not found', { status: 404 });
    }
    const statusPage = projected.snapshot?.page;

    if (!statusPage) {
      return new NextResponse('Published status information is temporarily unavailable', {
        status: 503,
        headers: {
          'Retry-After': '30',
          'Cache-Control': 'public, max-age=5, stale-if-error=30',
        },
      });
    }

    const authResult = await authorizeStatusApiRequest(req, statusPage.id, {
      requireToken: statusPage.statusApiRequireToken === true,
      rateLimitEnabled: statusPage.statusApiRateLimitEnabled === true,
      rateLimitMax: statusPage.statusApiRateLimitMax ?? 120,
      rateLimitWindowSec: statusPage.statusApiRateLimitWindowSec ?? 60,
    });
    if (!authResult.allowed) {
      if (authResult.status === 429) {
        return new NextResponse('Rate limit exceeded', {
          status: 429,
          headers: authResult.retryAfter
            ? { 'Retry-After': String(authResult.retryAfter) }
            : undefined,
        });
      }
      return new NextResponse('Authentication required', { status: authResult.status || 401 });
    }

    // Check if authentication is required
    if (statusPage.requireAuth) {
      const session = await getServerSession(await getAuthOptions());
      if (!session) {
        return new NextResponse('Authentication required', { status: 401 });
      }
    }

    if (projected.snapshot) {
      const snapshot = projected.snapshot;
      const pageUrl = getStatusPagePublicUrl(statusPage, getBaseUrl());
      const events = projectPublicStatusEvents(snapshot);
      const items = events
        .map(event => {
          const title = event.status ? `${event.title} - ${event.status}` : event.title;
          const createdAt = event.publishedAt;
          const guid = opaqueRssIncidentGuid(pageUrl, statusPage.id, event.id);
          return `<item><title>${escapeXml(title)}</title><link>${guid}</link><guid isPermaLink="false">${guid}</guid>${createdAt ? `<pubDate>${new Date(createdAt).toUTCString()}</pubDate>` : ''}<description>${escapeXml(event.body ?? event.title)}</description></item>`;
        })
        .join('');
      return new NextResponse(
        `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${escapeXml(statusPage.name)} - Status Updates</title><link>${pageUrl}</link><description>Current status and incidents</description>${items}</channel></rss>`,
        {
          headers: {
            'Content-Type': 'application/rss+xml; charset=utf-8',
            'Cache-Control':
              statusPage.requireAuth || statusPage.statusApiRequireToken
                ? PRIVATE_STATUS_CACHE_CONTROL
                : PUBLIC_STATUS_CACHE_CONTROL,
            ...(projected.stale ? { Warning: '110 - "Response is stale"' } : {}),
          },
        }
      );
    }

    return new NextResponse('Published status information is temporarily unavailable', {
      status: 503,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Retry-After': '30',
        'Cache-Control': 'public, max-age=5, stale-if-error=30',
      },
    });

    // Retained temporarily for compatibility while snapshot-only serving settles.
    // This guard also keeps the legacy fallback type-safe although it is unreachable.
    if (!statusPage) return new NextResponse('Status page not found', { status: 404 });
  } catch (error: unknown) {
    logger.error('api.status.rss_error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return new NextResponse('Failed to generate RSS feed', { status: 500 });
  }
}

function escapeXml(unsafe: string | null): string {
  if (!unsafe) return '';
  return unsafe
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
