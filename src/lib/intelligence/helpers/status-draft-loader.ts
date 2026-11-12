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
  statusPageId: string
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
