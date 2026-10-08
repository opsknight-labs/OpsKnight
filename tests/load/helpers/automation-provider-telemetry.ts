/** Counter resets or missing providers make duplicate-delivery evidence unusable. */
export function providerDuplicateDelta(
  before: Record<string, unknown>,
  after: Record<string, unknown>
): number | null {
  const previous = new Map(Object.entries(before));
  const current = Object.entries(after);
  if (!previous.size || previous.size !== current.length) return null;
  let delta = 0;
  for (const [provider, sample] of current) {
    const prior = previous.get(provider);
    if (
      !prior ||
      typeof prior !== 'object' ||
      !('duplicateDeliveries' in prior) ||
      !sample ||
      typeof sample !== 'object' ||
      !('duplicateDeliveries' in sample)
    )
      return null;
    const oldCount = prior.duplicateDeliveries,
      newCount = sample.duplicateDeliveries;
    if (
      typeof oldCount !== 'number' ||
      typeof newCount !== 'number' ||
      !Number.isSafeInteger(oldCount) ||
      !Number.isSafeInteger(newCount) ||
      oldCount < 0 ||
      newCount < oldCount
    )
      return null;
    delta += newCount - oldCount;
  }
  return delta;
}
