import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getBaseUrl } from '@/lib/env-validation';
import { logger } from '@/lib/logger';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import { authorizeStatusApiRequest } from '@/lib/status-api-auth';
import { publicStatusVisibility } from '@/lib/status-page-public-data';
import { createHash } from 'node:crypto';
import { getReportingWindowForDays } from '@/lib/retention-policy';
import { getStatusPagePublicUrl } from '@/lib/status-page-url';

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
    const statusPage = await prisma.statusPage.findFirst({
      where: slug ? { enabled: true, slug } : { enabled: true, isDefault: true },
      include: {
        services: {
          include: {
            service: true,
          },
          where: { showOnPage: true },
        },
      },
    });

    if (!statusPage) {
      return new NextResponse('Status page not found', { status: 404 });
    }

    const authResult = await authorizeStatusApiRequest(req, statusPage.id, {
      requireToken: statusPage.statusApiRequireToken,
      rateLimitEnabled: statusPage.statusApiRateLimitEnabled,
      rateLimitMax: statusPage.statusApiRateLimitMax,
      rateLimitWindowSec: statusPage.statusApiRateLimitWindowSec,
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

    const visibility = publicStatusVisibility(statusPage);

    const serviceIds = statusPage.services.map(sp => sp.serviceId);

    const baseUrl = getBaseUrl();
    const pageUrl = getStatusPagePublicUrl(statusPage, baseUrl);
    const rssUrl = slug
      ? `${baseUrl}/api/status/${encodeURIComponent(slug)}/rss`
      : `${baseUrl}/api/status/rss`;

    const window = await getReportingWindowForDays(30, 'incident');
    const incidents =
      visibility.showIncidents && serviceIds.length > 0
        ? await prisma.incident.findMany({
            where: {
              serviceId: { in: serviceIds },
              visibility: 'PUBLIC',
              createdAt: { gte: window.start, lte: window.end },
            },
            orderBy: { createdAt: 'desc' },
            take: 50,
            select: {
              id: true,
              title: true,
              description: true,
              status: true,
              createdAt: true,
              service: { select: { name: true } },
            },
          })
        : [];

    const description = window.isClipped
      ? 'Current status and incidents (limited by configured retention)'
      : 'Current status and incidents';

    // Generate RSS XML
    const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
    <channel>
        <title>${escapeXml(statusPage.name)} - Status Updates</title>
        <link>${pageUrl}</link>
        <description>${escapeXml(description)}</description>
        <language>en</language>
        <atom:link href="${rssUrl}" rel="self" type="application/rss+xml" />
        ${incidents
          .map(incident => {
            const status =
              incident.status === 'RESOLVED'
                ? 'Resolved'
                : incident.status === 'ACKNOWLEDGED'
                  ? 'Acknowledged'
                  : 'Investigating';
            const pubDate = visibility.showIncidentTimestamp
              ? new Date(incident.createdAt).toUTCString()
              : null;
            const guid = visibility.showIncidentId
              ? `${pageUrl}#incident-${incident.id}`
              : opaqueRssIncidentGuid(pageUrl, statusPage.id, incident.id);
            const serviceName = visibility.showAffectedService
              ? incident.service?.name || 'General'
              : null;
            const incidentTitle = visibility.showIncidentTitle ? incident.title : 'Status update';
            const incidentDetails = visibility.showIncidentDescription
              ? incident.description || incidentTitle
              : incidentTitle;

            return `
        <item>
            <title>${escapeXml(incidentTitle)} - ${status}</title>
            <link>${guid}</link>
            <guid isPermaLink="false">${guid}</guid>
            ${pubDate ? `<pubDate>${pubDate}</pubDate>` : ''}
            <description>${escapeXml(incidentDetails)}${serviceName ? ` - Service: ${escapeXml(serviceName)}` : ''}</description>
            ${serviceName ? `<category>${escapeXml(serviceName)}</category>` : ''}
        </item>`;
          })
          .join('')}
    </channel>
</rss>`;

    return new NextResponse(rss, {
      headers: {
        'Content-Type': 'application/rss+xml; charset=utf-8',
        'Cache-Control':
          statusPage.requireAuth || statusPage.statusApiRequireToken
            ? 'private, no-store'
            : 'public, s-maxage=30, stale-while-revalidate=300',
      },
    });
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
