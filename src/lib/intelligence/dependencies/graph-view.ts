import 'server-only';
import type { BusinessServiceTier } from '@prisma/client';
import prisma from '@/lib/prisma';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import { incidentReadWhere, serviceReadWhere } from '@/lib/authorization-filters';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { businessServiceReadWhere } from '@/lib/business-services/commands';
import {
  getBusinessServiceHealth,
  type BsStatus,
  type ImpactReason,
} from '@/lib/business-services/contract';
import { activeIncidentStatuses } from '@/lib/incident-status';
import { findServicesInMaintenance } from '@/lib/service-maintenance/windows';
import { type GraphFocus } from '@/lib/service-graph/focus';
import { publicStatusForIncidentUrgency } from '@/lib/status-pages/status-presentation';
import { MAX_DEPENDENCIES } from './service';

export interface GraphNode {
  id: string;
  name: string;
  teamId: string | null;
  teamName: string | null;
  openIncidents: number;
  highestOpenUrgency: 'HIGH' | 'MEDIUM' | 'LOW' | null;
  /** Live status: worst open incident (by urgency), else maintenance, else operational. */
  status: BsStatus;
}

export interface GraphEdge {
  id: string;
  upstreamServiceId: string;
  downstreamServiceId: string;
  origin: 'DECLARED' | 'OBSERVED';
  status: 'ACTIVE' | 'SUGGESTED';
  confidence: number;
}

export interface BusinessServiceGraphNode {
  id: string;
  name: string;
  teamId: string | null;
  teamName: string | null;
  criticality: BusinessServiceTier | null;
  status: BsStatus;
  reasons: ImpactReason[];
  openIncidents: number;
  memberCount: number;
}

/** A technical service that belongs to a business service. */
export interface BusinessServiceMemberEdge {
  businessServiceId: string;
  serviceId: string;
  critical: boolean;
}

/** `childId` supports (is depended on by) `parentId`. */
export interface BusinessServiceSupportEdge {
  parentId: string;
  childId: string;
}

export interface ServiceGraphView {
  nodes: GraphNode[];
  edges: GraphEdge[];
  truncated: boolean;
  businessServices: BusinessServiceGraphNode[];
  memberEdges: BusinessServiceMemberEdge[];
  supportEdges: BusinessServiceSupportEdge[];
  focus: GraphFocus | null;
}

export interface ServiceGraphOptions {
  /** Only the focus and what lies within `hops` dependency steps of it. */
  focus?: GraphFocus | null;
  /** 1–3, default 2. */
  hops?: number;
  /**
   * `intelligence` (default) needs INTELLIGENCE_READ, as the topology API always has. `service` is
   * the service-graph page and API v2: anyone who may read services, with suggested edges only for
   * those who may read suggestions.
   */
  access?: 'intelligence' | 'service';
}

const MAX_NODES = 2000;
const MAX_FOCUS_NODES = 500;
const MAX_BUSINESS_SERVICES = 500;
const MAX_MEMBER_EDGES = 5000;
const urgencyRank = (urgency: 'HIGH' | 'MEDIUM' | 'LOW') =>
  urgency === 'HIGH' ? 2 : urgency === 'MEDIUM' ? 1 : 0;

const edgeSelect = {
  id: true,
  upstreamServiceId: true,
  downstreamServiceId: true,
  origin: true,
  status: true,
  confidence: true,
} as const;

/**
 * The service graph with a live incident overlay, restricted to the services, business services
 * and incidents the actor may read. Edges touching anything hidden from them are dropped (and never
 * walked in focus mode), so the graph never reveals a dependency on something they cannot see.
 */
export async function getServiceGraphForActor(
  actor: AuthorizationActor,
  client: typeof prisma = prisma,
  options: ServiceGraphOptions = {}
): Promise<ServiceGraphView | null> {
  const access = options.access ?? 'intelligence';
  if (access === 'intelligence' && !hasCapability(actor.role, CAPABILITIES.INTELLIGENCE_READ))
    return null;
  let services: ReturnType<typeof serviceReadWhere>;
  let incidents: ReturnType<typeof incidentReadWhere>;
  let businessServices: ReturnType<typeof businessServiceReadWhere>;
  try {
    services = serviceReadWhere(actor);
    businessServices = businessServiceReadWhere(actor);
  } catch {
    return null;
  }
  try {
    incidents = incidentReadWhere(actor);
  } catch {
    if (access === 'intelligence') return null;
    // Stakeholders read no incidents, only how many are open on services they can see.
    incidents = {};
  }
  const edgeStatuses: Array<'ACTIVE' | 'SUGGESTED'> =
    access === 'intelligence' ||
    hasCapability(actor.role, CAPABILITIES.INTELLIGENCE_SUGGESTIONS_READ)
      ? ['ACTIVE', 'SUGGESTED']
      : ['ACTIVE'];
  const focus = options.focus ?? null;
  const hops = Math.min(Math.max(Math.trunc(options.hops ?? 2), 1), 3);

  let rows: Array<{
    id: string;
    name: string;
    teamId: string | null;
    team: { name: string } | null;
  }>;
  let edges: Array<Omit<GraphEdge, 'status'> & { status: string }>;
  let truncated: boolean;
  const focusBusinessServiceIds = new Set<string>();
  if (focus) {
    // Walk outwards from the focus one hop at a time, reading only edges that touch the frontier
    // and whose both ends the actor can read, so a large org never hides the focus's neighbours.
    const seeds = await focusSeeds(
      client,
      focus,
      services,
      businessServices,
      focusBusinessServiceIds
    );
    const reach = new Set(seeds);
    let frontier = [...reach];
    truncated = false;
    for (let depth = 0; depth < hops && frontier.length && reach.size <= MAX_FOCUS_NODES; depth++) {
      const found = await client.serviceDependency.findMany({
        where: {
          status: { in: edgeStatuses },
          upstream: services,
          downstream: services,
          OR: [{ upstreamServiceId: { in: frontier } }, { downstreamServiceId: { in: frontier } }],
        },
        take: MAX_DEPENDENCIES + 1,
        select: { upstreamServiceId: true, downstreamServiceId: true },
      });
      if (found.length > MAX_DEPENDENCIES) truncated = true;
      const next: string[] = [];
      for (const edge of found.slice(0, MAX_DEPENDENCIES))
        for (const id of [edge.upstreamServiceId, edge.downstreamServiceId])
          if (!reach.has(id)) {
            reach.add(id);
            next.push(id);
          }
      frontier = next;
    }
    if (reach.size > MAX_FOCUS_NODES) truncated = true;
    rows = await client.service.findMany({
      where: { AND: [{ id: { in: [...reach].slice(0, MAX_FOCUS_NODES) } }, services] },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, teamId: true, team: { select: { name: true } } },
    });
    const ids = rows.map(row => row.id);
    edges = await client.serviceDependency.findMany({
      where: {
        status: { in: edgeStatuses },
        upstreamServiceId: { in: ids },
        downstreamServiceId: { in: ids },
      },
      take: MAX_DEPENDENCIES,
      select: edgeSelect,
    });
  } else {
    const all = await client.service.findMany({
      where: services,
      orderBy: { name: 'asc' },
      take: MAX_NODES + 1,
      select: { id: true, name: true, teamId: true, team: { select: { name: true } } },
    });
    truncated = all.length > MAX_NODES;
    rows = all.slice(0, MAX_NODES);
    const ids = rows.map(row => row.id);
    edges = await client.serviceDependency.findMany({
      where: {
        status: { in: edgeStatuses },
        upstreamServiceId: { in: ids },
        downstreamServiceId: { in: ids },
      },
      take: MAX_DEPENDENCIES,
      select: edgeSelect,
    });
  }

  const ids = rows.map(row => row.id);
  const [open, maintenance, members] = await Promise.all([
    client.incident.groupBy({
      by: ['serviceId', 'urgency'],
      where: {
        AND: [{ serviceId: { in: ids }, status: { in: activeIncidentStatuses() } }, incidents],
      },
      _count: { _all: true },
    }),
    findServicesInMaintenance(ids),
    client.businessServiceMember.findMany({
      where: { serviceId: { in: ids }, businessService: businessServices },
      take: MAX_MEMBER_EDGES,
      select: { businessServiceId: true, serviceId: true, critical: true },
    }),
  ]);
  const overlay = new Map<string, { count: number; urgency: GraphNode['highestOpenUrgency'] }>();
  for (const row of open) {
    const entry = overlay.get(row.serviceId) ?? { count: 0, urgency: null };
    entry.count += row._count._all;
    const urgency = row.urgency as 'HIGH' | 'MEDIUM' | 'LOW';
    if (!entry.urgency || urgencyRank(urgency) > urgencyRank(entry.urgency))
      entry.urgency = urgency;
    overlay.set(row.serviceId, entry);
  }

  const business = await loadBusinessLayer(
    client,
    actor,
    businessServices,
    focus ? new Set([...focusBusinessServiceIds, ...members.map(m => m.businessServiceId)]) : null
  );
  const visibleBusiness = new Set(business.nodes.map(node => node.id));

  return {
    nodes: rows.map(row => {
      const entry = overlay.get(row.id);
      return {
        id: row.id,
        name: row.name,
        teamId: row.teamId,
        teamName: row.team?.name ?? null,
        openIncidents: entry?.count ?? 0,
        highestOpenUrgency: entry?.urgency ?? null,
        status: entry?.urgency
          ? publicStatusForIncidentUrgency(entry.urgency)
          : maintenance.has(row.id)
            ? 'MAINTENANCE'
            : 'OPERATIONAL',
      };
    }),
    edges: edges.map(edge => ({
      ...edge,
      status: edge.status === 'ACTIVE' ? 'ACTIVE' : 'SUGGESTED',
    })),
    truncated: truncated || business.truncated,
    businessServices: business.nodes,
    memberEdges: members.filter(member => visibleBusiness.has(member.businessServiceId)),
    supportEdges: business.supports,
    focus,
  };
}

/** Seed services for a focus; a business-service focus also records the BS and its neighbours. */
async function focusSeeds(
  client: typeof prisma,
  focus: GraphFocus,
  services: ReturnType<typeof serviceReadWhere>,
  businessServices: ReturnType<typeof businessServiceReadWhere>,
  focusBusinessServiceIds: Set<string>
): Promise<string[]> {
  if (focus.kind === 'svc') {
    const service = await client.service.findFirst({
      where: { AND: [{ id: focus.id }, services] },
      select: { id: true },
    });
    return service ? [service.id] : [];
  }
  const bs = await client.businessService.findFirst({
    where: { AND: [{ id: focus.id }, businessServices] },
    select: {
      id: true,
      members: { where: { service: services }, select: { serviceId: true } },
      supportedBy: { select: { childId: true } },
      supports: { select: { parentId: true } },
    },
  });
  if (!bs) return [];
  focusBusinessServiceIds.add(bs.id);
  for (const { childId } of bs.supportedBy) focusBusinessServiceIds.add(childId);
  for (const { parentId } of bs.supports) focusBusinessServiceIds.add(parentId);
  return bs.members.map(member => member.serviceId);
}

/** Business-service nodes with live health, and the support edges between them. */
async function loadBusinessLayer(
  client: typeof prisma,
  actor: AuthorizationActor,
  businessServices: ReturnType<typeof businessServiceReadWhere>,
  onlyIds: Set<string> | null
): Promise<{
  nodes: BusinessServiceGraphNode[];
  supports: BusinessServiceSupportEdge[];
  truncated: boolean;
}> {
  if (onlyIds && onlyIds.size === 0) return { nodes: [], supports: [], truncated: false };
  const found = await client.businessService.findMany({
    where: onlyIds ? { AND: [{ id: { in: [...onlyIds] } }, businessServices] } : businessServices,
    orderBy: { name: 'asc' },
    take: MAX_BUSINESS_SERVICES + 1,
    select: {
      id: true,
      name: true,
      criticality: true,
      ownerTeamId: true,
      ownerTeam: { select: { name: true } },
      _count: { select: { members: true } },
    },
  });
  const rows = found.slice(0, MAX_BUSINESS_SERVICES);
  const ids = rows.map(row => row.id);
  const [health, supports] = await Promise.all([
    ids.length ? getBusinessServiceHealth(ids, actor) : new Map(),
    ids.length
      ? client.businessServiceSupport.findMany({
          where: { parentId: { in: ids }, childId: { in: ids } },
          select: { parentId: true, childId: true },
        })
      : [],
  ]);
  return {
    nodes: rows.map(row => {
      const live = health.get(row.id);
      return {
        id: row.id,
        name: row.name,
        teamId: row.ownerTeamId,
        teamName: row.ownerTeam?.name ?? null,
        criticality: row.criticality,
        status: live?.status ?? 'UNKNOWN',
        reasons: live?.reasons ?? [],
        openIncidents: live?.openIncidentCount ?? 0,
        memberCount: row._count.members,
      };
    }),
    supports,
    truncated: found.length > MAX_BUSINESS_SERVICES,
  };
}
