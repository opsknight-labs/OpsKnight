import type { IncidentStatus, IncidentUrgency } from '@prisma/client';
import type { IncidentListFilter } from './incidents-query';

type IncidentListHrefOptions = {
  basePath?: '/incidents' | '/m/incidents';
  filter?: IncidentListFilter;
  status?: IncidentStatus;
  urgency?: IncidentUrgency;
  assignee?: string | 'unassigned';
  serviceId?: string;
  teamId?: string;
  createdAfter?: string;
  createdBefore?: string;
};

export function buildIncidentListHref({
  basePath = '/incidents',
  filter,
  status,
  urgency,
  assignee,
  serviceId,
  teamId,
  createdAfter,
  createdBefore,
}: IncidentListHrefOptions = {}): string {
  const params = new URLSearchParams();
  if (filter && filter !== 'all') params.set('filter', filter);
  if (status) params.set('status', status);
  if (urgency) params.set('urgency', urgency);
  if (assignee) params.set('assignee', assignee);
  if (serviceId) params.set('serviceId', serviceId);
  if (teamId) params.set('teamId', teamId);
  if (createdAfter) params.set('createdAfter', createdAfter);
  if (createdBefore) params.set('createdBefore', createdBefore);

  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
}
