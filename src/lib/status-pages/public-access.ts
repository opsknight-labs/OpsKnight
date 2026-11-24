import { getStatusPageSnapshotByRoute, type StatusPageSnapshot } from './snapshot';
import type { PublicIncident } from './public-contract';
import { incidentLinkId } from './incident-link';
import { isStatusPageSlug } from '@/lib/validation';

/**
 * Snapshot for surfaces that must never reveal a gated page (embed, badge, permalinks, group
 * JSON). Private, token-gated, disabled and unknown pages are all indistinguishable: null.
 */
export async function getOpenStatusSnapshot(slug: string): Promise<StatusPageSnapshot | null> {
  if (!isStatusPageSlug(slug)) return null;
  const { snapshot } = await getStatusPageSnapshotByRoute(slug);
  const page = snapshot?.page;
  if (
    !snapshot ||
    !page ||
    page.enabled === false ||
    page.requireAuth ||
    page.statusApiRequireToken
  )
    return null;
  return snapshot;
}

export { incidentLinkId } from './incident-link';

export function findPublicIncident(
  snapshot: StatusPageSnapshot,
  id: string
): PublicIncident | undefined {
  return snapshot.incidents.find(incident => incidentLinkId(incident) === id);
}

/** Incidents of one UTC month (`YYYY-MM`), newest first, within the retained history window. */
export function incidentsForMonth(
  incidents: readonly PublicIncident[],
  month: string
): PublicIncident[] {
  return incidents
    .filter(incident => incident.createdAt?.slice(0, 7) === month)
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
}

export const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export function shiftMonth(month: string, delta: number): string {
  const [year, m] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, m - 1 + delta, 1));
  return date.toISOString().slice(0, 7);
}

/** A business service plus the ids of every published service in it and its nested children. */
export function groupScope(snapshot: StatusPageSnapshot, groupId: string) {
  const groups = snapshot.businessServices ?? [];
  const group = groups.find(item => item.id === groupId);
  if (!group) return null;
  const scope: typeof groups = [];
  const visit = (item: (typeof groups)[number], depth: number) => {
    if (depth > 3 || scope.includes(item)) return;
    scope.push(item);
    for (const child of groups.filter(other => other.parentId === item.id)) visit(child, depth + 1);
  };
  visit(group, 1);
  return { group, scope, memberIds: new Set(scope.flatMap(item => item.memberServiceIds)) };
}
