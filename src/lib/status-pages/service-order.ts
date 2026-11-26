/**
 * A status page has one service order (StatusPageService.order). The flat list follows it, and
 * each business service lists its members in that same order, so reordering a group's members
 * moves them within the page order instead of keeping a second, per-group order in sync.
 */

/** Page service ids by `order`; equal orders keep their given sequence. */
export function orderedServiceIds(
  ids: Iterable<string>,
  orderOf: (id: string) => number | undefined
): string[] {
  return [...ids].sort((a, b) => (orderOf(a) ?? 0) - (orderOf(b) ?? 0));
}

/** Puts a group's members into `memberOrder`, using the slots they already hold in the page order. */
export function reorderGroupMembers(
  pageOrder: readonly string[],
  memberOrder: readonly string[]
): string[] {
  const members = new Set(memberOrder);
  const queue = memberOrder.filter(id => pageOrder.includes(id));
  let next = 0;
  return pageOrder.map(id => (members.has(id) ? queue[next++] : id));
}
