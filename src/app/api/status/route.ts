import { jsonError, jsonOk } from '@/lib/api-response';
import { legacyPublicStatus } from '@/lib/status-pages/status-presentation';
import { logger } from '@/lib/logger';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import { NextRequest, NextResponse } from 'next/server';
import { authorizeStatusApiRequest } from '@/lib/status-api-auth';
import { createHash } from 'node:crypto';
import { observeOperationalHistogram } from '@/lib/metrics/operational/registry';
import { getStatusPageSnapshotByRoute } from '@/lib/status-pages/snapshot';
import {
  PRIVATE_STATUS_CACHE_CONTROL,
  PUBLIC_STATUS_CACHE_CONTROL,
} from '@/lib/status-pages/cache-policy';
import { getAppUrl } from '@/lib/app-config';
import {
  extractStatusSessionToken,
  hasStatusPageAccess,
  isRequestToAppHost,
} from '@/lib/status-pages/status-auth';

/**
 * Status Page API
 * Returns JSON data for status page integrations
 *
 * GET /api/status
 */
export async function GET(req: NextRequest) {
  return getStatusResponse(req);
}

export async function getStatusResponse(req: NextRequest, slug?: string) {
  const projectionStartedAt = performance.now();
  try {
    const projected = await getStatusPageSnapshotByRoute(slug || 'default');
    if (!projected.pageId) {
      return jsonError('Status page not found or disabled', 404);
    }
    const statusPage = projected.snapshot?.page;
    if (!statusPage) {
      return jsonError('Published status information is temporarily unavailable', 503, undefined, {
        'Retry-After': '30',
        'Cache-Control': 'public, max-age=5, stale-if-error=30',
      });
    }

    const needsApiControl =
      statusPage.statusApiRequireToken === true ||
      statusPage.statusApiRateLimitEnabled === true ||
      req.headers.has('authorization');
    const authResult = needsApiControl
      ? await authorizeStatusApiRequest(req, statusPage.id, {
          requireToken: statusPage.statusApiRequireToken === true,
          rateLimitEnabled: statusPage.statusApiRateLimitEnabled === true,
          rateLimitMax: statusPage.statusApiRateLimitMax ?? 120,
          rateLimitWindowSec: statusPage.statusApiRateLimitWindowSec ?? 60,
        })
      : { allowed: true };
    if (!authResult.allowed) {
      if (authResult.status === 429) {
        return NextResponse.json(
          { error: authResult.error || 'Rate limit exceeded' },
          {
            status: 429,
            headers: authResult.retryAfter
              ? { 'Retry-After': String(authResult.retryAfter) }
              : undefined,
          }
        );
      }
      return jsonError(authResult.error || 'Unauthorized', authResult.status || 401);
    }

    // Check if authentication is required
    if (statusPage.requireAuth) {
      const cookieHeader = req.headers.get('cookie');
      const statusToken = extractStatusSessionToken(cookieHeader);
      const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
      const appUrl = await getAppUrl();
      const isAppHost = isRequestToAppHost(host, appUrl);

      let isAuthorized = false;
      if (statusToken) {
        isAuthorized = await hasStatusPageAccess({
          pageId: statusPage.id,
          statusSessionCookie: statusToken,
          isAppHost,
        });
      }
      if (!isAuthorized && isAppHost) {
        const session = await getServerSession(await getAuthOptions());
        isAuthorized = !!session;
      }
      if (!isAuthorized) {
        return jsonError('Authentication required', 401);
      }
    }

    if (projected.snapshot) {
      const snapshot = projected.snapshot;
      const responseData = {
        status: snapshot.status,
        // The pre-existing four-value vocabulary, kept alongside the canonical one so consumers
        // that switch on it do not silently fall through when a page reports a partial outage or
        // an unverifiable service.
        statusLegacy: legacyPublicStatus(snapshot.status),
        overall: snapshot.overall,
        services: snapshot.services.map(service => ({
          ...service,
          statusLegacy: legacyPublicStatus(service.status),
        })),
        incidents: snapshot.incidents,
        metrics: {
          uptime: snapshot.services.map(service => ({
            serviceId: service.id,
            days30: service.uptime?.days30 ?? null,
            days90: service.uptime?.days90 ?? null,
          })),
        },
        retention: { historyDays: snapshot.historyDays },
        thresholds: snapshot.thresholds ?? null,
        updatedAt: snapshot.generatedAt,
        projection: { revision: snapshot.revision, stale: projected.stale },
      };
      const headers: Record<string, string> = {
        'Cache-Control':
          statusPage.requireAuth || statusPage.statusApiRequireToken
            ? PRIVATE_STATUS_CACHE_CONTROL
            : PUBLIC_STATUS_CACHE_CONTROL,
        ...(projected.stale ? { Warning: '110 - "Response is stale"' } : {}),
      };
      const etag = `"${createHash('sha256').update(JSON.stringify(responseData)).digest('base64url')}"`;
      if (req.headers.get('if-none-match') === etag) {
        return new NextResponse(null, { status: 304, headers: { ...headers, ETag: etag } });
      }
      return jsonOk(responseData, 200, { ...headers, ETag: etag });
    }
  } catch (error: unknown) {
    logger.error('api.status.error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonError('Failed to fetch status', 500);
  } finally {
    observeOperationalHistogram(
      'opsknight_status_page_projection_duration_seconds',
      (performance.now() - projectionStartedAt) / 1000,
      { surface: 'json' }
    );
  }
}
