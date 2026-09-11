/** Per-category public display budget. Categories must not share a single truncated pool. */
export const STATUS_PAGE_DISPLAY_FEED_LIMIT = 200;

const stillOpen = (now: Date) => ({
  OR: [{ endDate: null }, { endDate: { gte: now } }],
});

/** Currently visible notices that are not first-class maintenance or changelog. */
export function currentAnnouncementDisplayWhere(pageId: string, now: Date) {
  return {
    statusPageId: pageId,
    isActive: true,
    type: { notIn: ['MAINTENANCE', 'UPDATE'] },
    startDate: { lte: now },
    ...stillOpen(now),
  };
}

/** Maintenance already started and not ended. */
export function maintenanceInProgressDisplayWhere(pageId: string, now: Date) {
  return {
    statusPageId: pageId,
    isActive: true,
    type: 'MAINTENANCE' as const,
    startDate: { lte: now },
    ...stillOpen(now),
  };
}

/** Maintenance that has not started yet. */
export function maintenanceUpcomingDisplayWhere(pageId: string, now: Date) {
  return {
    statusPageId: pageId,
    isActive: true,
    type: 'MAINTENANCE' as const,
    startDate: { gt: now },
    ...stillOpen(now),
  };
}

/** Published changelog entries that are currently in window. */
export function changelogDisplayWhere(pageId: string, now: Date) {
  return {
    statusPageId: pageId,
    isActive: true,
    type: 'UPDATE' as const,
    startDate: { lte: now },
    ...stillOpen(now),
  };
}

export function mergeDisplayMaintenance<T extends { id: string }>(
  inProgress: T[],
  upcoming: T[]
): T[] {
  const seen = new Set<string>();
  const merged: T[] = [];
  for (const item of [...inProgress, ...upcoming]) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    merged.push(item);
  }
  return merged;
}
