import 'server-only';
import prisma from '@/lib/prisma';
import { incidentReadWhere } from '@/lib/authorization-filters';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { upstreamDistances } from '../dependencies/graph';
import { loadActiveEdges } from '../dependencies/service';
import { getIntelligenceSettings } from '../settings/service';
import {
  draftStatusUpdate,
  STATUS_DRAFT_MAX_DEPTH,
  type StatusDraft,
  type StatusDraftComponent,
} from './status-draft';

/** Drafts offered in the editor: the newest open incidents that touch the page. */
const MAX_DRAFTS = 3;
const MAX_COMPONENTS = 200;
/** Services an incident may sit on and still matter to the page (its components and what they depend on). */
const MAX_SOURCE_SERVICES = 500;

/**
 * Status-update drafts for the open incidents that affect a status page, newest first. Three bounded reads
 * (page components, active dependency edges, open incidents on an indexed service list); no model call.
 * The caller authorizes editing the status page; incidents are still narrowed to what `actor` may read, and
 * private incidents are never offered for a public page.
 */
export async function loadStatusDrafts(
  actor: AuthorizationActor,
  statusPageId: string,
  /** Just this incident (the incident page's "Post status update"), even when it is not among the newest. */
  incidentId?: string
): Promise<StatusDraft[]> {
  if (actor.status !== 'ACTIVE') return [];
  const settings = await getIntelligenceSettings();
  if (!settings.enabled || !settings.opsHelpersEnabled) return [];

  const [shown, edges] = await Promise.all([
    prisma.statusPageService.findMany({
      where: { statusPageId, showOnPage: true },
      orderBy: [{ order: 'asc' }, { id: 'asc' }],
      take: MAX_COMPONENTS,
      select: { serviceId: true, displayName: true, service: { select: { name: true } } },
    }),
    loadActiveEdges(),
  ]);
  if (shown.length === 0) return [];
  const components: StatusDraftComponent[] = shown.map(row => ({
    serviceId: row.serviceId,
    name: row.displayName?.trim() || row.service.name,
  }));

  const sources = new Set(components.map(component => component.serviceId));
  for (const component of components) {
    if (sources.size >= MAX_SOURCE_SERVICES) break;
    for (const upstream of upstreamDistances(
      edges,
      component.serviceId,
      STATUS_DRAFT_MAX_DEPTH
    ).keys())
      sources.add(upstream);
  }

  const incidents = await prisma.incident.findMany({
    where: {
      AND: [
        {
          ...(incidentId ? { id: incidentId } : {}),
          serviceId: { in: [...sources].slice(0, MAX_SOURCE_SERVICES) },
          status: { in: ['OPEN', 'ACKNOWLEDGED'] },
          visibility: 'PUBLIC',
        },
        incidentReadWhere(actor),
      ],
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: MAX_DRAFTS,
    select: { id: true, title: true, status: true, urgency: true, serviceId: true },
  });
  return incidents
    .map(incident => draftStatusUpdate(incident, components, edges))
    .filter((draft): draft is StatusDraft => draft !== null);
}

/** Minutes between status updates while an incident is open, when the page sets none. */
export const STATUS_UPDATE_CADENCE_DEFAULT = 30;

export type IncidentStatusUpdate = {
  statusPageId: string;
  statusPageName: string;
  cadenceMinutes: number;
  /** The last announcement linked to this incident; null before the first one. */
  lastUpdateAt: Date | null;
  nextDueAt: Date | null;
};

/**
 * The status page an incident should be posted on, and when the next update is due. The page the incident
 * last posted on wins; otherwise the first page that shows the incident's own service. Null for private or
 * closed incidents (the ones `loadStatusDrafts` never drafts), while the switch is off, and when no page
 * shows the service. At most two indexed reads on the incident page; the caller checks the publish permission.
 */
export async function loadIncidentStatusUpdate(incident: {
  id: string;
  serviceId: string;
  status: string;
  visibility: string;
}): Promise<IncidentStatusUpdate | null> {
  if (incident.visibility !== 'PUBLIC' || !['OPEN', 'ACKNOWLEDGED'].includes(incident.status))
    return null;
  const settings = await getIntelligenceSettings();
  if (!settings.enabled || !settings.opsHelpersEnabled) return null;

  const pageSelect = { select: { id: true, name: true, updateCadenceMinutes: true } } as const;
  const last = await prisma.statusPageAnnouncement.findFirst({
    where: { incidentId: incident.id },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { createdAt: true, statusPage: pageSelect },
  });
  const page =
    last?.statusPage ??
    (
      await prisma.statusPageService.findFirst({
        where: { serviceId: incident.serviceId, showOnPage: true },
        orderBy: [{ statusPageId: 'asc' }],
        select: { statusPage: pageSelect },
      })
    )?.statusPage;
  if (!page) return null;

  const cadenceMinutes = page.updateCadenceMinutes ?? STATUS_UPDATE_CADENCE_DEFAULT;
  return {
    statusPageId: page.id,
    statusPageName: page.name,
    cadenceMinutes,
    lastUpdateAt: last?.createdAt ?? null,
    nextDueAt: last ? new Date(last.createdAt.getTime() + cadenceMinutes * 60_000) : null,
  };
}
