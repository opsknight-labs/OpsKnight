/**
 * Pure helpers shared by the server graph loader and the client graph view.
 */

export type GraphFocus = { kind: 'bs' | 'svc'; id: string };

const FOCUS_PATTERN = /^(bs|svc):([A-Za-z0-9_-]{1,100})$/;

/** `bs:<id>` or `svc:<id>`; anything else is no focus. */
export function parseGraphFocus(raw: unknown): GraphFocus | null {
  if (typeof raw !== 'string') return null;
  const match = FOCUS_PATTERN.exec(raw.trim());
  return match ? { kind: match[1] as GraphFocus['kind'], id: match[2] } : null;
}

export const formatGraphFocus = (focus: GraphFocus) => `${focus.kind}:${focus.id}`;

/**
 * Every node within `hops` undirected steps of the seeds (seeds included), stopping once `limit`
 * nodes are collected. Breadth-first, so nearer nodes always win the budget.
 */
export function nodesWithinHops(
  edges: ReadonlyArray<{ from: string; to: string }>,
  seeds: Iterable<string>,
  hops: number,
  limit = Number.POSITIVE_INFINITY
): Set<string> {
  const adjacency = new Map<string, string[]>();
  const link = (a: string, b: string) => {
    const list = adjacency.get(a);
    if (list) list.push(b);
    else adjacency.set(a, [b]);
  };
  for (const { from, to } of edges) {
    link(from, to);
    link(to, from);
  }
  const seen = new Set<string>();
  let frontier: string[] = [];
  for (const seed of seeds) {
    if (seen.size >= limit) return seen;
    if (!seen.has(seed)) {
      seen.add(seed);
      frontier.push(seed);
    }
  }
  for (let depth = 0; depth < hops && frontier.length; depth += 1) {
    const next: string[] = [];
    for (const node of frontier) {
      for (const neighbour of adjacency.get(node) ?? []) {
        if (seen.has(neighbour)) continue;
        if (seen.size >= limit) return seen;
        seen.add(neighbour);
        next.push(neighbour);
      }
    }
    frontier = next;
  }
  return seen;
}
