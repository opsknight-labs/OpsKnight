import { describe, expect, it } from 'vitest';
import {
  activeIncidentStatuses,
  activeIncidentStatusesForFilter,
  isActiveIncidentStatus,
  incidentStatusLabel,
  mutedIncidentStatuses,
} from '@/lib/incident-status';

describe('incident status contract', () => {
  it('defines active and muted states without overlap', () => {
    expect(activeIncidentStatuses()).toEqual(['OPEN', 'ACKNOWLEDGED']);
    expect(mutedIncidentStatuses()).toEqual(['SNOOZED', 'SUPPRESSED']);
  });

  it('never treats resolved or muted filters as active', () => {
    expect(activeIncidentStatusesForFilter('RESOLVED')).toEqual([]);
    expect(activeIncidentStatusesForFilter('SNOOZED')).toEqual([]);
    expect(activeIncidentStatusesForFilter('SUPPRESSED')).toEqual([]);
  });

  it('can narrow active metrics to a strict active state', () => {
    expect(activeIncidentStatusesForFilter('ACTIVE')).toEqual(['OPEN', 'ACKNOWLEDGED']);
    expect(activeIncidentStatusesForFilter('OPEN')).toEqual(['OPEN']);
    expect(activeIncidentStatusesForFilter('ACKNOWLEDGED')).toEqual(['ACKNOWLEDGED']);
    expect(isActiveIncidentStatus('ACKNOWLEDGED')).toBe(true);
    expect(isActiveIncidentStatus('RESOLVED')).toBe(false);
  });

  it('uses Triggered as the user-facing name for strict OPEN state', () => {
    expect(incidentStatusLabel('OPEN')).toBe('Triggered');
    expect(incidentStatusLabel('ACKNOWLEDGED')).toBe('Acknowledged');
  });
});
