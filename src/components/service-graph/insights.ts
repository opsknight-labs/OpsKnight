/**
 * Pure helpers that turn the insight endpoints' payloads (time travel, changes, single points of
 * failure) into things the graph model and canvas already understand. No React, no server imports at runtime.
 */
import type {
  diffGraph,
  findSinglePointsOfFailure,
  getGraphAt,
  simulateFailure,
} from '@/lib/intelligence/dependencies/insights/service';
import type { ServiceGraphView } from '@/lib/intelligence/dependencies/graph-view';
import { svcKey, type GraphItem, type GraphLink } from './model';

export type GraphSnapshot = Awaited<ReturnType<typeof getGraphAt>>;
export type GraphDiff = Awaited<ReturnType<typeof diffGraph>>;
export type SpofReport = Awaited<ReturnType<typeof findSinglePointsOfFailure>>;
export type FailureProjection = Awaited<ReturnType<typeof simulateFailure>>;

export const TIME_TRAVEL_DAYS = 90;
export const DAY_MS = 864e5;

/**
 * The loaded graph as it was at a past moment: same nodes (minus services that did not exist yet),
 * statuses, incident counts and dependency edges from the snapshot. Layout inputs that history does
 * not hold (teams, evidence, edge semantics) come from the live graph where the edge still exists.
 */
export function snapshotView(base: ServiceGraphView, snapshot: GraphSnapshot): ServiceGraphView {
  const services = new Map(snapshot.services.map(service => [service.id, service]));
  const businessServices = new Map(snapshot.businessServices.map(bs => [bs.id, bs]));
  const liveEdges = new Map(base.edges.map(edge => [`${edge.upstreamServiceId}>${edge.downstreamServiceId}`, edge]));
  return {
    ...base,
    incident: null,
    truncated: base.truncated || snapshot.truncated,
    nodes: base.nodes.flatMap(node => {
      const past = services.get(node.id);
      return past
        ? [{ ...node, status: past.status, openIncidents: past.openIncidentCount, reasons: [], highestOpenUrgency: null }]
        : [];
    }),
    businessServices: base.businessServices.flatMap(bs => {
      const past = businessServices.get(bs.id);
      return past ? [{ ...bs, status: past.status, openIncidents: past.openIncidentCount, reasons: [] }] : [];
    }),
    edges: snapshot.dependencies
      .filter(edge => services.has(edge.upstreamServiceId) && services.has(edge.downstreamServiceId))
      .map(edge => {
        const key = `${edge.upstreamServiceId}>${edge.downstreamServiceId}`;
        const live = liveEdges.get(key);
        return {
          id: live?.id ?? `hist:${key}`,
          upstreamServiceId: edge.upstreamServiceId,
          downstreamServiceId: edge.downstreamServiceId,
          origin: edge.origin,
          status: edge.state,
          confidence: live?.confidence ?? (edge.state === 'ACTIVE' ? 1 : 0),
          dependencyType: live?.dependencyType,
          note: live?.note,
          criticality: live?.criticality,
          evidence: live?.evidence,
          traffic: null,
        };
      }),
    memberEdges: snapshot.members.filter(m => services.has(m.serviceId) && businessServices.has(m.businessServiceId)),
    supportEdges: snapshot.supports.filter(s => businessServices.has(s.parentId) && businessServices.has(s.childId)),
  };
}

const pairKey = (edge: { upstreamServiceId: string; downstreamServiceId: string }) =>
  `${edge.upstreamServiceId}>${edge.downstreamServiceId}`;

/**
 * Marks links added since the diff's start and draws the removed ones back as dashed ghosts (only
 * when both ends are on the graph). Links are not mutated.
 */
export function overlayDiff(
  items: readonly GraphItem[],
  links: readonly GraphLink[],
  diff: GraphDiff
): GraphLink[] {
  const added = new Set([...diff.addedDependencies, ...diff.newlySuggestedDependencies].map(pairKey));
  const present = new Set(items.map(item => item.key));
  const marked = links.map(link =>
    link.kind === 'dependency' && added.has(`${link.target.slice(4)}>${link.source.slice(4)}`)
      ? { ...link, diff: 'added' as const }
      : link
  );
  const ghosts = diff.removedDependencies
    .filter(edge => present.has(svcKey(edge.upstreamServiceId)) && present.has(svcKey(edge.downstreamServiceId)))
    .map(
      (edge): GraphLink => ({
        key: `diff:removed:${pairKey(edge)}`,
        source: svcKey(edge.downstreamServiceId),
        target: svcKey(edge.upstreamServiceId),
        kind: 'dependency',
        suggested: false,
        dependencyId: null,
        confidence: null,
        origin: edge.origin,
        diff: 'removed',
      })
    );
  return [...marked, ...ghosts];
}

/** Items flagged as single points of failure get a badge. Same array when nothing changes. */
export function markSpof(items: readonly GraphItem[], serviceIds: ReadonlySet<string>): GraphItem[] {
  if (serviceIds.size === 0) return items as GraphItem[];
  return items.map(item => (item.kind === 'svc' && serviceIds.has(item.id) ? { ...item, spof: true } : item));
}

/** The date-time input wants local `YYYY-MM-DDTHH:mm`. */
export function toLocalInput(date: Date): string {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}

/** Clamps a picked moment into the scrubber's window: the last 90 days, never the future. */
export function clampMoment(at: Date, now: Date = new Date()): Date {
  const earliest = now.getTime() - TIME_TRAVEL_DAYS * DAY_MS;
  return new Date(Math.min(Math.max(at.getTime(), earliest), now.getTime()));
}

/** Server-view config fields the explorer round-trips; anything unreadable falls back to nothing. */
export function readViewConfig(config: unknown): { focus: string | null; hops: number | null; search: string } {
  const c = (config && typeof config === 'object' ? config : {}) as Record<string, unknown>;
  return {
    focus: typeof c.focus === 'string' ? c.focus : null,
    hops: typeof c.hops === 'number' ? c.hops : null,
    search: typeof c.search === 'string' ? c.search : '',
  };
}
