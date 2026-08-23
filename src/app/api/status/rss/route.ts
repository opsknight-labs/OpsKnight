import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getBaseUrl } from '@/lib/env-validation';
import { logger } from '@/lib/logger';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import { authorizeStatusApiRequest } from '@/lib/status-api-auth';

/**
 * RSS Feed for Status Page
 * GET /api/status/rss
 */
export async function GET(req: NextRequest) {
  try {
    const statusPage = await prisma.statusPage.findFirst({
      where: { enabled: true },
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

    const serviceIds = statusPage.services.map(sp => sp.serviceId);
    const effectiveServiceIds =
      serviceIds.length > 0
        ? serviceIds
        : (await prisma.service.findMany({ select: { id: true } })).map(s => s.id);

    const baseUrl = getBaseUrl();

    const { calculateSLAMetrics } = await import('@/lib/sla-server');
    const metrics = await calculateSLAMetrics({
      serviceId: effectiveServiceIds,
      windowDays: 30, // Last 30 days
      includeIncidents: true,
      incidentLimit: 50,
      visibility: 'PUBLIC',
    });

    const incidents = statusPage.showIncidents ? metrics.recentIncidents || [] : [];

    const description = metrics.isClipped
      ? `Current status and incidents (limited to ${metrics.retentionDays} days retention)`
      : 'Current status and incidents';

    // Generate RSS XML
    const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
    <channel>
        <title>${escapeXml(statusPage.name)} - Status Updates</title>
        <link>${baseUrl}/status</link>
        <description>${escapeXml(description)}</description>
        <language>en</language>
        <atom:link href="${baseUrl}/api/status/rss" rel="self" type="application/rss+xml" />
        ${incidents
          .map(incident => {
            const status =
              incident.status === 'RESOLVED'
                ? 'Resolved'
                : incident.status === 'ACKNOWLEDGED'
                  ? 'Acknowledged'
                  : 'Investigating';
            const pubDate = new Date(incident.createdAt).toUTCString();
            const guid = `${baseUrl}/status#incident-${incident.id}`;
            const serviceName = incident.service?.name || 'General';
            const incidentDetails = statusPage.showIncidentDescriptions
              ? incident.description || incident.title
              : incident.title;

            return `
        <item>
            <title>${escapeXml(incident.title)} - ${status}</title>
            <link>${guid}</link>
            <guid isPermaLink="false">${guid}</guid>
            <pubDate>${pubDate}</pubDate>
            <description>${escapeXml(incidentDetails)} - Service: ${escapeXml(serviceName)}</description>
            <category>${escapeXml(serviceName)}</category>
        </item>`;
          })
          .join('')}
    </channel>
</rss>`;

    return new NextResponse(rss, {
      headers: {
        'Content-Type': 'application/rss+xml; charset=utf-8',
      },
    });
  } catch (error: any) {
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
