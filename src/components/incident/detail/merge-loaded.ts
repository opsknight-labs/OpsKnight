type Dated = { id: string; createdAt: Date | string };

/**
 * The server re-sends only the newest page after every refresh (posting a note, a realtime
 * nudge). Keep the older rows the viewer already paged in below it instead of dropping them.
 * Only rows strictly older than the newest page count, so a row that vanished from it (deleted) is not kept.
 * Returns `latest` itself when there is nothing older to keep. An empty `latest` keeps everything the
 * viewer loaded: the newest page is trimmed to the span every table is complete for, so on a busy
 * incident it can be empty while older rows exist, and that must not wipe what was paged in.
 */
export function mergeLatestWithOlder<T extends Dated>(
  latest: readonly T[],
  loaded: readonly T[]
): T[] {
  // Callers hand over their own state arrays; the identity is returned untouched when nothing merges.
  if (latest.length === 0) return loaded.length === 0 ? (latest as T[]) : [...loaded];
  const latestIds = new Set(latest.map(item => item.id));
  const oldestLatest = Math.min(...latest.map(item => new Date(item.createdAt).getTime()));
  const older = loaded.filter(
    item => !latestIds.has(item.id) && new Date(item.createdAt).getTime() < oldestLatest
  );
  return older.length === 0 ? (latest as T[]) : [...latest, ...older];
}
