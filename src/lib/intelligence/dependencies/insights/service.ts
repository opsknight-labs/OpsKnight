import 'server-only';
import { canReadBusinessServiceFinancials } from '@/lib/business-services/financials';
import type { BusinessServiceTier } from '@prisma/client';
import prisma from '@/lib/prisma';
import { actorHasCapability, type AuthorizationActor } from '@/lib/authorization-policy';
import { CAPABILITIES } from '@/lib/authorization';
import { incidentReadWhere } from '@/lib/authorization-filters';
import { AppError } from '@/lib/errors';
import { computeHealth, type HealthInputs } from '@/lib/business-services/health';
import type { BsStatus } from '@/lib/business-services/contract';
import { activeIncidentStatuses } from '@/lib/incident-status';
import { parseGraphFocus, type GraphFocus } from '@/lib/service-graph/focus';
import { publicStatusForIncidentUrgency } from '@/lib/status-pages/status-presentation';
import { derivedDependencyStatuses, downstreamDistances } from '../graph';
import { getServiceGraphForActor, type ServiceGraphView } from '../graph-view';
import { MAX_DEPENDENCIES } from '../service';
import {
  articulationPoints,
  countByDaysAgo,
  diffEdges,
  diffStatuses,
  fanOut,
  replayEdges,
  type EdgeEvent,
  type ReplayedEdge,
  type StatusChange,
} from './analysis';

const MAX_EVENTS = 50_000;
const MAX_INCIDENTS = 20_000;
const MAX_SIM_SEEDS = 20;
const MAX_SIM_NODES = 500;
const MAX_LIST = 100;
const urgencyRank = { LOW: 0, MEDIUM: 1, HIGH: 2 } as const;

export interface InsightOptions {
  /** `svc:<id>` or `bs:<id>`: only that service and what lies within `hops` steps of it. */
  focus?: string | null;
  hops?: number;
}

function forbidden(): never {
  throw new AppError({ code: 'AUTHORIZATION_DENIED' });
}

/** The graph this actor may see now, optionally around a focus. Everything below derives from it. */
async function visibleGraph(actor: AuthorizationActor, options: InsightOptions = {}) {
  const focus: GraphFocus | null = options.focus ? parseGraphFocus(options.focus) : null;
  if (options.focus && !focus)
    throw new AppError({
      code: 'VALIDATION_FAILED',
      fields: [{ field: 'focus', code: 'custom', message: 'Use svc:<id> or bs:<id>.' }],
    });
  const graph = await getServiceGraphForActor(actor, prisma, {
    access: 'service',
    focus,
    hops: options.hops ?? 2,
  });
  if (!graph) return forbidden();
  if (focus && graph.nodes.length === 0 && graph.businessServices.length === 0)
    throw new AppError({ code: 'RESOURCE_NOT_FOUND' });
  return graph;
}

const canSeeSuggestions = (actor: AuthorizationActor) =>
  actorHasCapability(actor, CAPABILITIES.INTELLIGENCE_SUGGESTIONS_READ);

interface Snapshot {
  at: Date;
  serviceStatus: Map<string, { status: BsStatus; openIncidents: number }>;
  edges: Map<string, ReplayedEdge>;
  businessStatus: Map<string, { status: BsStatus; openIncidents: number }>;
  truncated: boolean;
}

/** Rebuilds edges and statuses at `at` for what `graph` (the actor's current view) contains. */
async function snapshotAt(
  actor: AuthorizationActor,
  graph: ServiceGraphView,
  at: Date
): Promise<Snapshot> {
  const ids = graph.nodes.map(node => node.id);
  const created = await prisma.service.findMany({
    where: { id: { in: ids }, createdAt: { lte: at } },
    select: { id: true },
  });
  const alive = new Set(created.map(row => row.id));
  const aliveIds = [...alive];
  const pair = { upstreamServiceId: { in: aliveIds }, downstreamServiceId: { in: aliveIds } };

  let incidentScope: ReturnType<typeof incidentReadWhere>;
  try {
    incidentScope = incidentReadWhere(actor);
  } catch {
    incidentScope = {}; // Stakeholders: counts and status only, like the live graph.
  }
  const [stored, current, incidents] = await Promise.all([
    prisma.serviceDependencyEvent.findMany({
      where: { ...pair, occurredAt: { lte: at } },
      orderBy: { occurredAt: 'asc' },
      take: MAX_EVENTS,
    }),
    prisma.serviceDependency.findMany({
      where: pair,
      take: MAX_DEPENDENCIES,
      select: {
        upstreamServiceId: true,
        downstreamServiceId: true,
        status: true,
        origin: true,
        createdAt: true,
      },
    }),
    prisma.incident.findMany({
      where: {
        AND: [
          {
            serviceId: { in: aliveIds },
            createdAt: { lte: at },
            OR: [
              { resolvedAt: { gt: at } },
              { resolvedAt: null, status: { in: activeIncidentStatuses() } },
            ],
          },
          incidentScope,
        ],
      },
      take: MAX_INCIDENTS + 1,
      select: { id: true, serviceId: true, urgency: true, priority: true, createdAt: true },
    }),
  ]);
  // Edges written before history existed (or by a writer that does not record it) replay from createdAt.
  const events: EdgeEvent[] = stored.map(row => ({ ...row }));
  const withEvents = new Set(
    stored.map(row => `${row.upstreamServiceId}>${row.downstreamServiceId}`)
  );
  for (const row of current)
    if (!withEvents.has(`${row.upstreamServiceId}>${row.downstreamServiceId}`))
      events.push({
        upstreamServiceId: row.upstreamServiceId,
        downstreamServiceId: row.downstreamServiceId,
        state: row.status,
        origin: row.origin,
        occurredAt: row.createdAt,
      });
  const suggestions = canSeeSuggestions(actor);
  const edges = replayEdges(events, at);
  for (const [key, edge] of edges)
    if (edge.state === 'SUGGESTED' && !suggestions) edges.delete(key);

  const activeEdges = [...edges.values()].filter(edge => edge.state === 'ACTIVE');
  const open = incidents.slice(0, MAX_INCIDENTS);
  const worst = new Map<string, { urgency: keyof typeof urgencyRank; count: number }>();
  for (const incident of open) {
    const entry = worst.get(incident.serviceId) ?? { urgency: incident.urgency, count: 0 };
    entry.count += 1;
    if (urgencyRank[incident.urgency] > urgencyRank[entry.urgency])
      entry.urgency = incident.urgency;
    worst.set(incident.serviceId, entry);
  }
  const derived = derivedDependencyStatuses(
    activeEdges,
    new Map(
      [...worst].map(([id, entry]) => [id, { incidentId: '', urgency: entry.urgency }] as const)
    )
  );
  const serviceStatus: Snapshot['serviceStatus'] = new Map();
  for (const id of aliveIds) {
    const own = worst.get(id);
    serviceStatus.set(id, {
      status: own
        ? publicStatusForIncidentUrgency(own.urgency)
        : (derived.get(id)?.status ?? 'OPERATIONAL'),
      openIncidents: own?.count ?? 0,
    });
  }

  const businessStatus = await businessStatusesAt(graph, alive, activeEdges, open, at);
  return {
    at,
    serviceStatus,
    edges,
    businessStatus,
    truncated: incidents.length > MAX_INCIDENTS || stored.length >= MAX_EVENTS,
  };
}

async function businessStatusesAt(
  graph: ServiceGraphView,
  alive: ReadonlySet<string>,
  activeEdges: readonly ReplayedEdge[],
  incidents: ReadonlyArray<{
    id: string;
    serviceId: string;
    urgency: 'LOW' | 'MEDIUM' | 'HIGH';
    priority: string | null;
    createdAt: Date;
  }>,
  at: Date
): Promise<Snapshot['businessStatus']> {
  const result: Snapshot['businessStatus'] = new Map();
  if (graph.businessServices.length === 0) return result;
  const teamOf = new Map(graph.nodes.map(node => [node.id, node.teamId]));
  const [rows, impacts] = await Promise.all([
    prisma.businessService.findMany({
      where: { id: { in: graph.businessServices.map(bs => bs.id) } },
      select: {
        id: true,
        criticality: true,
        impactMinUrgency: true,
        impactMaxPriority: true,
        ownerTeamId: true,
        quorumPartialPct: true,
        quorumMajorPct: true,
        dependencyHopDepth: true,
      },
    }),
    prisma.incidentBusinessServiceImpact.findMany({
      where: { incidentId: { in: incidents.map(i => i.id) }, startedAt: { lte: at } },
      select: {
        incidentId: true,
        businessServiceId: true,
        source: true,
        excluded: true,
        createdById: true,
        startedAt: true,
        endedAt: true,
      },
    }),
  ]);
  const inputs: HealthInputs = {
    now: at,
    businessServices: rows.map(row => ({
      ...row,
      members: graph.memberEdges
        .filter(member => member.businessServiceId === row.id && alive.has(member.serviceId))
        .map(member => ({
          serviceId: member.serviceId,
          critical: member.critical,
          teamId: teamOf.get(member.serviceId) ?? null,
        })),
    })),
    supports: graph.supportEdges,
    edges: activeEdges,
    incidents,
    // Marks count while open at `at`; exclusions stay in force like the live engine.
    impactRows: impacts.filter(row => row.excluded || !row.endedAt || row.endedAt > at),
    maintenance: new Map(), // Maintenance windows are not replayed.
  };
  for (const [id, health] of computeHealth(inputs))
    result.set(id, { status: health.status, openIncidents: health.openIncidentCount });
  return result;
}

const clampAt = (at: Date) => (at.getTime() > Date.now() ? new Date() : at);

/** The graph as it was at `at`: edges, service statuses and business-service statuses. */
export async function getGraphAt(
  actor: AuthorizationActor,
  at: Date,
  options: InsightOptions = {}
) {
  const graph = await visibleGraph(actor, options);
  const when = clampAt(at);
  const snapshot = await snapshotAt(actor, graph, when);
  const names = new Map(graph.nodes.map(node => [node.id, node]));
  return {
    at: when.toISOString(),
    truncated: graph.truncated || snapshot.truncated,
    services: [...snapshot.serviceStatus].map(([id, state]) => ({
      id,
      name: names.get(id)!.name,
      teamId: names.get(id)!.teamId,
      status: state.status,
      openIncidentCount: state.openIncidents,
    })),
    businessServices: graph.businessServices.map(bs => ({
      id: bs.id,
      name: bs.name,
      criticality: bs.criticality as BusinessServiceTier | null,
      status: snapshot.businessStatus.get(bs.id)?.status ?? 'UNKNOWN',
      openIncidentCount: snapshot.businessStatus.get(bs.id)?.openIncidents ?? 0,
    })),
    dependencies: [...snapshot.edges.values()].map(edge => ({
      upstreamServiceId: edge.upstreamServiceId,
      downstreamServiceId: edge.downstreamServiceId,
      state: edge.state,
      origin: edge.origin,
      since: edge.since.toISOString(),
    })),
    members: graph.memberEdges,
    supports: graph.supportEdges,
    notes: [
      'Membership and business-service nesting are shown as they are now; only dependency edges, incidents and impact marks are replayed.',
      'Services deleted since then are not shown.',
    ],
  };
}

const TIMELINE_DAYS = 90;

/**
 * Incidents opened and dependency changes per day over the time-travel window, for the slider's
 * tick marks. Counts only; incidents follow the viewer's read scope (stakeholders get counts, as
 * on the live graph) and suggestion events count only for viewers who may see suggestions.
 */
export async function graphTimeline(actor: AuthorizationActor, options: InsightOptions = {}) {
  const graph = await visibleGraph(actor, options);
  const now = new Date();
  const since = new Date(now.getTime() - TIMELINE_DAYS * 864e5);
  const ids = graph.nodes.map(node => node.id);
  let incidentScope: ReturnType<typeof incidentReadWhere>;
  try {
    incidentScope = incidentReadWhere(actor);
  } catch {
    incidentScope = {};
  }
  const [incidents, events] = await Promise.all([
    prisma.incident.findMany({
      where: { AND: [{ serviceId: { in: ids }, createdAt: { gte: since } }, incidentScope] },
      select: { createdAt: true },
      take: MAX_INCIDENTS,
    }),
    prisma.serviceDependencyEvent.findMany({
      where: {
        upstreamServiceId: { in: ids },
        downstreamServiceId: { in: ids },
        occurredAt: { gte: since },
        ...(canSeeSuggestions(actor)
          ? {}
          : { state: { in: ['ACTIVE' as const, 'REMOVED' as const] } }),
      },
      select: { occurredAt: true },
      take: MAX_EVENTS,
    }),
  ]);
  return {
    days: TIMELINE_DAYS,
    incidents: countByDaysAgo(
      incidents.map(row => row.createdAt),
      now,
      TIMELINE_DAYS
    ),
    changes: countByDaysAgo(
      events.map(row => row.occurredAt),
      now,
      TIMELINE_DAYS
    ),
    truncated: incidents.length >= MAX_INCIDENTS || events.length >= MAX_EVENTS,
  };
}

const MAX_DIFF_DAYS = 400;

/** What changed between `since` and now: edges, edges awaiting review, and status changes. */
export async function diffGraph(
  actor: AuthorizationActor,
  since: Date,
  options: InsightOptions = {}
) {
  const now = new Date();
  if (since.getTime() >= now.getTime() || now.getTime() - since.getTime() > MAX_DIFF_DAYS * 864e5)
    throw new AppError({
      code: 'VALIDATION_FAILED',
      fields: [
        {
          field: 'since',
          code: 'custom',
          message: `Use a past time within ${MAX_DIFF_DAYS} days.`,
        },
      ],
    });
  const graph = await visibleGraph(actor, options);
  const [before, after] = await Promise.all([
    snapshotAt(actor, graph, since),
    snapshotAt(actor, graph, now),
  ]);
  const names = new Map(graph.nodes.map(node => [node.id, node.name]));
  const bsNames = new Map(graph.businessServices.map(bs => [bs.id, bs.name]));
  const edge = (e: ReplayedEdge) => ({
    upstreamServiceId: e.upstreamServiceId,
    downstreamServiceId: e.downstreamServiceId,
    upstreamName: names.get(e.upstreamServiceId) ?? null,
    downstreamName: names.get(e.downstreamServiceId) ?? null,
    origin: e.origin,
    since: e.since.toISOString(),
  });
  const diff = diffEdges(before.edges, after.edges);
  const pending = [...after.edges.values()].filter(e => e.state === 'SUGGESTED');
  const changes = (
    a: Map<string, { status: BsStatus }>,
    b: Map<string, { status: BsStatus }>,
    label: Map<string, string>
  ) =>
    diffStatuses(
      new Map([...a].map(([id, s]) => [id, s.status] as const)),
      new Map([...b].map(([id, s]) => [id, s.status] as const))
    )
      .slice(0, MAX_LIST)
      .map((c: StatusChange<BsStatus>) => ({ ...c, name: label.get(c.id) ?? null }));
  return {
    since: since.toISOString(),
    until: now.toISOString(),
    truncated: graph.truncated || before.truncated || after.truncated,
    addedDependencies: diff.added.slice(0, MAX_LIST).map(edge),
    removedDependencies: diff.removed.slice(0, MAX_LIST).map(edge),
    newlySuggestedDependencies: diff.newlySuggested.slice(0, MAX_LIST).map(edge),
    awaitingReview: { count: pending.length, items: pending.slice(0, MAX_LIST).map(edge) },
    serviceStatusChanges: changes(before.serviceStatus, after.serviceStatus, names),
    businessServiceStatusChanges: changes(before.businessStatus, after.businessStatus, bsNames),
  };
}

export interface SpofOptions extends InsightOptions {
  /** Transitive dependents at or above which a service counts as high fan-out. Default 5. */
  threshold?: number;
}

/**
 * A single point of failure is a service whose failure takes down at least `threshold` services
 * (transitive dependents over ACTIVE edges) AND that has no owner team or no on-call (no
 * escalation policy with a step). There is no redundancy model: alternatives are not detected.
 * Fan-out is counted over what the actor can see, so scoped actors get a lower bound.
 */
export async function findSinglePointsOfFailure(
  actor: AuthorizationActor,
  options: SpofOptions = {}
) {
  const graph = await visibleGraph(actor, options);
  const threshold = Math.min(Math.max(Math.trunc(options.threshold ?? 5), 1), 200);
  const edges = graph.edges.filter(edge => edge.status === 'ACTIVE');
  const ids = graph.nodes.map(node => node.id);
  const dependents = fanOut(edges, ids);
  const cuts = new Set(articulationPoints(edges));
  const candidates = ids.filter(id => (dependents.get(id)?.size ?? 0) >= threshold);
  const policies = await prisma.service.findMany({
    where: { id: { in: candidates } },
    select: { id: true, policy: { select: { steps: { take: 1, select: { id: true } } } } },
  });
  const hasOnCall = new Map(
    policies.map(row => [row.id, (row.policy?.steps.length ?? 0) > 0] as const)
  );
  const byService = new Map<string, Array<{ id: string; critical: boolean }>>();
  for (const member of graph.memberEdges)
    (
      byService.get(member.serviceId) ?? byService.set(member.serviceId, []).get(member.serviceId)!
    ).push({
      id: member.businessServiceId,
      critical: member.critical,
    });
  const nodes = new Map(graph.nodes.map(node => [node.id, node]));
  const spofs = candidates.flatMap(id => {
    const node = nodes.get(id)!;
    const reasons: string[] = [];
    if (!node.teamId) reasons.push('NO_OWNER_TEAM');
    if (!hasOnCall.get(id)) reasons.push('NO_ON_CALL');
    if (reasons.length === 0) return [];
    const affected = [id, ...(dependents.get(id) ?? [])];
    const bs = new Map<string, boolean>();
    for (const service of affected)
      for (const member of byService.get(service) ?? [])
        bs.set(member.id, (bs.get(member.id) ?? false) || member.critical);
    const critical = [...bs.values()].filter(Boolean).length;
    const fan = dependents.get(id)!.size;
    return [
      {
        serviceId: id,
        name: node.name,
        fanOut: fan,
        businessServiceCount: bs.size,
        criticalBusinessServiceCount: critical,
        articulationPoint: cuts.has(id),
        reasons,
        score: fan + 5 * bs.size + 10 * critical + (cuts.has(id) ? 5 : 0),
      },
    ];
  });
  spofs.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return {
    threshold,
    truncated: graph.truncated,
    singlePointsOfFailure: spofs.slice(0, MAX_LIST),
    articulationPoints: [...cuts].slice(0, MAX_LIST).map(id => ({
      serviceId: id,
      name: nodes.get(id)?.name ?? null,
      fanOut: dependents.get(id)?.size ?? 0,
    })),
  };
}

/**
 * Projects the effect of the given services failing outright: every service that depends on them
 * over HARD edges (with distance), those reachable only through SOFT edges, and each business
 * service's projected status from the real health rules with a synthetic HIGH incident per seed.
 * Seeds must be services the actor can read; hidden dependents are never counted.
 */
export async function simulateFailure(
  actor: AuthorizationActor,
  serviceIds: readonly string[],
  options: { maxDepth?: number } = {}
) {
  const seeds = [...new Set(serviceIds)];
  if (seeds.length === 0 || seeds.length > MAX_SIM_SEEDS)
    throw new AppError({
      code: 'VALIDATION_FAILED',
      fields: [
        { field: 'serviceIds', code: 'custom', message: `Provide 1 to ${MAX_SIM_SEEDS} ids.` },
      ],
    });
  const maxDepth = Math.min(Math.max(Math.trunc(options.maxDepth ?? 5), 1), 10);
  const graph = await visibleGraph(actor);
  const nodes = new Map(graph.nodes.map(node => [node.id, node]));
  if (seeds.some(id => !nodes.has(id))) {
    // The unfocused graph holds only the first services by name; a seed beyond that is not "missing".
    if (graph.truncated)
      throw new AppError({
        code: 'VALIDATION_FAILED',
        fields: [
          {
            field: 'serviceIds',
            code: 'custom',
            message:
              'The service graph is too large to simulate a service outside its first 2000 services.',
          },
        ],
      });
    throw new AppError({ code: 'RESOURCE_NOT_FOUND' });
  }
  const active = graph.edges.filter(edge => edge.status === 'ACTIVE');
  const hard = active.filter(edge => edge.dependencyType !== 'SOFT');
  const walk = (edgeSet: typeof active) => {
    const merged = new Map<string, number>();
    let truncated = false;
    for (const seed of seeds) {
      const found = downstreamDistances(edgeSet, seed, maxDepth, MAX_SIM_NODES);
      truncated ||= found.truncated;
      for (const [id, depth] of found.distances)
        if (!seeds.includes(id) && depth < (merged.get(id) ?? Infinity)) merged.set(id, depth);
    }
    return { merged, truncated };
  };
  const hardWalk = walk(hard);
  const allWalk = walk(active);
  const failed = new Set([...seeds, ...hardWalk.merged.keys()]);
  const softOnly = [...allWalk.merged].filter(([id]) => !failed.has(id));

  const now = new Date();
  const rows = await prisma.businessService.findMany({
    where: { id: { in: graph.businessServices.map(bs => bs.id) } },
  });
  const bsInputs: HealthInputs = {
    now,
    businessServices: rows.map(row => ({
      ...row,
      members: graph.memberEdges
        .filter(member => member.businessServiceId === row.id)
        .map(member => ({
          serviceId: member.serviceId,
          critical: member.critical,
          teamId: nodes.get(member.serviceId)?.teamId ?? null,
        })),
    })),
    supports: graph.supportEdges,
    edges: hard,
    incidents: seeds.map(serviceId => ({
      id: `sim:${serviceId}`,
      serviceId,
      urgency: 'HIGH' as const,
      priority: null,
      createdAt: now,
    })),
    impactRows: [],
    maintenance: new Map(),
  };
  const health = computeHealth(bsInputs);
  // Revenue and customer fields are optional columns; read them when the schema has them.
  const extras = new Map(
    rows.map(
      row =>
        [
          row.id,
          row as unknown as { revenuePerHourCents?: number | null; customersTotal?: number | null },
        ] as const
    )
  );
  const financials = canReadBusinessServiceFinancials(actor);
  const rankedOut = new Set<BsStatus>(['PARTIAL_OUTAGE', 'MAJOR_OUTAGE']);
  const affectedBusiness = graph.businessServices.flatMap(bs => {
    const projected = health.get(bs.id)?.status ?? 'UNKNOWN';
    if (projected === 'OPERATIONAL' || projected === 'UNKNOWN') return [];
    return [
      {
        id: bs.id,
        name: bs.name,
        criticality: bs.criticality,
        currentStatus: bs.status,
        projectedStatus: projected,
      },
    ];
  });
  const exposed = affectedBusiness.filter(bs => rankedOut.has(bs.projectedStatus));
  const sum = (key: 'revenuePerHourCents' | 'customersTotal') => {
    const values = exposed
      // eslint-disable-next-line security/detect-object-injection -- key is a closed typed union / internal name, never request input
      .map(bs => extras.get(bs.id)?.[key])
      .filter((v): v is number => typeof v === 'number');
    return values.length ? values.reduce((a, b) => a + b, 0) : null;
  };
  const toList = (entries: Iterable<[string, number]>) =>
    [...entries]
      .sort((a, b) => a[1] - b[1] || nodes.get(a[0])!.name.localeCompare(nodes.get(b[0])!.name))
      .map(([id, distance]) => ({ id, name: nodes.get(id)!.name, distance }));
  return {
    seeds: seeds.map(id => ({ id, name: nodes.get(id)!.name })),
    maxDepth,
    truncated: graph.truncated || hardWalk.truncated || allWalk.truncated,
    affectedServices: toList(hardWalk.merged),
    possiblyDegradedServices: toList(softOnly),
    affectedBusinessServices: affectedBusiness,
    exposure: {
      note: 'Counts business services projected at partial or major outage; overlapping customers are not de-duplicated. Null when no affected business service has the figure.',
      // Financial figures only for actors who may read them; others see the structure, not the money.
      revenuePerHourCents: financials ? sum('revenuePerHourCents') : null,
      customers: financials ? sum('customersTotal') : null,
    },
  };
}
