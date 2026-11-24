export const MAX_BUSINESS_HIERARCHY_DEPTH = 3;

export type BusinessHierarchyEdge = { parentId: string; childId: string };
export type BusinessHierarchyNode = { parentId?: string; childIds: string[] };

/**
 * Display tree over the given ids (page order). Every node gets at most one parent (the first
 * accepted edge), edges to unknown ids, self edges, cycles and anything that would push the tree
 * past `maxDepth` levels (a root is level 1) are dropped, so the result is always a bounded forest.
 */
export function buildBusinessHierarchy(
  ids: readonly string[],
  edges: readonly BusinessHierarchyEdge[],
  maxDepth = MAX_BUSINESS_HIERARCHY_DEPTH
): Map<string, BusinessHierarchyNode> {
  const order = new Map(ids.map((id, index) => [id, index]));
  const nodes = new Map<string, BusinessHierarchyNode>(ids.map(id => [id, { childIds: [] }]));
  const depthOf = (id: string) => {
    let depth = 1;
    for (
      let at = nodes.get(id)?.parentId;
      at && depth <= maxDepth + 1;
      at = nodes.get(at)?.parentId
    )
      depth++;
    return depth;
  };
  const heightOf = (id: string, guard = 0): number =>
    guard > maxDepth
      ? 0
      : Math.max(0, ...(nodes.get(id)?.childIds ?? []).map(c => 1 + heightOf(c, guard + 1)));
  const sorted = [...edges].sort(
    (a, b) =>
      (order.get(a.parentId) ?? 0) - (order.get(b.parentId) ?? 0) ||
      (order.get(a.childId) ?? 0) - (order.get(b.childId) ?? 0)
  );
  for (const { parentId, childId } of sorted) {
    const parent = nodes.get(parentId);
    const child = nodes.get(childId);
    if (!parent || !child || parentId === childId || child.parentId) continue;
    // Cycle: the child is already an ancestor of the parent.
    let cyclic = false;
    for (
      let at: string | undefined = parentId, n = 0;
      at && n <= ids.length;
      at = nodes.get(at)?.parentId, n++
    )
      if (at === childId) cyclic = true;
    if (cyclic || depthOf(parentId) + 1 + heightOf(childId) > maxDepth) continue;
    child.parentId = parentId;
    parent.childIds.push(childId);
  }
  for (const node of nodes.values())
    node.childIds.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  return nodes;
}
