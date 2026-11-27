type Dated = { id: string; createdAt: Date | string };

/**
 * The server re-sends only the newest page after every refresh (posting a note, a realtime
 * nudge). Keep the older rows the viewer already paged in below it instead of dropping them.
 * Returns `latest` itself when there is nothing older to keep.
 */
export function mergeLatestWithOlder<T extends Dated>(
  latest: readonly T[],
  loaded: readonly T[]
): T[] {
  // Callers hand over their own state arrays; the identity is returned untouched when nothing merges.
  if (latest.length === 0) return latest as T[];
  const latestIds = new Set(latest.map(item => item.id));
  const oldestLatest = Math.min(...latest.map(item => new Date(item.createdAt).getTime()));
  const older = loaded.filter(
    item => !latestIds.has(item.id) && new Date(item.createdAt).getTime() <= oldestLatest
  );
  return older.length === 0 ? (latest as T[]) : [...latest, ...older];
}
