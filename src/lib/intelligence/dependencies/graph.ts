export interface DependencyEdge {
  upstreamServiceId: string;
  downstreamServiceId: string;
}

/** Stable identity for a connected dependency scope. Oversized graphs do not produce broad groups. */
export function topologyScope(
  edges: readonly DependencyEdge[],
  serviceId: string,
  limit = 256
): string[] | null {
  const adjacent = new Map<string, Set<string>>();
  for (const edge of edges) {
    for (const [a, b] of [
      [edge.upstreamServiceId, edge.downstreamServiceId],
      [edge.downstreamServiceId, edge.upstreamServiceId],
    ]) {
      const set = adjacent.get(a) ?? new Set<string>();
      set.add(b);
      adjacent.set(a, set);
    }
  }
  const seen = new Set([serviceId]);
  for (const current of seen) {
    for (const other of adjacent.get(current) ?? []) seen.add(other);
    if (seen.size > limit) return null;
  }
  return seen.size > 1 ? [...seen].sort() : null;
}

/**
 * Services that `serviceId` depends on, transitively, with their distance. The walk is breadth-first
 * with a visited set and a depth cap, so cycles (which real systems do contain) and very wide graphs
 * cannot make it loop or grow without bound. The starting service is never included.
 */
export function upstreamDistances(
  edges: readonly DependencyEdge[],
  serviceId: string,
  maxDepth: number
): Map<string, number> {
  const byDownstream = new Map<string, string[]>();
  for (const edge of edges) {
    const list = byDownstream.get(edge.downstreamServiceId);
    if (list) list.push(edge.upstreamServiceId);
    else byDownstream.set(edge.downstreamServiceId, [edge.upstreamServiceId]);
  }
  const distances = new Map<string, number>();
  const seen = new Set<string>([serviceId]);
  let frontier = [serviceId];
  for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth += 1) {
    const next: string[] = [];
    for (const current of frontier) {
      for (const upstream of byDownstream.get(current) ?? []) {
        if (seen.has(upstream)) continue;
        seen.add(upstream);
        distances.set(upstream, depth);
        next.push(upstream);
      }
    }
    frontier = next;
  }
  return distances;
}

/**
 * Services that depend on `serviceId`, transitively, with their distance: the blast radius of an incident on
 * it. Same bounded breadth-first walk as `upstreamDistances`, in the other direction, plus a node cap so a hub
 * service cannot produce an unbounded result; `truncated` says the cap was hit.
 */
export function downstreamDistances(
  edges: readonly DependencyEdge[],
  serviceId: string,
  maxDepth: number,
  maxNodes = 200
): { distances: Map<string, number>; truncated: boolean } {
  const byUpstream = new Map<string, string[]>();
  for (const edge of edges) {
    const list = byUpstream.get(edge.upstreamServiceId);
    if (list) list.push(edge.downstreamServiceId);
    else byUpstream.set(edge.upstreamServiceId, [edge.downstreamServiceId]);
  }
  const distances = new Map<string, number>();
  const seen = new Set<string>([serviceId]);
  let frontier = [serviceId];
  for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth += 1) {
    const next: string[] = [];
    for (const current of frontier) {
      for (const downstream of byUpstream.get(current) ?? []) {
        if (seen.has(downstream)) continue;
        if (distances.size >= maxNodes) return { distances, truncated: true };
        seen.add(downstream);
        distances.set(downstream, depth);
        next.push(downstream);
      }
    }
    frontier = next;
  }
  return { distances, truncated: false };
}

/** Adjacency from a dependent to what it depends on (downstream -> upstream). */
function dependsOnMap(edges: readonly DependencyEdge[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const edge of edges) {
    const list = map.get(edge.downstreamServiceId);
    if (list) list.push(edge.upstreamServiceId);
    else map.set(edge.downstreamServiceId, [edge.upstreamServiceId]);
  }
  return map;
}

/**
 * Declaring "downstream depends on upstream" closes a cycle exactly when upstream already depends,
 * transitively, on downstream. Returns that cycle as [downstream, upstream, ..., downstream], else null.
 * Iterative with a visited set, so it terminates on graphs that already contain cycles.
 */
export function wouldCreateCycle(
  edges: readonly DependencyEdge[],
  candidate: DependencyEdge
): string[] | null {
  const { upstreamServiceId: start, downstreamServiceId: goal } = candidate;
  if (start === goal) return [goal, goal];
  const next = dependsOnMap(edges);
  const parent = new Map<string, string>();
  const seen = new Set([start]);
  const stack = [start];
  while (stack.length) {
    const current = stack.pop()!;
    for (const dependency of next.get(current) ?? []) {
      if (seen.has(dependency)) continue;
      seen.add(dependency);
      parent.set(dependency, current);
      if (dependency === goal) {
        const path = [goal];
        for (let step = parent.get(goal); step !== undefined; step = parent.get(step))
          path.unshift(step);
        return [goal, ...path];
      }
      stack.push(dependency);
    }
  }
  return null;
}

/**
 * Dependency cycles already in the graph: every strongly connected component with more than one
 * service (Tarjan, iterative so a deep chain cannot overflow the stack). Capped at `limit` cycles.
 */
export function findCycles(edges: readonly DependencyEdge[], limit = 20): string[][] {
  const next = dependsOnMap(edges);
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const cycles: string[][] = [];
  let counter = 0;
  for (const root of next.keys()) {
    if (index.has(root)) continue;
    const work: Array<{ id: string; i: number }> = [{ id: root, i: 0 }];
    index.set(root, counter);
    low.set(root, counter++);
    stack.push(root);
    onStack.add(root);
    while (work.length) {
      const frame = work[work.length - 1];
      const children = next.get(frame.id) ?? [];
      if (frame.i < children.length) {
        const child = children[frame.i++];
        if (!index.has(child)) {
          index.set(child, counter);
          low.set(child, counter++);
          stack.push(child);
          onStack.add(child);
          work.push({ id: child, i: 0 });
        } else if (onStack.has(child)) {
          low.set(frame.id, Math.min(low.get(frame.id)!, index.get(child)!));
        }
        continue;
      }
      work.pop();
      const parent = work[work.length - 1];
      if (parent) low.set(parent.id, Math.min(low.get(parent.id)!, low.get(frame.id)!));
      if (low.get(frame.id) === index.get(frame.id)) {
        const component: string[] = [];
        let member: string;
        do {
          member = stack.pop()!;
          onStack.delete(member);
          component.push(member);
        } while (member !== frame.id);
        if (component.length > 1 || (next.get(frame.id) ?? []).includes(frame.id))
          cycles.push(component.sort());
      }
    }
    if (cycles.length >= limit) return cycles.slice(0, limit);
  }
  return cycles;
}

export interface DerivedStatus {
  status: 'DEGRADED' | 'PARTIAL_OUTAGE';
  incidentId: string;
  /** The service with the open incident. */
  serviceId: string;
  /** Hops from that service. */
  depth: number;
}

/**
 * Technical services that depend (<= maxDepth hops) on a service with an open incident, with the worst
 * resulting status: LOW urgency -> DEGRADED, MEDIUM/HIGH -> PARTIAL_OUTAGE (a dependency failing never
 * proves the dependent is fully down, the same cap the business-service engine applies). Sources are
 * excluded, since they already show their own incident.
 */
export function derivedDependencyStatuses(
  edges: ReadonlyArray<DependencyEdge & { dependencyType?: 'HARD' | 'SOFT' }>,
  sources: ReadonlyMap<string, { incidentId: string; urgency: 'HIGH' | 'MEDIUM' | 'LOW' }>,
  maxDepth = 3
): Map<string, DerivedStatus> {
  const result = new Map<string, DerivedStatus>();
  const worse = (a: DerivedStatus['status'], b: DerivedStatus['status']) =>
    a === 'PARTIAL_OUTAGE' && b === 'DEGRADED';
  const hardEdges = edges.filter(edge => edge.dependencyType !== 'SOFT');
  for (const [serviceId, source] of sources) {
    const urgencyStatus = source.urgency === 'LOW' ? 'DEGRADED' : 'PARTIAL_OUTAGE';
    // No node cap: the depth bound and the edge cap already limit the walk, and a silent cap here
    // would drop dependents from the status. A SOFT edge never proves the dependent is down, so
    // services reached only through one are capped at DEGRADED (as simulateFailure treats them).
    const hard = downstreamDistances(hardEdges, serviceId, maxDepth, Infinity).distances;
    const all = downstreamDistances(edges, serviceId, maxDepth, Infinity).distances;
    for (const [dependent, allDepth] of all) {
      if (sources.has(dependent)) continue;
      const hardDepth = hard.get(dependent);
      const status = hardDepth === undefined ? 'DEGRADED' : urgencyStatus;
      const depth = hardDepth ?? allDepth;
      const current = result.get(dependent);
      if (
        !current ||
        worse(status, current.status) ||
        (status === current.status && depth < current.depth)
      )
        result.set(dependent, { status, incidentId: source.incidentId, serviceId, depth });
    }
  }
  return result;
}

/** A one-line, display-safe reading of an edge's evidence JSON; unknown shapes yield null. */
export function describeEvidence(evidence: unknown): string | null {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return null;
  const e = evidence as Record<string, unknown>;
  const num = (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value) ? value : null;
  if (e.type === 'declared')
    return typeof e.source === 'string' && e.source.length <= 40
      ? `Declared by an operator (${e.source})`
      : 'Declared by an operator';
  if (e.type === 'co_occurrence') {
    const together = num(e.coOccurrences);
    const window = num(e.windowMinutes);
    const days = num(e.lookbackDays);
    if (together === null) return 'Observed from incidents opening together';
    return `Incidents opened together ${together} time${together === 1 ? '' : 's'}${window !== null ? ` within ${window} min` : ''}${days !== null ? ` over ${days} days` : ''}`;
  }
  return null;
}
