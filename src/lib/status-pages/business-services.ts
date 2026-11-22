import type {
  PublicBusinessService,
  PublicServiceStatus,
  PublicStatusHistory,
  PublicStatusHistorySegment,
  PublicStatusService,
  PublicUptimeWindow,
} from './public-contract';
import { getWorstPublicStatus } from './status-presentation';

export type BusinessServiceGroup = {
  id: string;
  name: string;
  description?: string | null;
  memberServiceIds: readonly string[];
  /** An admin's component-group override in force now; replaces the computed status. */
  statusOverride?: PublicServiceStatus | null;
  /** false keeps the row collapsed: visitors see the business service, not its parts. */
  showMembers?: boolean;
};

/**
 * Service ids an update affects: its own ids plus every member of the business services it
 * names. Null when it names neither (an unscoped update); an empty array when it names only
 * business services without members, so it never widens to "all services".
 */
export function expandAffectedServiceIds(
  serviceIds: unknown,
  businessServiceIds: unknown,
  membersByBusinessService: ReadonlyMap<string, readonly string[]>
): string[] | null {
  const strings = (value: unknown) =>
    Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string' && item.length > 0)
      : [];
  const direct = strings(serviceIds);
  const business = strings(businessServiceIds);
  if (!direct.length && !business.length) return null;
  return [
    ...new Set([
      ...direct,
      ...business.flatMap(id => membersByBusinessService.get(id) ?? []),
    ]),
  ];
}

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
    const status = getWorstPublicStatus(active.map(segment => segment.status)) as
      PublicStatusHistorySegment['status'];
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
    rangeEnd: histories.map(h => h.rangeEnd).sort().at(-1)!,
    coverage: histories.every(h => h.coverage === 'COMPLETE') ? 'COMPLETE' : 'PARTIAL',
    segments: mergeHistorySegments(histories.map(h => h.segments)),
  };
}

/** The weakest member's uptime: a business service is only as available as its worst part. */
function mergeUptimeWindow(windows: readonly PublicUptimeWindow[]): PublicUptimeWindow {
  const measured = windows.filter(window => window.percentage !== null);
  const worst = measured.reduce<PublicUptimeWindow | undefined>(
    (lowest, window) =>
      !lowest || (window.percentage ?? 100) < (lowest.percentage ?? 100) ? window : lowest,
    undefined
  );
  return {
    percentage: worst?.percentage ?? null,
    incidentCount: windows.reduce((sum, window) => sum + window.incidentCount, 0),
    measuredDays: Math.min(...windows.map(window => window.measuredDays)),
    complete: windows.every(window => window.complete),
    ...(worst?.grade ? { grade: worst.grade } : {}),
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
 * Business-service rows for a status page: status is the worst member status, history and
 * uptime are merged from members. Only members published on the page count; a business service
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
    const status = group.statusOverride ?? getWorstPublicStatus(members.map(member => member.status));
    // An override has no trustworthy start time, so it shows no "since" line.
    const statusSince = group.statusOverride ? undefined : statusSinceFor(status, members);
    const uptimeMembers = members.flatMap(member => (member.uptime ? [member.uptime] : []));
    const history = mergeHistory(members);
    return [
      {
        id: group.id,
        name: group.name,
        ...(group.description ? { description: group.description } : {}),
        status,
        ...(statusSince ? { statusSince } : {}),
        ...(group.showMembers === false ? { showMembers: false } : {}),
        memberServiceIds: members.map(member => member.id),
        activeIncidentCount: members.reduce((sum, member) => sum + member.activeIncidentCount, 0),
        impactedServiceCount: members.filter(
          member => member.status !== 'OPERATIONAL' && member.status !== 'UNKNOWN'
        ).length,
        ...(uptimeMembers.length === members.length
          ? {
              uptime: {
                days30: mergeUptimeWindow(uptimeMembers.map(uptime => uptime.days30)),
                days90: mergeUptimeWindow(uptimeMembers.map(uptime => uptime.days90)),
              },
            }
          : {}),
        ...(history ? { history } : {}),
      },
    ];
  });
}
