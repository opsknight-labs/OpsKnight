import prisma from '@/lib/prisma';

export type StatusPageContent = 'incident' | 'postmortem' | 'uptime';

/** Canonical fail-closed publication decision shared by every public surface. */
export async function canPublishIncidentToStatusPage(
  statusPageId: string,
  incidentId: string,
  content: StatusPageContent = 'incident'
): Promise<boolean> {
  const mapping = await prisma.statusPageService.findFirst({
    where: {
      statusPageId,
      showOnPage: true,
      statusPage: {
        enabled: true,
        ...(content === 'incident' ? { showIncidents: true } : {}),
        ...(content === 'postmortem' ? { showPostIncidentReview: true } : {}),
        ...(content === 'uptime' ? { showUptimeHistory: true } : {}),
      },
      service: {
        incidents: { some: { id: incidentId, visibility: 'PUBLIC' } },
      },
    },
    select: { id: true },
  });
  return mapping !== null;
}

export function publicIncidentWhere(statusPageId: string) {
  return {
    visibility: 'PUBLIC' as const,
    service: {
      statusPageServices: {
        some: { statusPageId, showOnPage: true, statusPage: { enabled: true } },
      },
    },
  };
}
