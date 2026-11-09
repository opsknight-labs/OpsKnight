import 'server-only';
import type { ServiceStatus } from '@prisma/client';
import prisma from '@/lib/prisma';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import { incidentReadWhere, serviceReadWhere } from '@/lib/authorization-filters';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { getSloBurn, type BurnSeverity } from '@/lib/slo/burn';
import { RESPONSE_LIMITS } from '../contract';
import { loadActiveEdges } from '../dependencies/service';
import { downstreamDistances } from '../dependencies/graph';

/**
 * Impact estimate for one incident: which services depend on the affected one (from the active dependency
 * graph), which status-page components show those services and their current status, and how much of the
 * affected service's SLO error budget is burning. Read-only and deterministic; no AI, no network.
 *
 * Scoping: the incident must be readable; downstream services are walked only through services the viewer can
 * read, so the view never reveals a dependency path through a hidden service; status components are listed
 * only for readable services; SLO burn is computed over every incident on the service, so it is shown only to
 * viewers with global metric visibility (the same rule as shared objective history).
 *
 * Bounded: the graph is the capped active-edge set (cached per request), the walk is depth- and node-capped,
 * and every query has a `take`.
 */

export const IMPACT_LIMITS = {
  maxDepth: RESPONSE_LIMITS.maxUpstreamDepth,
  /** Candidates considered from the full graph before visibility filtering. */
  maxCandidates: 200,
  maxDownstreamShown: 25,
  maxComponents: 25,
} as const;

export interface ImpactDownstreamService {
  id: string;
  name: string;
  distance: number;
  status: ServiceStatus;
  openIncidents: number;
}

export interface ImpactStatusComponent {
  statusPageId: string;
  statusPageName: string;
  pageEnabled: boolean;
  componentName: string;
  serviceId: string;
  /** True when the component shows the incident's own service rather than a downstream one. */
  direct: boolean;
  status: ServiceStatus;
}

export interface ImpactObjective {
  name: string;
  targetPercent: number;
  fastBurn: number;
  slowBurn: number;
  severity: BurnSeverity;
  budgetMinutes: number | null;
  /** Share of the objective's whole-window error budget this incident has used so far (0..100+). */
  incidentBudgetPercent: number | null;
}

export type ImpactSlo =
  | { state: 'RESTRICTED' }
  | { state: 'NONE' }
  | { state: 'UNAVAILABLE' }
  | { state: 'AVAILABLE'; severity: BurnSeverity; objectives: ImpactObjective[] };

export interface IncidentImpactView {
  serviceId: string;
  downstream: ImpactDownstreamService[];
  downstreamTruncated: boolean;
  components: ImpactStatusComponent[];
  componentsTruncated: boolean;
  slo: ImpactSlo;
}

/** True when the view has nothing worth a card: no downstream services, no components, no SLO. */
export function isImpactEmpty(view: IncidentImpactView): boolean {
  return (
    view.downstream.length === 0 &&
    view.components.length === 0 &&
    (view.slo.state === 'NONE' || view.slo.state === 'RESTRICTED')
  );
}

export async function getIncidentImpactForActor(
  incidentId: string,
  actor: AuthorizationActor,
  client: typeof prisma = prisma,
  now: Date = new Date()
): Promise<IncidentImpactView | null> {
  if (!hasCapability(actor.role, CAPABILITIES.INTELLIGENCE_SUGGESTIONS_READ)) return null;
  let readable: ReturnType<typeof incidentReadWhere>;
  try {
    readable = incidentReadWhere(actor);
  } catch {
    return null;
  }
  let services: ReturnType<typeof serviceReadWhere> | null;
  try {
    services = serviceReadWhere(actor);
  } catch {
    services = null;
  }
  const incident = await client.incident.findFirst({
    where: { AND: [{ id: incidentId }, readable] },
    select: { id: true, serviceId: true, createdAt: true, resolvedAt: true },
  });
  if (!incident) return null;

  const [graph, slo] = await Promise.all([
    services ? loadVisibleDownstream(client, incident.serviceId, services) : null,
    loadSlo(client, actor, incident, now),
  ]);
  if (!graph) {
    return {
      serviceId: incident.serviceId,
      downstream: [],
      downstreamTruncated: false,
      components: [],
      componentsTruncated: false,
      slo,
    };
  }

  const shownIds = graph.downstream.map(service => service.id);
  const componentServiceIds = [...(graph.ownReadable ? [incident.serviceId] : []), ...shownIds];
  const [open, components] = await Promise.all([
    shownIds.length === 0
      ? []
      : client.incident.groupBy({
          by: ['serviceId'],
          where: {
            AND: [
              { serviceId: { in: shownIds }, status: { in: ['OPEN', 'ACKNOWLEDGED'] } },
              readable,
            ],
          },
          _count: { _all: true },
        }),
    componentServiceIds.length === 0
      ? []
      : client.statusPageService.findMany({
          where: { serviceId: { in: componentServiceIds }, showOnPage: true },
          orderBy: [{ statusPageId: 'asc' }, { order: 'asc' }, { id: 'asc' }],
          take: IMPACT_LIMITS.maxComponents + 1,
          select: {
            displayName: true,
            serviceId: true,
            statusPage: { select: { id: true, name: true, enabled: true } },
            service: { select: { name: true, status: true } },
          },
        }),
  ]);
  const openBy = new Map(open.map(row => [row.serviceId, row._count._all]));
  const ordered = components
    .slice(0, IMPACT_LIMITS.maxComponents)
    .map(row => ({
      statusPageId: row.statusPage.id,
      statusPageName: row.statusPage.name,
      pageEnabled: row.statusPage.enabled,
      componentName: row.displayName?.trim() || row.service.name,
      serviceId: row.serviceId,
      direct: row.serviceId === incident.serviceId,
      status: row.service.status,
    }))
    // The incident's own components first, then by page.
    .sort(
      (a, b) =>
        Number(b.direct) - Number(a.direct) ||
        Number(b.pageEnabled) - Number(a.pageEnabled) ||
        a.statusPageName.localeCompare(b.statusPageName)
    );
  return {
    serviceId: incident.serviceId,
    downstream: graph.downstream.map(service => ({
      ...service,
      openIncidents: openBy.get(service.id) ?? 0,
    })),
    downstreamTruncated: graph.truncated,
    components: ordered,
    componentsTruncated: components.length > IMPACT_LIMITS.maxComponents,
    slo,
  };
}

async function loadVisibleDownstream(
  client: typeof prisma,
  serviceId: string,
  services: ReturnType<typeof serviceReadWhere>
) {
  const edges = await loadActiveEdges(client);
  const candidates = downstreamDistances(
    edges,
    serviceId,
    IMPACT_LIMITS.maxDepth,
    IMPACT_LIMITS.maxCandidates
  );
  const visible = await client.service.findMany({
    where: { AND: [{ id: { in: [serviceId, ...candidates.distances.keys()] } }, services] },
    take: IMPACT_LIMITS.maxCandidates + 1,
    select: { id: true, name: true, status: true },
  });
  const byId = new Map(visible.map(row => [row.id, row]));
  // Re-walk over visible services only: a path through a hidden service must not surface what is behind it.
  const walkable = edges.filter(
    edge =>
      (edge.upstreamServiceId === serviceId || byId.has(edge.upstreamServiceId)) &&
      byId.has(edge.downstreamServiceId)
  );
  const { distances } = downstreamDistances(
    walkable,
    serviceId,
    IMPACT_LIMITS.maxDepth,
    IMPACT_LIMITS.maxCandidates
  );
  const all = [...distances.entries()]
    .flatMap(([id, distance]) => {
      const row = byId.get(id);
      return row ? [{ id, name: row.name, status: row.status, distance }] : [];
    })
    .sort((a, b) => a.distance - b.distance || a.name.localeCompare(b.name));
  return {
    ownReadable: byId.has(serviceId),
    downstream: all.slice(0, IMPACT_LIMITS.maxDownstreamShown),
    // Only the visible count is disclosed; a capped candidate walk is reported as "more", nothing else.
    truncated: all.length > IMPACT_LIMITS.maxDownstreamShown || candidates.truncated,
  };
}

async function loadSlo(
  client: typeof prisma,
  actor: AuthorizationActor,
  incident: { serviceId: string; createdAt: Date; resolvedAt: Date | null },
  now: Date
): Promise<ImpactSlo> {
  if (!hasCapability(actor.role, CAPABILITIES.METRICS_READ_ALL)) return { state: 'RESTRICTED' };
  let burn;
  try {
    burn = await getSloBurn(incident.serviceId, now, client);
  } catch {
    return { state: 'UNAVAILABLE' };
  }
  if (!burn) return { state: 'NONE' };
  const incidentMinutes = Math.max(
    0,
    ((incident.resolvedAt ?? now).getTime() - incident.createdAt.getTime()) / 60_000
  );
  return {
    state: 'AVAILABLE',
    severity: burn.severity,
    objectives: burn.objectives.map(objective => ({
      name: objective.name,
      targetPercent: objective.targetPercent,
      fastBurn: objective.fastBurn,
      slowBurn: objective.slowBurn,
      severity: objective.severity,
      budgetMinutes: objective.budgetMinutes,
      incidentBudgetPercent:
        objective.budgetMinutes === null
          ? null
          : Math.round((incidentMinutes / objective.budgetMinutes) * 1000) / 10,
    })),
  };
}
