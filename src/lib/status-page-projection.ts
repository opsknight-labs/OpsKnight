import { maintenanceScopeFromAffectedIds } from '@/lib/status-pages/availability-engine';

export type MaintenanceAnnouncement = {
  type?: string;
  isActive?: boolean;
  startDate?: Date | string;
  endDate?: Date | string | null;
  affectedServiceIds?: unknown;
};

export function visibleStatusPageMappings<T extends { showOnPage: boolean }>(mappings: T[]): T[] {
  return mappings.filter(mapping => mapping.showOnPage);
}

export function statusProjectionClock(nowMs: number = Date.now()): Date {
  return new Date(Math.floor(nowMs / 60_000) * 60_000);
}

export function activeMaintenanceServiceIds(
  announcements: MaintenanceAnnouncement[],
  now: Date,
  allServiceIds: Iterable<string> = []
): Set<string> {
  const published = [...allServiceIds];
  const result = new Set<string>();
  for (const announcement of announcements) {
    if (announcement.type !== 'MAINTENANCE' || announcement.isActive === false) continue;
    const start = announcement.startDate ? new Date(announcement.startDate) : null;
    const end = announcement.endDate ? new Date(announcement.endDate) : null;
    if ((start && start > now) || (end && end <= now)) continue;
    const scope = maintenanceScopeFromAffectedIds(announcement.affectedServiceIds);
    if (scope.type === 'ALL_SERVICES') {
      for (const serviceId of published) result.add(serviceId);
      continue;
    }
    for (const serviceId of scope.serviceIds) result.add(serviceId);
  }
  return result;
}

export function visibleMaintenanceServiceIds(
  announcements: MaintenanceAnnouncement[],
  visibleServiceIds: Iterable<string>,
  now: Date
): Set<string> {
  const visible = [...visibleServiceIds];
  const visibleSet = new Set(visible);
  return new Set(
    [...activeMaintenanceServiceIds(announcements, now, visible)].filter(serviceId =>
      visibleSet.has(serviceId)
    )
  );
}

/** Incident impact always outranks scheduled maintenance. */
export function projectServiceStatus(
  serviceId: string,
  incidentStatus: string,
  maintenanceIds: ReadonlySet<string>
): string {
  return maintenanceIds.has(serviceId) && incidentStatus === 'OPERATIONAL'
    ? 'MAINTENANCE'
    : incidentStatus;
}

export function projectOverallStatus(
  hasCriticalIncident: boolean,
  hasDegradedIncident: boolean,
  maintenanceIds: ReadonlySet<string>
): 'outage' | 'degraded' | 'maintenance' | 'operational' {
  if (hasCriticalIncident) return 'outage';
  if (hasDegradedIncident) return 'degraded';
  return maintenanceIds.size > 0 ? 'maintenance' : 'operational';
}
