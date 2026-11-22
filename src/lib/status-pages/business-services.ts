import type {
  PublicBusinessService,
  PublicServiceStatus,
  PublicStatusHistory,
  PublicStatusHistorySegment,
  PublicStatusService,
  PublicUptimeWindow,
} from './public-contract';
import { getWorstPublicStatus } from './status-presentation';
import { serviceAvailability, type HealthSegment } from './availability-engine';

const DAY_MS = 86_400_000;

export type BusinessServiceGroup = {
  id: string;
  name: string;
  description?: string | null;
  memberServiceIds: readonly string[];
};

/**
 * Worst status at every instant across the members' published segments. Segments only cover
 * non-operational time, so a gap is operational; adjacent equal statuses are merged.
 */
export function mergeHistorySegments(
  lists: ReadonlyArray<readonly PublicStatusHistorySegment[]>
): PublicStatusHistorySegment[] {
  const all = lists.flat();
  if (!all.length) return [];
  const bounds = [
    ...new Set(all.flatMap(segment => [Date.parse(segment.startAt), Date.parse(segment.endAt)])),
  ]
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const merged: PublicStatusHistorySegment[] = [];
  for (const [index, start] of bounds.slice(0, -1).entries()) {
    const end = bounds.at(index + 1)!;
    const active = all.filter(
      segment => Date.parse(segment.startAt) <= start && Date.parse(segment.endAt) >= end
    );
    if (!active.length) continue;
    const status = getWorstPublicStatus(
      active.map(segment => segment.status)
    ) as PublicStatusHistorySegment['status'];
    const previous = merged.at(-1);
    if (previous && previous.status === status && Date.parse(previous.endAt) === start) {
      previous.endAt = new Date(end).toISOString();
    } else {
      merged.push({
        startAt: new Date(start).toISOString(),
        endAt: new Date(end).toISOString(),
        status,
      });
    }
  }
  return merged;
}

function mergeHistory(members: readonly PublicStatusService[]): PublicStatusHistory | undefined {
  const histories = members.flatMap(member => (member.history ? [member.history] : []));
  if (!histories.length) return undefined;
  return {
    rangeStart: histories.map(h => h.rangeStart).sort()[0],
    rangeEnd: histories
      .map(h => h.rangeEnd)
      .sort()
      .at(-1)!,
    coverage: histories.every(h => h.coverage === 'COMPLETE') ? 'COMPLETE' : 'PARTIAL',
    segments: mergeHistorySegments(histories.map(h => h.segments)),
  };
}

/**
 * Uptime over the union of the members' downtime: the business service is down while any member
 * is, and overlapping member outages count once. Without merged history it falls back to the
 * weakest member, which is the same number when only one member was ever down.
 * Incident counts add up per member; every incident belongs to exactly one service, so the sum
 * is already a count of distinct incidents.
 */
function mergeUptimeWindow(
  windows: readonly PublicUptimeWindow[],
  history: PublicStatusHistory | undefined
): PublicUptimeWindow {
  const measured = windows.filter(window => window.percentage !== null);
  const worst = measured.reduce<PublicUptimeWindow | undefined>(
    (lowest, window) =>
      !lowest || (window.percentage ?? 100) < (lowest.percentage ?? 100) ? window : lowest,
    undefined
  );
  const measuredDays = Math.min(...windows.map(window => window.measuredDays));
  let percentage = worst?.percentage ?? null;
  if (history && measured.length) {
    const end = Date.parse(history.rangeEnd);
    const start = Math.max(Date.parse(history.rangeStart), end - measuredDays * DAY_MS);
    const segments: HealthSegment[] = history.segments.map(segment => ({
      start: Date.parse(segment.startAt),
      end: Date.parse(segment.endAt),
      status: segment.status,
    }));
    percentage =
      serviceAvailability(segments, new Date(start), new Date(end)).percentage ?? percentage;
  }
  return {
    percentage,
    incidentCount: windows.reduce((sum, window) => sum + window.incidentCount, 0),
    measuredDays,
    complete: windows.every(window => window.complete),
    ...(worst?.grade && percentage === worst.percentage ? { grade: worst.grade } : {}),
  };
}

function statusSinceFor(
  status: PublicServiceStatus,
  members: readonly PublicStatusService[]
): string | undefined {
  const times = members
    .filter(member => member.status === status && member.statusSince)
    .map(member => member.statusSince!)
    .sort();
  // Degraded since the first member went bad; operational since the last one recovered.
  return status === 'OPERATIONAL' ? times.at(-1) : times[0];
}

/**
 * Business-service rows for a status page: status is the worst published member status (public
 * pages only reflect public incidents, so they do not use the internal health engine), history
 * is merged from members and uptime is the union of their downtime. Only members published on the page count; a business service
 * with no published member is left out rather than shown as healthy.
 */
export function buildPublicBusinessServices(
  groups: readonly BusinessServiceGroup[],
  services: readonly PublicStatusService[]
): PublicBusinessService[] {
  const byId = new Map(services.map(service => [service.id, service]));
  return groups.flatMap(group => {
    const members = group.memberServiceIds.flatMap(id => {
      const service = byId.get(id);
      return service ? [service] : [];
    });
    if (!members.length) return [];
    const status = getWorstPublicStatus(members.map(member => member.status));
    const statusSince = statusSinceFor(status, members);
    const uptimeMembers = members.flatMap(member => (member.uptime ? [member.uptime] : []));
    const history = mergeHistory(members);
    return [
      {
        id: group.id,
        name: group.name,
        ...(group.description ? { description: group.description } : {}),
        status,
        ...(statusSince ? { statusSince } : {}),
        memberServiceIds: members.map(member => member.id),
        activeIncidentCount: members.reduce((sum, member) => sum + member.activeIncidentCount, 0),
        impactedServiceCount: members.filter(
          member => member.status !== 'OPERATIONAL' && member.status !== 'UNKNOWN'
        ).length,
        ...(uptimeMembers.length === members.length
          ? {
              uptime: {
                days30: mergeUptimeWindow(
                  uptimeMembers.map(uptime => uptime.days30),
                  history
                ),
                days90: mergeUptimeWindow(
                  uptimeMembers.map(uptime => uptime.days90),
                  history
                ),
              },
            }
          : {}),
        ...(history ? { history } : {}),
      },
    ];
  });
}
