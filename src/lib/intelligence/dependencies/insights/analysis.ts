/**
 * Pure graph analysis for the dependency insights: edge replay from history, diffing, fan-out,
 * articulation points. No I/O; every function is bounded by its inputs.
 */
import { downstreamDistances, type DependencyEdge } from '../graph';

export type EdgeState = 'ACTIVE' | 'SUGGESTED' | 'REJECTED' | 'REMOVED';

export interface EdgeEvent {
  upstreamServiceId: string;
  downstreamServiceId: string;
  state: EdgeState;
  origin: 'DECLARED' | 'OBSERVED';
  occurredAt: Date;
}

export interface ReplayedEdge {
  upstreamServiceId: string;
  downstreamServiceId: string;
  state: 'ACTIVE' | 'SUGGESTED';
  origin: 'DECLARED' | 'OBSERVED';
  /** When the edge entered this state. */
  since: Date;
}

export const edgeKey = (edge: DependencyEdge) => `${edge.upstreamServiceId}>${edge.downstreamServiceId}`;

/** The edges that were ACTIVE or SUGGESTED at `at`: the latest event per pair at or before it. */
export function replayEdges(events: readonly EdgeEvent[], at: Date): Map<string, ReplayedEdge> {
  const latest = new Map<string, EdgeEvent>();
  for (const event of events) {
    if (event.occurredAt > at) continue;
    const key = edgeKey(event);
    const current = latest.get(key);
    if (!current || event.occurredAt >= current.occurredAt) latest.set(key, event);
  }
  const result = new Map<string, ReplayedEdge>();
  for (const [key, event] of latest)
    if (event.state === 'ACTIVE' || event.state === 'SUGGESTED')
      result.set(key, {
        upstreamServiceId: event.upstreamServiceId,
        downstreamServiceId: event.downstreamServiceId,
        state: event.state,
        origin: event.origin,
        since: event.occurredAt,
      });
  return result;
}

export interface EdgeDiff {
  added: ReplayedEdge[];
  removed: ReplayedEdge[];
  /** Edges that became SUGGESTED (new, or demoted) since `before` and still await review. */
  newlySuggested: ReplayedEdge[];
}

/** ACTIVE edges gained and lost between two replays, plus suggestions that appeared. */
export function diffEdges(
  before: ReadonlyMap<string, ReplayedEdge>,
  after: ReadonlyMap<string, ReplayedEdge>
): EdgeDiff {
  const diff: EdgeDiff = { added: [], removed: [], newlySuggested: [] };
  for (const [key, edge] of after) {
    const was = before.get(key);
    if (edge.state === 'ACTIVE' && was?.state !== 'ACTIVE') diff.added.push(edge);
    if (edge.state === 'SUGGESTED' && was?.state !== 'SUGGESTED') diff.newlySuggested.push(edge);
  }
  for (const [key, edge] of before)
    if (edge.state === 'ACTIVE' && after.get(key)?.state !== 'ACTIVE') diff.removed.push(edge);
  return diff;
}

export interface StatusChange<S extends string = string> {
  id: string;
  from: S;
  to: S;
}

export function diffStatuses<S extends string>(
  before: ReadonlyMap<string, S>,
  after: ReadonlyMap<string, S>
): StatusChange<S>[] {
  const changes: StatusChange<S>[] = [];
  for (const [id, to] of after) {
    const from = before.get(id);
    if (from !== undefined && from !== to) changes.push({ id, from, to });
  }
  return changes;
}

/** Transitive dependents per service (how many services fail with it), with a per-walk node cap. */
export function fanOut(
  edges: readonly DependencyEdge[],
  serviceIds: readonly string[],
  maxDepth = 25,
  maxNodes = 2000
): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  for (const id of serviceIds)
    result.set(id, new Set(downstreamDistances(edges, id, maxDepth, maxNodes).distances.keys()));
  return result;
}

/**
 * Cut vertices of the dependency graph read as undirected: services whose removal splits the
 * graph, so everything on one side loses its only link to the other. Iterative Tarjan, O(V+E).
 */
export function articulationPoints(edges: readonly DependencyEdge[]): string[] {
  const adjacent = new Map<string, Set<string>>();
  for (const { upstreamServiceId: a, downstreamServiceId: b } of edges) {
    if (a === b) continue;
    (adjacent.get(a) ?? adjacent.set(a, new Set()).get(a)!).add(b);
    (adjacent.get(b) ?? adjacent.set(b, new Set()).get(b)!).add(a);
  }
  const disc = new Map<string, number>();
  const low = new Map<string, number>();
  const cuts = new Set<string>();
  let time = 0;
  for (const root of adjacent.keys()) {
    if (disc.has(root)) continue;
    let rootChildren = 0;
    disc.set(root, ++time);
    low.set(root, time);
    const stack: Array<{ node: string; parent: string | null; next: Iterator<string> }> = [
      { node: root, parent: null, next: adjacent.get(root)!.values() },
    ];
    while (stack.length) {
      const frame = stack[stack.length - 1];
      const step = frame.next.next();
      if (!step.done) {
        const to = step.value;
        if (to === frame.parent) continue;
        if (disc.has(to)) {
          low.set(frame.node, Math.min(low.get(frame.node)!, disc.get(to)!));
        } else {
          disc.set(to, ++time);
          low.set(to, time);
          stack.push({ node: to, parent: frame.node, next: adjacent.get(to)!.values() });
        }
        continue;
      }
      stack.pop();
      const parent = frame.parent;
      if (parent === null) continue;
      low.set(parent, Math.min(low.get(parent)!, low.get(frame.node)!));
      if (parent === root) rootChildren += 1;
      else if (low.get(frame.node)! >= disc.get(parent)!) cuts.add(parent);
    }
    if (rootChildren > 1) cuts.add(root);
  }
  return [...cuts].sort();
}

/** Counts per 24-hour bucket back from `now`: index 0 is the last 24 hours, `days - 1` the oldest. */
export function countByDaysAgo(times: readonly Date[], now: Date, days: number): number[] {
  const counts = new Array<number>(days).fill(0);
  for (const time of times) {
    const ago = Math.floor((now.getTime() - time.getTime()) / 864e5);
    // eslint-disable-next-line security/detect-object-injection -- a bounded integer index
    if (ago >= 0 && ago < days) counts[ago] += 1;
  }
  return counts;
}
