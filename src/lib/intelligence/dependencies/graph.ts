export interface DependencyEdge {
  upstreamServiceId: string;
  downstreamServiceId: string;
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
