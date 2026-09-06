import type { IncidentStatus } from '@prisma/client';

export const ACTIVE_INCIDENT_STATUSES = [
  'OPEN',
  'ACKNOWLEDGED',
] as const satisfies readonly IncidentStatus[];
export const MUTED_INCIDENT_STATUSES = [
  'SNOOZED',
  'SUPPRESSED',
] as const satisfies readonly IncidentStatus[];

export function activeIncidentStatuses(): IncidentStatus[] {
  return [...ACTIVE_INCIDENT_STATUSES];
}

export function mutedIncidentStatuses(): IncidentStatus[] {
  return [...MUTED_INCIDENT_STATUSES];
}

export function activeIncidentStatusesForFilter(
  status?: IncidentStatus | 'ACTIVE'
): IncidentStatus[] {
  if (status === 'ACTIVE') return activeIncidentStatuses();
  if (status === 'OPEN' || status === 'ACKNOWLEDGED') return [status];
  if (status) return [];
  return activeIncidentStatuses();
}

export function isActiveIncidentStatus(status: IncidentStatus): boolean {
  return ACTIVE_INCIDENT_STATUSES.includes(status as (typeof ACTIVE_INCIDENT_STATUSES)[number]);
}

export function incidentStatusLabel(status: IncidentStatus): string {
  if (status === 'OPEN') return 'Triggered';
  if (status === 'ACKNOWLEDGED') return 'Acknowledged';
  if (status === 'RESOLVED') return 'Resolved';
  if (status === 'SNOOZED') return 'Snoozed';
  return 'Suppressed';
}
