export type AnalyticsExportFilters = {
  windowDays: number;
  teamId?: string;
  serviceId?: string;
  assigneeId?: string;
  status?: 'OPEN' | 'ACKNOWLEDGED' | 'SNOOZED' | 'SUPPRESSED' | 'RESOLVED';
  urgency?: 'HIGH' | 'MEDIUM' | 'LOW';
};

const shouldInclude = (value?: string) => Boolean(value) && value !== 'ALL';

export function buildAnalyticsExportUrl(filters: AnalyticsExportFilters): string {
  const params = new URLSearchParams();
  params.append('format', 'csv');
  params.append('window', `${filters.windowDays}`);

  if (shouldInclude(filters.teamId)) params.append('team', filters.teamId as string);
  if (shouldInclude(filters.serviceId)) params.append('service', filters.serviceId as string);
  if (shouldInclude(filters.assigneeId)) params.append('assignee', filters.assigneeId as string);
  if (shouldInclude(filters.status)) params.append('status', filters.status as string);
  if (shouldInclude(filters.urgency)) params.append('urgency', filters.urgency as string);

  return `/api/analytics/export?${params.toString()}`;
}
