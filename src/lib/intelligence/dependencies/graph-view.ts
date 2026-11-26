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
import { derivedDependencyStatuses, describeEvidence } from './graph';
import { loadEdgeTraffic, type EdgeTraffic } from './insights/edge-stats';
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
  /** Why the status is what it is: a DEPENDENCY reason when it comes from an upstream's incident. */
  reasons?: ImpactReason[];
}

export interface GraphEdge {
  id: string;
  upstreamServiceId: string;
  downstreamServiceId: string;
  origin: 'DECLARED' | 'OBSERVED';
  status: 'ACTIVE' | 'SUGGESTED';
  confidence: number;
  /** HARD (default): the dependent fails with it. SOFT: it degrades gracefully. */
  dependencyType?: 'HARD' | 'SOFT';
  note?: string | null;
  criticality?: 'LOW' | 'MEDIUM' | 'HIGH' | null;
  /** One-line reading of the stored evidence. */
  evidence?: string | null;
  /** Latest measured traffic on this edge, when an integration pushes it. */
  traffic?: EdgeTraffic | null;
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
  /**
   * Loaded services that have dependencies the view did not load (the hop limit or the node cap), so
   * the client can offer "Load neighbours" instead of silently hiding the rest.
   */
  boundaryIds?: string[];
  /** Set for `?incident=`: the incident the graph is scoped to. */
  incident?: GraphIncidentScope | null;
}

export interface GraphIncidentScope {
  id: string;
  title: string;
  serviceId: string;
}

export interface GraphStatusEntry {
  status: BsStatus;
  openIncidents: number;
  reasons: ImpactReason[];
}

export interface GraphStatuses {
  services: Record<string, GraphStatusEntry>;
  businessServices: Record<string, GraphStatusEntry>;
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
const MAX_BOUNDARY = 500;
const urgencyRank = (urgency: 'HIGH' | 'MEDIUM' | 'LOW') =>
  urgency === 'HIGH' ? 2 : urgency === 'MEDIUM' ? 1 : 0;

const edgeSelect = {
  id: true,
  upstreamServiceId: true,
  downstreamServiceId: true,
  origin: true,
  status: true,
  confidence: true,
  dependencyType: true,
  note: true,
  criticality: true,
  evidence: true,
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
  let edges: Array<Omit<GraphEdge, 'status' | 'evidence'> & { status: string; evidence: unknown }>;
  let truncated: boolean;
  let boundary: string[] = [];
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
        orderBy: { id: 'asc' },
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
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: { id: true, name: true, teamId: true, team: { select: { name: true } } },
    });
    const ids = rows.map(row => row.id);
    edges = await client.serviceDependency.findMany({
      where: {
        status: { in: edgeStatuses },
        upstreamServiceId: { in: ids },
        downstreamServiceId: { in: ids },
      },
      orderBy: { id: 'asc' },
      take: MAX_DEPENDENCIES + 1,
      select: edgeSelect,
    });
    // Only frontier nodes with a readable neighbour that was not loaded are boundary nodes.
    if (frontier.length) {
      const loaded = new Set(ids);
      const pending = frontier.filter(id => loaded.has(id));
      const beyond = await client.serviceDependency.findMany({
        where: {
          status: { in: edgeStatuses },
          upstream: services,
          downstream: services,
          OR: [
            { upstreamServiceId: { in: pending }, downstreamServiceId: { notIn: ids } },
            { downstreamServiceId: { in: pending }, upstreamServiceId: { notIn: ids } },
          ],
        },
        orderBy: { id: 'asc' },
        take: MAX_BOUNDARY,
        select: { upstreamServiceId: true, downstreamServiceId: true },
      });
      const open = new Set(pending);
      boundary = beyond.flatMap(edge =>
        [edge.upstreamServiceId, edge.downstreamServiceId].filter(id => open.has(id))
      );
    }
  } else {
    const all = await client.service.findMany({
      where: services,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: MAX_NODES + 1,
      select: { id: true, name: true, teamId: true, team: { select: { name: true } } },
    });
    truncated = all.length > MAX_NODES;
    rows = all.slice(0, MAX_NODES);
    const ids = rows.map(row => row.id);
    if (truncated) {
      const loaded = new Set(ids);
      const crossing = await client.serviceDependency.findMany({
        where: {
          status: { in: edgeStatuses },
          upstream: services,
          downstream: services,
          OR: [
            { upstreamServiceId: { in: ids }, downstreamServiceId: { notIn: ids } },
            { downstreamServiceId: { in: ids }, upstreamServiceId: { notIn: ids } },
          ],
        },
        orderBy: { id: 'asc' },
        take: MAX_BOUNDARY,
        select: { upstreamServiceId: true, downstreamServiceId: true },
      });
      boundary = crossing.flatMap(edge =>
        [edge.upstreamServiceId, edge.downstreamServiceId].filter(id => loaded.has(id))
      );
    }
    edges = await client.serviceDependency.findMany({
      where: {
        status: { in: edgeStatuses },
        upstreamServiceId: { in: ids },
        downstreamServiceId: { in: ids },
      },
      orderBy: { id: 'asc' },
      take: MAX_DEPENDENCIES + 1,
      select: edgeSelect,
    });
  }
  if (edges.length > MAX_DEPENDENCIES) {
    edges = edges.slice(0, MAX_DEPENDENCIES);
    truncated = true;
  }

  const ids = rows.map(row => row.id);
  const [open, maintenance, memberRows] = await Promise.all([
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
      orderBy: [{ businessServiceId: 'asc' }, { serviceId: 'asc' }],
      take: MAX_MEMBER_EDGES + 1,
      select: { businessServiceId: true, serviceId: true, critical: true },
    }),
  ]);
  const membersTruncated = memberRows.length > MAX_MEMBER_EDGES;
  const members = memberRows.slice(0, MAX_MEMBER_EDGES);
  const live = liveServiceStatuses(open, maintenance, edges);
  const idSet = new Set(ids);

  const business = await loadBusinessLayer(
    client,
    actor,
    businessServices,
    focus ? new Set([...focusBusinessServiceIds, ...members.map(m => m.businessServiceId)]) : null
  );
  const visibleBusiness = new Set(business.nodes.map(node => node.id));

  const traffic = await loadEdgeTraffic(edges);
  return {
    nodes: rows.map(row => {
      const entry = live.get(row.id);
      return {
        id: row.id,
        name: row.name,
        teamId: row.teamId,
        teamName: row.team?.name ?? null,
        openIncidents: entry?.count ?? 0,
        highestOpenUrgency: entry?.urgency ?? null,
        status: entry?.status ?? 'OPERATIONAL',
        reasons: entry?.reasons ?? [],
      };
    }),
    edges: edges.map(({ evidence, ...edge }) => ({
      ...edge,
      status: edge.status === 'ACTIVE' ? 'ACTIVE' : 'SUGGESTED',
      evidence: describeEvidence(evidence),
      traffic: traffic.get(`${edge.upstreamServiceId}>${edge.downstreamServiceId}`) ?? null,
    })),
    boundaryIds: [...new Set(boundary)].filter(id => idSet.has(id)),
    truncated: truncated || membersTruncated || business.truncated,
    businessServices: business.nodes,
    memberEdges: members.filter(member => visibleBusiness.has(member.businessServiceId)),
    supportEdges: business.supports,
    focus,
  };
}

interface LiveStatus {
  count: number;
  urgency: GraphNode['highestOpenUrgency'];
  status: BsStatus;
  reasons: ImpactReason[];
}

/**
 * Live status per service: its own worst open incident, else maintenance; a service with none of its
 * own shows a derived DEGRADED/PARTIAL_OUTAGE (with a DEPENDENCY reason) when something it depends
 * on, within three hops over the loaded active edges, has an open incident.
 */
function liveServiceStatuses(
  open: Array<{ serviceId: string; urgency: string; _count: { _all: number } }>,
  maintenance: { keys(): IterableIterator<string> },
  edges: ReadonlyArray<{
    upstreamServiceId: string;
    downstreamServiceId: string;
    status: string;
  }>
): Map<string, LiveStatus> {
  const live = new Map<string, LiveStatus>();
  for (const row of open) {
    const entry = live.get(row.serviceId) ?? {
      count: 0,
      urgency: null,
      status: 'OPERATIONAL' as BsStatus,
      reasons: [],
    };
    entry.count += row._count._all;
    const urgency = row.urgency as 'HIGH' | 'MEDIUM' | 'LOW';
    if (!entry.urgency || urgencyRank(urgency) > urgencyRank(entry.urgency))
      entry.urgency = urgency;
    live.set(row.serviceId, entry);
  }
  for (const entry of live.values())
    if (entry.urgency) entry.status = publicStatusForIncidentUrgency(entry.urgency);
  const sources = new Map<string, { incidentId: string; urgency: 'HIGH' | 'MEDIUM' | 'LOW' }>();
  for (const [serviceId, entry] of live)
    if (entry.urgency)
      sources.set(serviceId, {
        incidentId: '', // the graph never links a derived reason to a specific incident
        urgency: entry.urgency,
      });
  for (const id of maintenance.keys()) {
    const entry = live.get(id);
    if (!entry) live.set(id, { count: 0, urgency: null, status: 'MAINTENANCE', reasons: [] });
  }
  const derived = derivedDependencyStatuses(
    edges.filter(edge => edge.status === 'ACTIVE'),
    sources
  );
  for (const [serviceId, found] of derived) {
    if (live.has(serviceId)) continue;
    live.set(serviceId, {
      count: 0,
      urgency: null,
      status: found.status,
      reasons: [
        {
          kind: 'DEPENDENCY',
          status: found.status,
          incidentId: found.incidentId,
          serviceId: found.serviceId,
          viaServiceId: serviceId,
          depth: found.depth,
        },
      ],
    });
  }
  return live;
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
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
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

const MAX_STATUS_IDS = 2500;

/**
 * Live statuses only, for the node ids a client already holds: no layout inputs, no edges sent back.
 * Ids the actor cannot read are silently absent from the result, so polling never confirms they exist.
 */
export async function getGraphStatusesForActor(
  actor: AuthorizationActor,
  requested: { services: readonly string[]; businessServices: readonly string[] },
  client: typeof prisma = prisma
): Promise<GraphStatuses | null> {
  let services: ReturnType<typeof serviceReadWhere>;
  let businessServices: ReturnType<typeof businessServiceReadWhere>;
  let incidents: ReturnType<typeof incidentReadWhere>;
  try {
    services = serviceReadWhere(actor);
    businessServices = businessServiceReadWhere(actor);
  } catch {
    return null;
  }
  try {
    incidents = incidentReadWhere(actor);
  } catch {
    incidents = {};
  }
  const serviceIds = [...new Set(requested.services)].slice(0, MAX_STATUS_IDS);
  const businessIds = [...new Set(requested.businessServices)].slice(0, MAX_BUSINESS_SERVICES);
  const readable = serviceIds.length
    ? (
        await client.service.findMany({
          where: { AND: [{ id: { in: serviceIds } }, services] },
          select: { id: true },
        })
      ).map(row => row.id)
    : [];
  const [open, maintenance, edges, readableBusiness] = await Promise.all([
    readable.length
      ? client.incident.groupBy({
          by: ['serviceId', 'urgency'],
          where: {
            AND: [
              { serviceId: { in: readable }, status: { in: activeIncidentStatuses() } },
              incidents,
            ],
          },
          _count: { _all: true },
        })
      : [],
    readable.length ? findServicesInMaintenance(readable) : new Set<string>(),
    readable.length
      ? client.serviceDependency.findMany({
          where: {
            status: 'ACTIVE',
            upstreamServiceId: { in: readable },
            downstreamServiceId: { in: readable },
          },
          orderBy: { id: 'asc' },
          take: MAX_DEPENDENCIES,
          select: { upstreamServiceId: true, downstreamServiceId: true, status: true },
        })
      : [],
    businessIds.length
      ? client.businessService.findMany({
          where: { AND: [{ id: { in: businessIds } }, businessServices] },
          select: { id: true },
        })
      : [],
  ]);
  const live = liveServiceStatuses(open, maintenance, edges);
  const health = readableBusiness.length
    ? await getBusinessServiceHealth(
        readableBusiness.map(row => row.id),
        actor
      )
    : new Map();
  const entry = (status: BsStatus, openIncidents: number, reasons: ImpactReason[]) => ({
    status,
    openIncidents,
    reasons,
  });
  return {
    services: Object.fromEntries(
      readable.map(id => {
        const found = live.get(id);
        return [id, entry(found?.status ?? 'OPERATIONAL', found?.count ?? 0, found?.reasons ?? [])];
      })
    ),
    businessServices: Object.fromEntries(
      readableBusiness.map(({ id }) => {
        const found = health.get(id);
        return [
          id,
          entry(found?.status ?? 'UNKNOWN', found?.openIncidentCount ?? 0, found?.reasons ?? []),
        ];
      })
    ),
  };
}

/** The incident a `?incident=` graph is scoped to, only if the actor may read it and its service. */
export async function getIncidentScopeForActor(
  actor: AuthorizationActor,
  incidentId: string,
  client: typeof prisma = prisma
): Promise<GraphIncidentScope | null> {
  let incidents: ReturnType<typeof incidentReadWhere>;
  let services: ReturnType<typeof serviceReadWhere>;
  try {
    incidents = incidentReadWhere(actor);
    services = serviceReadWhere(actor);
  } catch {
    return null;
  }
  return client.incident.findFirst({
    where: { AND: [{ id: incidentId }, incidents, { service: services }] },
    select: { id: true, title: true, serviceId: true },
  });
}
