export type MaintenanceAnnouncement = {
  type?: string;
  isActive?: boolean;
  startDate?: Date | string;
  endDate?: Date | string | null;
  affectedServiceIds?: unknown;
};

export function activeMaintenanceServiceIds(
  announcements: MaintenanceAnnouncement[],
  now: Date
): Set<string> {
  const result = new Set<string>();
  for (const announcement of announcements) {
    if (announcement.type !== 'MAINTENANCE' || announcement.isActive === false) continue;
    const start = announcement.startDate ? new Date(announcement.startDate) : null;
    const end = announcement.endDate ? new Date(announcement.endDate) : null;
    if ((start && start > now) || (end && end <= now)) continue;
    if (!Array.isArray(announcement.affectedServiceIds)) continue;
    for (const serviceId of announcement.affectedServiceIds) {
      if (typeof serviceId === 'string') result.add(serviceId);
    }
  }
  return result;
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
