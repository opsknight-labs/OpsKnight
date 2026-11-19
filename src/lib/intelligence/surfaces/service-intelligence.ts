import 'server-only';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import { incidentReadWhere, serviceReadWhere } from '@/lib/authorization-filters';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { getSloBurn, type ServiceBurn } from '@/lib/slo/burn';
import {
  MIN_INCIDENTS_FOR_QUALITY,
  NOISY_THRESHOLD,
  QUICK_RESOLVE_SECONDS,
  ALERT_QUALITY_WINDOW_DAYS,
  scoreAlertQuality,
} from '../triage/alert-quality';
import { GLOBAL_NOISE_SCOPE_KEY, noiseScopeKey } from '../noise-controls/contract';
import { isWindowActiveAt } from '../noise-controls/recurrence';
import { getNoiseControlKpis } from '../noise-controls/kpis';
import { resolveEffectivePolicy } from '../settings/service';
import { getAutoGate } from '../evaluation/quality';
import { recurringProblems, type RecurringProblem } from '../insights/service';

/**
 * Loaders for the service page's Intelligence tab. Every loader takes the access record resolved once by
 * `resolveServiceIntelligenceAccess`, which is the single gate: INTELLIGENCE_READ, an active account and
 * a service the actor may read. Each loader is bounded (explicit `take` or an aggregate over one
 * service) and is called through a fail-soft section wrapper by the page.
 */

export const SERVICE_INTELLIGENCE_LIMITS = {
  /** Edges of each kind (active, suggested) drawn around the service. */
  maxEdges: 24,
  maxChanges: 8,
  changeWindowDays: 14,
  maxWindows: 100,
  maxMonitors: 50,
  maxRecurring: 5,
  noiseKpiDays: 7,
} as const;

type IntelligenceMode = 'OFF' | 'SHADOW' | 'SUGGEST' | 'AUTO';
type NoiseMode = 'OFF' | 'SHADOW' | 'ON';

export interface ServiceIntelligenceAccess {
  actor: AuthorizationActor;
  service: { id: string; name: string; teamId: string | null };
  /** Effective intelligence mode of the service (forced OFF while the global switch is off). */
  mode: IntelligenceMode;
  /** Effective pre-paging noise-control mode: the service's own row, else the global row, else OFF. */
  noiseMode: NoiseMode;
  canManage: boolean;
  /**
   * False when both engines are OFF for the service and the viewer cannot change that: the tab is then
   * not offered at all, so a responder never sees an empty intelligence surface.
   */
  visible: boolean;
}

async function effectiveNoiseMode(
  serviceId: string,
  client: typeof prisma
): Promise<{ mode: NoiseMode; source: 'service' | 'global' | 'default' }> {
  const rows = await client.noiseControlPolicy.findMany({
    where: { scopeKey: { in: [noiseScopeKey(serviceId), GLOBAL_NOISE_SCOPE_KEY] } },
    take: 2,
    select: { scopeKey: true, mode: true },
  });
  const own = rows.find(row => row.scopeKey !== GLOBAL_NOISE_SCOPE_KEY);
  if (own) return { mode: own.mode, source: 'service' };
  const global = rows.find(row => row.scopeKey === GLOBAL_NOISE_SCOPE_KEY);
  return global ? { mode: global.mode, source: 'global' } : { mode: 'OFF', source: 'default' };
}

export async function resolveServiceIntelligenceAccess(
  actor: AuthorizationActor,
  serviceId: string,
  client: typeof prisma = prisma
): Promise<ServiceIntelligenceAccess | null> {
  if (actor.status !== 'ACTIVE' || !hasCapability(actor.role, CAPABILITIES.INTELLIGENCE_READ))
    return null;
  let readable: Prisma.ServiceWhereInput;
  try {
    readable = serviceReadWhere(actor);
  } catch {
    return null;
  }
  const service = await client.service.findFirst({
    where: { AND: [{ id: serviceId }, readable] },
    select: { id: true, name: true, teamId: true },
  });
  if (!service) return null;
  const [policy, noise] = await Promise.all([
    resolveEffectivePolicy(service.id, client)
      .then(row => row.effectiveMode as IntelligenceMode)
      .catch(() => 'OFF' as const),
    effectiveNoiseMode(service.id, client)
      .then(row => row.mode)
      .catch(() => 'OFF' as const),
  ]);
  const canManage = hasCapability(actor.role, CAPABILITIES.INTELLIGENCE_MANAGE);
  return {
    actor,
    service,
    mode: policy,
    noiseMode: noise,
    canManage,
    visible: canManage || policy !== 'OFF' || noise !== 'OFF',
  };
}

// ---------------------------------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------------------------------

export interface NeighbourNode {
  id: string;
  name: string;
  openIncidents: number;
  highestOpenUrgency: 'HIGH' | 'MEDIUM' | 'LOW' | null;
}

export interface NeighbourEdge {
  id: string;
  /** Where the neighbour sits relative to the focused service. */
  direction: 'UPSTREAM' | 'DOWNSTREAM';
  neighbourId: string;
  origin: 'DECLARED' | 'OBSERVED';
  status: 'ACTIVE' | 'SUGGESTED';
  confidence: number;
}

export interface ServiceDependencyNeighbourhood {
  focus: NeighbourNode;
  neighbours: NeighbourNode[];
  edges: NeighbourEdge[];
  /** More edges exist than are drawn. */
  truncated: boolean;
}

const urgencyRank = (urgency: 'HIGH' | 'MEDIUM' | 'LOW') =>
  urgency === 'HIGH' ? 2 : urgency === 'MEDIUM' ? 1 : 0;

/**
 * The service with its direct upstream and downstream dependencies: the same data as the topology graph
 * (`dependencies/graph-view`), cut down to one service's neighbourhood so the query stays small on a
 * large estate. Edges to a service the actor cannot read are dropped, never drawn as an unnamed node.
 */
export async function getServiceDependencyNeighbourhood(
  access: ServiceIntelligenceAccess,
  client: typeof prisma = prisma
): Promise<ServiceDependencyNeighbourhood> {
  const { actor, service } = access;
  const limit = SERVICE_INTELLIGENCE_LIMITS.maxEdges;
  const select = {
    id: true,
    upstreamServiceId: true,
    downstreamServiceId: true,
    origin: true,
    status: true,
    confidence: true,
  } as const;
  const touching = {
    OR: [{ upstreamServiceId: service.id }, { downstreamServiceId: service.id }],
  };
  const [active, suggested] = await Promise.all([
    client.serviceDependency.findMany({
      where: { ...touching, status: 'ACTIVE' },
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      take: limit + 1,
      select,
    }),
    client.serviceDependency.findMany({
      where: { ...touching, status: 'SUGGESTED' },
      orderBy: [{ confidence: 'desc' }, { id: 'asc' }],
      take: limit + 1,
      select,
    }),
  ]);
  const truncated = active.length > limit || suggested.length > limit;
  const rows = [...active.slice(0, limit), ...suggested.slice(0, limit)];
  const neighbourIds = [
    ...new Set(
      rows.map(row =>
        row.upstreamServiceId === service.id ? row.downstreamServiceId : row.upstreamServiceId
      )
    ),
  ];
  const [readable, open] = await Promise.all([
    neighbourIds.length
      ? client.service.findMany({
          where: { AND: [{ id: { in: neighbourIds } }, serviceReadWhere(actor)] },
          take: neighbourIds.length,
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
    client.incident.groupBy({
      by: ['serviceId', 'urgency'],
      where: {
        AND: [
          {
            serviceId: { in: [service.id, ...neighbourIds] },
            status: { in: ['OPEN', 'ACKNOWLEDGED'] },
          },
          incidentReadWhere(actor),
        ],
      },
      _count: { _all: true },
    }),
  ]);
  const overlay = new Map<
    string,
    { count: number; urgency: NeighbourNode['highestOpenUrgency'] }
  >();
  for (const row of open) {
    const entry = overlay.get(row.serviceId) ?? { count: 0, urgency: null };
    entry.count += row._count._all;
    const urgency = row.urgency as 'HIGH' | 'MEDIUM' | 'LOW';
    if (!entry.urgency || urgencyRank(urgency) > urgencyRank(entry.urgency))
      entry.urgency = urgency;
    overlay.set(row.serviceId, entry);
  }
  const node = (id: string, name: string): NeighbourNode => ({
    id,
    name,
    openIncidents: overlay.get(id)?.count ?? 0,
    highestOpenUrgency: overlay.get(id)?.urgency ?? null,
  });
  const names = new Map(readable.map(row => [row.id, row.name]));
  const edges: NeighbourEdge[] = [];
  for (const row of rows) {
    const upstream = row.downstreamServiceId === service.id;
    const neighbourId = upstream ? row.upstreamServiceId : row.downstreamServiceId;
    if (!names.has(neighbourId)) continue;
    edges.push({
      id: row.id,
      direction: upstream ? 'UPSTREAM' : 'DOWNSTREAM',
      neighbourId,
      origin: row.origin,
      status: row.status === 'ACTIVE' ? 'ACTIVE' : 'SUGGESTED',
      confidence: row.confidence,
    });
  }
  const used = new Set(edges.map(edge => edge.neighbourId));
  return {
    focus: node(service.id, service.name),
    neighbours: [...used]
      .map(id => node(id, names.get(id)!))
      .sort((a, b) => a.name.localeCompare(b.name)),
    edges,
    truncated,
  };
}

// ---------------------------------------------------------------------------------------------------
// SLO burn, alert quality, changes
// ---------------------------------------------------------------------------------------------------

/** Burn against the service's availability objectives; null when it has none. */
export function getServiceSloBurn(
  access: ServiceIntelligenceAccess,
  now: Date = new Date(),
  client: typeof prisma = prisma
): Promise<ServiceBurn | null> {
  return getSloBurn(access.service.id, now, client);
}

export interface ServiceAlertQuality {
  windowDays: number;
  incidents: number;
  quickResolvedRatio: number;
  neverAcknowledgedRatio: number;
  flappingRatio: number;
  noiseScore: number;
  flagged: boolean;
}

/**
 * The service's own row of the alert-quality leaderboard (same window, thresholds and score), from one
 * aggregate. Null below the minimum sample, where a ratio says nothing.
 */
export async function getServiceAlertQuality(
  access: ServiceIntelligenceAccess,
  now: Date = new Date(),
  client: typeof prisma = prisma
): Promise<ServiceAlertQuality | null> {
  const since = new Date(now.getTime() - ALERT_QUALITY_WINDOW_DAYS * 86_400_000);
  const [row] = await client.$queryRaw<
    Array<{ incidents: number; resolved: number; quick: number; never: number; flapping: number }>
  >(Prisma.sql`
    SELECT count(*)::int AS incidents,
           count(*) FILTER (WHERE "resolvedAt" IS NOT NULL)::int AS resolved,
           count(*) FILTER (WHERE "resolvedAt" IS NOT NULL
             AND "resolvedAt" - "createdAt" <= make_interval(secs => ${QUICK_RESOLVE_SECONDS}::float))::int AS quick,
           count(*) FILTER (WHERE "resolvedAt" IS NOT NULL AND "acknowledgedAt" IS NULL)::int AS never,
           count(*) FILTER (WHERE "status" = 'SUPPRESSED')::int AS flapping
    FROM "Incident"
    WHERE "createdAt" >= ${since} AND "createdAt" <= ${now} AND "serviceId" = ${access.service.id}
  `);
  if (!row || row.incidents < MIN_INCIDENTS_FOR_QUALITY) return null;
  const score = scoreAlertQuality({
    resolved: row.resolved,
    quickResolved: row.quick,
    neverAcknowledged: row.never,
    flapping: row.flapping,
    total: row.incidents,
  });
  return {
    windowDays: ALERT_QUALITY_WINDOW_DAYS,
    incidents: row.incidents,
    ...score,
    flagged: score.noiseScore >= NOISY_THRESHOLD,
  };
}

export interface ServiceChangeRow {
  id: string;
  kind: string;
  source: string;
  summary: string;
  version: string | null;
  occurredAt: Date;
  /** 0..1 ranking signal computed by the lane; null until it has been scored. */
  riskScore: number | null;
}

/** The service's most recent changes with the risk the lane computed for them (`changes/risk`). */
export async function getServiceRecentChanges(
  access: ServiceIntelligenceAccess,
  now: Date = new Date(),
  client: typeof prisma = prisma
): Promise<ServiceChangeRow[]> {
  const since = new Date(now.getTime() - SERVICE_INTELLIGENCE_LIMITS.changeWindowDays * 86_400_000);
  return client.changeEvent.findMany({
    where: { serviceId: access.service.id, occurredAt: { gte: since, lte: now } },
    orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
    take: SERVICE_INTELLIGENCE_LIMITS.maxChanges,
    select: {
      id: true,
      kind: true,
      source: true,
      summary: true,
      version: true,
      occurredAt: true,
      riskScore: true,
    },
  });
}

// ---------------------------------------------------------------------------------------------------
// Noise policy, maintenance windows, heartbeats
// ---------------------------------------------------------------------------------------------------

export interface ServiceNoiseStatus {
  mode: NoiseMode;
  source: 'service' | 'global' | 'default';
  days: number;
  alerts: number;
  incidents: number;
  pagesAvoided: number;
  shadowWouldAvoid: number;
  activeWindows: Array<{
    id: string;
    name: string;
    scope: 'SERVICE' | 'TEAM' | 'ALL';
    effect: 'SUPPRESS' | 'DOWNGRADE';
    endsAt: Date;
    recurring: boolean;
  }>;
  heartbeats: {
    monitors: number;
    missing: Array<{ id: string; name: string; missingSince: Date | null }>;
  };
}

/**
 * Noise-control state for one service: effective mode, a week of outcomes, maintenance windows active
 * right now (service-scoped, scoped to the owning team, or covering every service) and its heartbeat monitors. Label-scoped
 * windows apply per alert, not per service, so they are not listed here.
 */
export async function getServiceNoiseStatus(
  access: ServiceIntelligenceAccess,
  now: Date = new Date(),
  client: typeof prisma = prisma
): Promise<ServiceNoiseStatus> {
  const { service } = access;
  const scopes: Prisma.NoiseMaintenanceWindowWhereInput[] = [
    { scope: 'SERVICE', serviceId: service.id },
    { scope: 'ALL' },
  ];
  if (service.teamId) scopes.push({ scope: 'TEAM', teamId: service.teamId });
  const [mode, kpis, windows, monitors] = await Promise.all([
    effectiveNoiseMode(service.id, client),
    getNoiseControlKpis(
      { days: SERVICE_INTELLIGENCE_LIMITS.noiseKpiDays, serviceId: service.id, now },
      client
    ),
    client.noiseMaintenanceWindow.findMany({
      where: {
        enabled: true,
        endedAt: null,
        startsAt: { lte: now },
        AND: [{ OR: scopes }, { OR: [{ recurrence: { not: null } }, { endsAt: { gte: now } }] }],
      },
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
      take: SERVICE_INTELLIGENCE_LIMITS.maxWindows,
      select: {
        id: true,
        name: true,
        scope: true,
        effect: true,
        startsAt: true,
        endsAt: true,
        recurrence: true,
      },
    }),
    client.heartbeatMonitor.findMany({
      where: { serviceId: service.id, enabled: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: SERVICE_INTELLIGENCE_LIMITS.maxMonitors,
      select: { id: true, name: true, state: true, missingSince: true },
    }),
  ]);
  return {
    mode: mode.mode,
    source: mode.source,
    days: kpis.days,
    alerts: kpis.alerts,
    incidents: kpis.incidents,
    pagesAvoided: kpis.pagesAvoided,
    shadowWouldAvoid: kpis.shadowWouldAvoid,
    activeWindows: windows
      .filter(window => {
        try {
          return isWindowActiveAt(window, now);
        } catch {
          return false;
        }
      })
      .map(window => ({
        id: window.id,
        name: window.name,
        scope: window.scope as 'SERVICE' | 'TEAM' | 'ALL',
        effect: window.effect,
        endsAt: window.endsAt,
        recurring: window.recurrence !== null,
      })),
    heartbeats: {
      monitors: monitors.length,
      missing: monitors
        .filter(monitor => monitor.state === 'MISSING')
        .map(monitor => ({
          id: monitor.id,
          name: monitor.name,
          missingSince: monitor.missingSince,
        })),
    },
  };
}

// ---------------------------------------------------------------------------------------------------
// AUTO gate, recurring problems, learned facts
// ---------------------------------------------------------------------------------------------------

export interface ServiceAutoGate {
  mode: IntelligenceMode;
  source: 'service' | 'global' | 'default';
  allowed: boolean;
  reason: string;
  certified: boolean;
}

/** Whether automatic grouping is certified for the policy the service runs now (`evaluation/quality`). */
export async function getServiceAutoGate(
  access: ServiceIntelligenceAccess,
  now: Date = new Date(),
  client: typeof prisma = prisma
): Promise<ServiceAutoGate> {
  const policy = await resolveEffectivePolicy(access.service.id, client);
  const gate = await getAutoGate(access.service.id, policy.definition, client, now);
  return {
    mode: policy.effectiveMode as IntelligenceMode,
    source: policy.source,
    allowed: gate.allowed,
    reason: gate.reason,
    certified: gate.runId !== null,
  };
}

/** Problems that keep coming back on this service (`insights`), most frequent first. */
export async function getServiceRecurringProblems(
  access: ServiceIntelligenceAccess,
  now: Date = new Date(),
  client: typeof prisma = prisma
): Promise<RecurringProblem[]> {
  const rows = await recurringProblems([access.service.id], now, client);
  return rows
    .slice(0, SERVICE_INTELLIGENCE_LIMITS.maxRecurring)
    .map(row => ({ ...row, serviceName: access.service.name }));
}

/** How many confirmed facts Squire holds about the service; the facts themselves live on its memory page. */
export async function getServiceLearnedFactCount(
  access: ServiceIntelligenceAccess,
  client: typeof prisma = prisma
): Promise<number> {
  return client.knowledgeChunk.count({
    where: { serviceId: access.service.id, sourceKind: 'SERVICE_FACT' },
  });
}
