/**
 * Business-service health: a pure `computeHealth` over open incidents, membership, the service
 * dependency graph, business-service nesting, maintenance and remembered manual marks, plus a
 * process-wide snapshot cached per realtime change generation and filtered per actor.
 */
import type {
  BusinessServiceImpactSource,
  BusinessServiceTier,
  IncidentUrgency,
} from '@prisma/client';
import { downstreamDistances, type DependencyEdge } from '@/lib/intelligence/dependencies/graph';
import { publicStatusForIncidentUrgency } from '@/lib/status-pages/status-presentation';
import type { BsStatus, BusinessServiceHealth, ImpactReason } from './contract';

export type HealthBusinessService = {
  id: string;
  criticality: BusinessServiceTier | null;
  impactMinUrgency: IncidentUrgency | null;
  impactMaxPriority: string | null;
  ownerTeamId: string | null;
  /** Quorum rule: share (percent) of critical members impacted that makes it partial / major. */
  quorumPartialPct?: number | null;
  quorumMajorPct?: number | null;
  /** Dependency hops from a member that count as impact; default MAX_DEPTH. */
  dependencyHopDepth?: number | null;
  /** Customer reports within the window that lift health to DEGRADED; null = off. */
  customerReportThreshold?: number | null;
  customerReportWindowMinutes?: number | null;
  members: ReadonlyArray<{ serviceId: string; critical: boolean; teamId: string | null }>;
};

export type HealthIncident = {
  id: string;
  serviceId: string;
  urgency: IncidentUrgency;
  priority: string | null;
  createdAt: Date;
};

export type HealthImpactRow = {
  incidentId: string;
  businessServiceId: string;
  source: BusinessServiceImpactSource;
  excluded: boolean;
  createdById: string | null;
  /** Rows are intervals; the latest per incident and business service carries its state. */
  startedAt: Date;
};

/** The latest interval per incident and business service: it decides marks and exclusions. */
export function latestImpactRows<T extends HealthImpactRow>(rows: readonly T[]): Map<string, T> {
  const latest = new Map<string, T>();
  for (const row of rows) {
    const key = `${row.incidentId}:${row.businessServiceId}`;
    const current = latest.get(key);
    if (!current || row.startedAt >= current.startedAt) latest.set(key, row);
  }
  return latest;
}

export type HealthInputs = {
  now: Date;
  businessServices: readonly HealthBusinessService[];
  /** The child supports (is a dependency of) the parent. */
  supports: ReadonlyArray<{ parentId: string; childId: string }>;
  edges: readonly DependencyEdge[];
  /** Open or acknowledged incidents only: held, snoozed and suppressed ones never impact. */
  incidents: readonly HealthIncident[];
  /** Impact rows of open incidents: manual marks and exclusions. */
  impactRows: readonly HealthImpactRow[];
  /** serviceId -> id of the active maintenance window covering it. */
  maintenance: ReadonlyMap<string, string>;
  /** Recent customer reports (only needed for services with a threshold). */
  customerReports?: readonly HealthCustomerReport[];
};

export type HealthCustomerReport = { businessServiceId: string; count: number; windowEnd: Date };

export const DEFAULT_CUSTOMER_REPORT_WINDOW_MINUTES = 60;
export const MAX_CUSTOMER_REPORT_WINDOW_MINUTES = 1440;

/**
 * The CUSTOMER_REPORTS reason when reports ending inside the window reach the threshold, else
 * null. A report counts whole while its window ended inside the lookback (no pro-rating).
 */
export function customerReportsReason(
  bs: Pick<HealthBusinessService, 'customerReportThreshold' | 'customerReportWindowMinutes'>,
  reports: readonly Pick<HealthCustomerReport, 'count' | 'windowEnd'>[],
  now: Date
): Extract<ImpactReason, { kind: 'CUSTOMER_REPORTS' }> | null {
  const threshold = bs.customerReportThreshold;
  if (!threshold || threshold < 1) return null;
  const windowMinutes = Math.min(
    Math.max(bs.customerReportWindowMinutes ?? DEFAULT_CUSTOMER_REPORT_WINDOW_MINUTES, 1),
    MAX_CUSTOMER_REPORT_WINDOW_MINUTES
  );
  const since = now.getTime() - windowMinutes * 60_000;
  const reportCount = reports
    .filter(report => report.windowEnd.getTime() >= since && report.windowEnd.getTime() <= now.getTime() + 300_000)
    .reduce((sum, report) => sum + report.count, 0);
  return reportCount >= threshold
    ? { kind: 'CUSTOMER_REPORTS', status: 'DEGRADED', reportCount, threshold, windowMinutes }
    : null;
}

export const MAX_DEPTH = 3;
export const MAX_HOP_DEPTH = 5;
const MAX_REASONS = 25;

const RANK = new Map<BsStatus, number>([
  ['OPERATIONAL', 0],
  ['UNKNOWN', 1],
  ['MAINTENANCE', 2],
  ['DEGRADED', 3],
  ['PARTIAL_OUTAGE', 4],
  ['MAJOR_OUTAGE', 5],
]);
const rank = (status: BsStatus) => RANK.get(status) ?? 0;
const DEGRADED_RANK = rank('DEGRADED');
const KIND_ORDER: Record<ImpactReason['kind'], number> = {
  DIRECT: 0,
  DEPENDENCY: 1,
  MANUAL: 2,
  NESTED: 3,
  MAINTENANCE: 4,
  CUSTOMER_REPORTS: 5,
};
const URGENCY_RANK: Record<IncidentUrgency, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };

const cap = (status: BsStatus, max: BsStatus): BsStatus =>
  rank(status) > rank(max) ? max : status;

export type ImpactThreshold = { minUrgency: IncidentUrgency | null; maxPriority: number | null };

/** An incident impacts when its urgency is at least minUrgency or its priority is at most maxPriority. */
export const TIER_THRESHOLDS: Record<BusinessServiceTier, ImpactThreshold> = {
  TIER_0: { minUrgency: 'HIGH', maxPriority: 2 },
  TIER_1: { minUrgency: 'HIGH', maxPriority: 2 },
  TIER_2: { minUrgency: 'HIGH', maxPriority: 1 },
  TIER_3: { minUrgency: 'HIGH', maxPriority: null },
};
/** No criticality set: every open incident on a member counts, as before tiers existed. */
export const GLOBAL_THRESHOLD: ImpactThreshold = { minUrgency: 'LOW', maxPriority: null };

const hopDepth = (bs: Pick<HealthBusinessService, 'dependencyHopDepth'>) =>
  Math.min(Math.max(bs.dependencyHopDepth ?? MAX_DEPTH, 1), MAX_HOP_DEPTH);

/** Status from the share of critical members impacted; `null` when no rule is set. */
export function quorumStatus(
  rule: Pick<HealthBusinessService, 'quorumPartialPct' | 'quorumMajorPct'>,
  impactedCritical: number,
  critical: number
): BsStatus | null {
  const { quorumPartialPct: partial, quorumMajorPct: major } = rule;
  if (partial == null && major == null) return null;
  if (!impactedCritical || !critical) return 'OPERATIONAL';
  const pct = (impactedCritical / critical) * 100;
  if (major != null && pct >= major) return 'MAJOR_OUTAGE';
  if (partial != null && pct >= partial) return 'PARTIAL_OUTAGE';
  return 'DEGRADED';
}

export function parsePriority(priority: string | null | undefined): number | null {
  const match = /^P(\d+)$/i.exec(priority?.trim() ?? '');
  return match ? Number(match[1]) : null;
}

export function impactThreshold(
  service: Pick<HealthBusinessService, 'criticality' | 'impactMinUrgency' | 'impactMaxPriority'>
): ImpactThreshold {
  const base = service.criticality ? TIER_THRESHOLDS[service.criticality] : GLOBAL_THRESHOLD;
  return {
    minUrgency: service.impactMinUrgency ?? base.minUrgency,
    maxPriority: parsePriority(service.impactMaxPriority) ?? base.maxPriority,
  };
}

export function meetsThreshold(
  incident: Pick<HealthIncident, 'urgency' | 'priority'>,
  threshold: ImpactThreshold
): boolean {
  if (threshold.minUrgency && URGENCY_RANK[incident.urgency] >= URGENCY_RANK[threshold.minUrgency])
    return true;
  const priority = parsePriority(incident.priority);
  return threshold.maxPriority !== null && priority !== null && priority <= threshold.maxPriority;
}

/** Edges reachable from `serviceId` within `maxDepth`, so downstreamDistances walks a tiny graph. */
function walkEdges(
  byUpstream: ReadonlyMap<string, readonly string[]>,
  serviceId: string,
  maxDepth: number
) {
  const edges: DependencyEdge[] = [];
  const seen = new Set([serviceId]);
  let frontier = [serviceId];
  for (let depth = 1; depth <= maxDepth && frontier.length; depth += 1) {
    const next: string[] = [];
    for (const upstream of frontier) {
      for (const downstream of byUpstream.get(upstream) ?? []) {
        edges.push({ upstreamServiceId: upstream, downstreamServiceId: downstream });
        if (!seen.has(downstream)) {
          seen.add(downstream);
          next.push(downstream);
        }
      }
    }
    frontier = next;
  }
  return edges;
}

/** The incident behind a reason of the business service's own; NESTED ones belong to the child. */
function reasonIncidentId(reason: ImpactReason): string | null {
  return reason.kind !== 'NESTED' && 'incidentId' in reason ? reason.incidentId : null;
}

function byWorst(a: ImpactReason, b: ImpactReason) {
  return rank(b.status) - rank(a.status) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
}

/**
 * Health of every business service in `inputs`. Rules, worst reason wins:
 * - DIRECT: an incident meeting the service's threshold on a member; urgency maps to status,
 *   non-critical members cap at DEGRADED.
 * - DEPENDENCY: a critical member depends (depth <= dependencyHopDepth, default 3) on the incident's service; caps at PARTIAL_OUTAGE.
 * - MANUAL: a responder marked the incident as impacting; bypasses the threshold.
 * - Quorum rule (optional): status of DIRECT/DEPENDENCY reasons derives from the share of critical
 *   members impacted. No members and no reason: UNKNOWN (NO_MEMBERS), not OPERATIONAL.
 * - Exclusions remove every reason for that incident on that business service.
 * - MAINTENANCE: all critical members (all members when none is critical) are in maintenance.
 * - NESTED: a supporting business service (depth <= dependencyHopDepth) is impacted by an incident this one has
 *   not unmarked; caps at DEGRADED.
 */
export function computeHealth(inputs: HealthInputs): Map<string, BusinessServiceHealth> {
  const thresholds = new Map(inputs.businessServices.map(bs => [bs.id, impactThreshold(bs)]));
  const membersByService = new Map<string, Array<{ bsId: string; critical: boolean }>>();
  for (const bs of inputs.businessServices) {
    for (const member of bs.members) {
      const list = membersByService.get(member.serviceId);
      const entry = { bsId: bs.id, critical: member.critical };
      if (list) list.push(entry);
      else membersByService.set(member.serviceId, [entry]);
    }
  }
  const reportsByBs = new Map<string, HealthCustomerReport[]>();
  for (const report of inputs.customerReports ?? []) {
    const list = reportsByBs.get(report.businessServiceId);
    if (list) list.push(report);
    else reportsByBs.set(report.businessServiceId, [report]);
  }
  const latestRows = latestImpactRows(inputs.impactRows);
  const excluded = new Set<string>();
  for (const [key, row] of latestRows) if (row.excluded) excluded.add(key);
  const incidentsById = new Map(inputs.incidents.map(incident => [incident.id, incident]));

  // bsId -> incidentId -> the worst reason that incident gives it
  const incidentReasons = new Map<string, Map<string, ImpactReason>>();
  const impactedMembers = new Map<string, Set<string>>();
  const add = (bsId: string, incidentId: string, reason: ImpactReason) => {
    if (excluded.has(`${incidentId}:${bsId}`)) return;
    const member =
      reason.kind === 'DIRECT'
        ? reason.serviceId
        : reason.kind === 'DEPENDENCY'
          ? reason.viaServiceId
          : null;
    if (member) {
      const set = impactedMembers.get(bsId);
      if (set) set.add(member);
      else impactedMembers.set(bsId, new Set([member]));
    }
    let perIncident = incidentReasons.get(bsId);
    if (!perIncident) incidentReasons.set(bsId, (perIncident = new Map()));
    const current = perIncident.get(incidentId);
    if (!current || rank(reason.status) > rank(current.status)) perIncident.set(incidentId, reason);
  };

  // Same bounded walk as downstreamDistances, over an adjacency built once instead of per incident.
  const byUpstream = new Map<string, string[]>();
  for (const edge of inputs.edges) {
    const list = byUpstream.get(edge.upstreamServiceId);
    if (list) list.push(edge.downstreamServiceId);
    else byUpstream.set(edge.upstreamServiceId, [edge.downstreamServiceId]);
  }
  // One walk to the deepest hop any business service asks for; each service filters by its own.
  const walkDepth = Math.max(...inputs.businessServices.map(hopDepth), 1);
  const dependentsOf = (serviceId: string) =>
    byUpstream.has(serviceId)
      ? downstreamDistances(walkEdges(byUpstream, serviceId, walkDepth), serviceId, walkDepth)
          .distances
      : new Map<string, number>();
  const hopsByBs = new Map(inputs.businessServices.map(bs => [bs.id, hopDepth(bs)]));
  const dependents = new Map<string, Map<string, number>>();
  for (const incident of inputs.incidents) {
    const urgencyStatus = publicStatusForIncidentUrgency(incident.urgency);
    for (const member of membersByService.get(incident.serviceId) ?? []) {
      if (!meetsThreshold(incident, thresholds.get(member.bsId)!)) continue;
      add(member.bsId, incident.id, {
        kind: 'DIRECT',
        status: member.critical ? urgencyStatus : cap(urgencyStatus, 'DEGRADED'),
        incidentId: incident.id,
        serviceId: incident.serviceId,
        urgency: incident.urgency,
      });
    }
    let distances = dependents.get(incident.serviceId);
    if (!distances) {
      distances = dependentsOf(incident.serviceId);
      dependents.set(incident.serviceId, distances);
    }
    for (const [dependentId, depth] of distances) {
      for (const member of membersByService.get(dependentId) ?? []) {
        if (!member.critical || depth > hopsByBs.get(member.bsId)!) continue;
        if (!meetsThreshold(incident, thresholds.get(member.bsId)!)) continue;
        add(member.bsId, incident.id, {
          kind: 'DEPENDENCY',
          status: cap(urgencyStatus, 'PARTIAL_OUTAGE'),
          incidentId: incident.id,
          serviceId: incident.serviceId,
          viaServiceId: dependentId,
          depth,
        });
      }
    }
  }

  for (const row of latestRows.values()) {
    const incident = incidentsById.get(row.incidentId);
    if (row.source !== 'MANUAL' || row.excluded || !incident) continue;
    if (!thresholds.has(row.businessServiceId)) continue;
    add(row.businessServiceId, incident.id, {
      kind: 'MANUAL',
      status: publicStatusForIncidentUrgency(incident.urgency),
      incidentId: incident.id,
      markedById: row.createdById,
    });
  }

  type Own = { status: BsStatus; reasons: ImpactReason[] };
  const own = new Map<string, Own>();
  for (const bs of inputs.businessServices) {
    const reasons = [...(incidentReasons.get(bs.id)?.values() ?? [])];
    const critical = bs.members.filter(member => member.critical);
    const pool = critical.length ? critical : bs.members;
    if (pool.length && pool.every(member => inputs.maintenance.has(member.serviceId))) {
      reasons.push({
        kind: 'MAINTENANCE',
        status: 'MAINTENANCE',
        maintenanceWindowId: inputs.maintenance.get(pool[0].serviceId)!,
      });
    }
    // Never lowers status and never exceeds DEGRADED on its own; maintenance keeps its status.
    if (bs.customerReportThreshold && !reasons.some(reason => reason.kind === 'MAINTENANCE')) {
      const customer = customerReportsReason(bs, reportsByBs.get(bs.id) ?? [], inputs.now);
      if (customer) reasons.push(customer);
    }
    const criticalIds = new Set(critical.map(member => member.serviceId));
    const impactedCritical = [...(impactedMembers.get(bs.id) ?? [])].filter(id =>
      criticalIds.has(id)
    );
    const quorum = quorumStatus(bs, impactedCritical.length, critical.length);
    if (quorum) {
      // The fraction of critical members impacted replaces worst-of for their reasons.
      for (const [i, reason] of reasons.entries()) {
        if (reason.kind !== 'DIRECT' && reason.kind !== 'DEPENDENCY') continue;
        const member = reason.kind === 'DIRECT' ? reason.serviceId : reason.viaServiceId;
        if (criticalIds.has(member)) reasons[i] = { ...reason, status: quorum };
      }
    }
    reasons.sort(byWorst);
    own.set(bs.id, { status: reasons[0]?.status ?? 'OPERATIONAL', reasons });
  }

  const children = new Map<string, string[]>();
  for (const edge of inputs.supports) {
    const list = children.get(edge.parentId);
    if (list) list.push(edge.childId);
    else children.set(edge.parentId, [edge.childId]);
  }

  const result = new Map<string, BusinessServiceHealth>();
  for (const bs of inputs.businessServices) {
    const mine = own.get(bs.id)!;
    const reasons = [...mine.reasons];
    const visited = new Set([bs.id]);
    let frontier = [bs.id];
    const nestedDepth = hopsByBs.get(bs.id)!;
    for (let depth = 1; depth <= nestedDepth && frontier.length; depth += 1) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const childId of children.get(id) ?? []) {
          if (visited.has(childId)) continue;
          visited.add(childId);
          next.push(childId);
          // The child's worst incident that this business service has not unmarked.
          const carried = own.get(childId)?.reasons.find(reason => {
            const incidentId = reasonIncidentId(reason);
            return (
              incidentId !== null &&
              rank(reason.status) >= DEGRADED_RANK &&
              !excluded.has(`${incidentId}:${bs.id}`)
            );
          });
          const incidentId = carried && reasonIncidentId(carried);
          if (!carried || !incidentId) continue;
          reasons.push({
            kind: 'NESTED',
            status: cap(carried.status, 'DEGRADED'),
            childBusinessServiceId: childId,
            depth,
            incidentId,
          });
        }
      }
      frontier = next;
    }
    reasons.sort(byWorst);
    // No members, no supporting services and no reason: nothing is monitored, so say unknown rather than a silent green.
    // A pure group (supported only by other business services) is not empty.
    const noMembers = !reasons.length && !bs.members.length && !children.get(bs.id)?.length;
    const status = reasons[0]?.status ?? (noMembers ? 'UNKNOWN' : 'OPERATIONAL');
    // Since = the earliest incident behind the final status, own or nested alike.
    let since: Date | null = null;
    const incidentIds = new Set<string>();
    for (const reason of reasons) {
      const counted = reasonIncidentId(reason);
      if (counted) incidentIds.add(counted);
      const behind = 'incidentId' in reason ? reason.incidentId : null;
      const startedAt = behind ? incidentsById.get(behind)?.createdAt : undefined;
      if (reason.status === status && startedAt && (!since || startedAt < since)) since = startedAt;
    }
    result.set(bs.id, {
      businessServiceId: bs.id,
      status,
      since:
        status === 'OPERATIONAL' || status === 'MAINTENANCE' || status === 'UNKNOWN' ? null : since,
      reasons: reasons.slice(0, MAX_REASONS),
      openIncidentCount: incidentIds.size,
      memberCount: bs.members.length,
      impactedMemberCount: impactedMembers.get(bs.id)?.size ?? 0,
      computedAt: inputs.now,
      ...(noMembers ? { unknownReason: 'NO_MEMBERS' as const } : {}),
    });
  }
  return result;
}

/**
 * Business services a single incident impacts and the strongest source for each, from the
 * same rules as `computeHealth` (maintenance aside). Exclusions in `impactRows` still apply.
 */
export function incidentImpactSources(
  inputs: Omit<HealthInputs, 'incidents' | 'maintenance'>,
  incident: HealthIncident
): Map<string, BusinessServiceImpactSource> {
  const health = computeHealth({
    ...inputs,
    incidents: [incident],
    impactRows: inputs.impactRows.filter(row => row.incidentId === incident.id),
    maintenance: new Map(),
  });
  const sources = new Map<string, BusinessServiceImpactSource>();
  for (const [bsId, item] of health) {
    const reason = item.reasons[0];
    if (reason && reason.kind !== 'MAINTENANCE' && reason.kind !== 'CUSTOMER_REPORTS')
      sources.set(bsId, reason.kind);
  }
  return sources;
}

// ---------------------------------------------------------------------------------------------
// Snapshot: one global computation, cached per realtime change generation (20 s fresh, 5 min
// stale, refreshed in the background), the same policy as internal-operational-status-snapshot.
// ---------------------------------------------------------------------------------------------

export type HealthSnapshot = {
  inputs: HealthInputs;
  health: Map<string, BusinessServiceHealth>;
  byId: Map<string, HealthBusinessService>;
  generation: string | null;
  freshUntil: number;
  staleUntil: number;
};

const FRESH_TTL_MS = 20_000;
const STALE_TTL_MS = 5 * 60_000;
// Active incidents are read in pages so a storm never hides an older still-open incident.
const INCIDENT_PAGE = 5000;
let cached: HealthSnapshot | null = null;
let inFlight: Promise<HealthSnapshot> | null = null;
let epoch = 0;

/** Structural inputs plus open incidents (paged) and open impact rows. */
export async function loadHealthInputs(now = new Date()): Promise<HealthInputs> {
  const [
    { default: prisma },
    { loadActiveEdges },
    { findServicesInMaintenance },
    { activeIncidentStatuses },
  ] = await Promise.all([
    import('@/lib/prisma'),
    import('@/lib/intelligence/dependencies/service'),
    import('@/lib/service-maintenance/windows'),
    import('@/lib/incident-status'),
  ]);
  const [businessServices, supports, edges, incidents, impactRows, customerReports] = await Promise.all([
    prisma.businessService.findMany({
      select: {
        id: true,
        criticality: true,
        impactMinUrgency: true,
        impactMaxPriority: true,
        ownerTeamId: true,
        quorumPartialPct: true,
        quorumMajorPct: true,
        dependencyHopDepth: true,
        customerReportThreshold: true,
        customerReportWindowMinutes: true,
        members: {
          select: { serviceId: true, critical: true, service: { select: { teamId: true } } },
        },
      },
    }),
    prisma.businessServiceSupport.findMany({ select: { parentId: true, childId: true } }),
    loadActiveEdges(prisma),
    (async () => {
      const all = [];
      for (let cursor: string | undefined; ;) {
        const page = await prisma.incident.findMany({
          where: {
            status: { in: activeIncidentStatuses() },
            ...(cursor ? { id: { gt: cursor } } : {}),
          },
          orderBy: { id: 'asc' },
          take: INCIDENT_PAGE,
          select: { id: true, serviceId: true, urgency: true, priority: true, createdAt: true },
        });
        all.push(...page);
        if (page.length < INCIDENT_PAGE) return all;
        cursor = page[page.length - 1].id;
      }
    })(),
    // Every row of an open incident: manual marks are open, exclusions are ended but still apply.
    prisma.incidentBusinessServiceImpact.findMany({
      where: { incident: { status: { in: activeIncidentStatuses() } } },
      select: {
        incidentId: true,
        businessServiceId: true,
        source: true,
        excluded: true,
        createdById: true,
        startedAt: true,
      },
    }),
    // Only services that opted in (threshold set) need reports; none is read otherwise.
    prisma.customerImpactReport.findMany({
      where: {
        businessService: { customerReportThreshold: { not: null } },
        windowEnd: { gte: new Date(now.getTime() - MAX_CUSTOMER_REPORT_WINDOW_MINUTES * 60_000) },
      },
      select: { businessServiceId: true, count: true, windowEnd: true },
    }),
  ]);
  const memberServiceIds = [
    ...new Set(businessServices.flatMap(bs => bs.members.map(member => member.serviceId))),
  ];
  const windows = await findServicesInMaintenance(memberServiceIds, now);
  return {
    now,
    businessServices: businessServices.map(bs => ({
      ...bs,
      members: bs.members.map(member => ({
        serviceId: member.serviceId,
        critical: member.critical,
        teamId: member.service.teamId,
      })),
    })),
    supports,
    edges,
    incidents,
    impactRows,
    customerReports,
    maintenance: new Map([...windows].map(([serviceId, window]) => [serviceId, window.id])),
  };
}

async function calculate(startEpoch: number): Promise<HealthSnapshot> {
  const { getRealtimeChangeGeneration } = await import('@/lib/realtime-change-control-plane');
  const generation = await getRealtimeChangeGeneration().catch(() => null);
  const inputs = await loadHealthInputs();
  const computedAt = Date.now();
  const snapshot: HealthSnapshot = {
    inputs,
    health: computeHealth(inputs),
    byId: new Map(inputs.businessServices.map(bs => [bs.id, bs])),
    generation,
    freshUntil: computedAt + FRESH_TTL_MS,
    staleUntil: computedAt + STALE_TTL_MS,
  };
  if (epoch === startEpoch) cached = snapshot;
  return snapshot;
}

function start(): Promise<HealthSnapshot> {
  if (inFlight) return inFlight;
  const request = calculate(epoch).finally(() => {
    if (inFlight === request) inFlight = null;
  });
  inFlight = request;
  return request;
}

/** Drops the cached snapshot in this process, e.g. after a business-service write. */
export function invalidateBusinessServiceHealth() {
  epoch += 1;
  cached = null;
  inFlight = null;
}

/**
 * The cached snapshot when its generation still matches; otherwise a fresh one. `requireIds`
 * forces a recomputation when a business service is newer than the snapshot.
 */
export async function getHealthSnapshot(
  options: { requireFresh?: boolean; requireIds?: readonly string[] } = {}
): Promise<HealthSnapshot> {
  const entry = cached;
  const now = Date.now();
  // Unknown ids recompute at most every 2 s, so probing for missing ids cannot force a rebuild per call.
  const missing =
    !!entry &&
    now - (entry.freshUntil - FRESH_TTL_MS) > 2_000 &&
    !!options.requireIds?.some(id => !entry.byId.has(id));
  if (options.requireFresh || !entry || entry.staleUntil <= now || missing) {
    if (options.requireFresh || missing) invalidateBusinessServiceHealth();
    return start();
  }
  const { getRealtimeChangeGeneration } = await import('@/lib/realtime-change-control-plane');
  const generation = await getRealtimeChangeGeneration().catch(() => null);
  if (generation === null || entry.generation === null || generation !== entry.generation) {
    return start();
  }
  if (entry.freshUntil > now) return entry;
  void start().catch(() => undefined);
  return entry;
}

/** Same rule as businessServiceReadWhere, applied in memory to the snapshot. */
export function canSeeBusinessService(
  service: HealthBusinessService,
  scope: { global: true } | { global: false; teamIds: ReadonlySet<string> }
): boolean {
  if (scope.global) return true;
  return (
    (service.ownerTeamId !== null && scope.teamIds.has(service.ownerTeamId)) ||
    service.members.some(member => member.teamId !== null && scope.teamIds.has(member.teamId))
  );
}

export function resetBusinessServiceHealthCacheForTests() {
  invalidateBusinessServiceHealth();
}
