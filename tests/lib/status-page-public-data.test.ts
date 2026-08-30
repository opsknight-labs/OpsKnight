import { describe, expect, it } from 'vitest';
import {
  publicStatusVisibility,
  serializePublicStatusApiIncident,
  serializePublicStatusIncident,
  type StatusPagePublicSettings,
} from '@/lib/status-page-public-data';

const privateSettings: StatusPagePublicSettings = {
  showServices: true,
  showIncidents: true,
  showMetrics: true,
  showIncidentDetails: false,
  showIncidentTitles: true,
  showIncidentDescriptions: false,
  showAffectedServices: true,
  showIncidentTimestamps: false,
  showServiceMetrics: false,
  showServiceRegions: false,
  showServiceOwners: false,
  showServiceSlaTier: false,
  showTeamInformation: false,
  showIncidentUrgency: false,
  showUptimeHistory: false,
  showRecentIncidents: true,
};

describe('status page public-data policy', () => {
  it('removes fields hidden by a private status-page configuration', () => {
    expect(
      serializePublicStatusIncident(
        {
          id: 'inc-1',
          title: 'Database latency',
          description: 'Internal diagnostic detail',
          status: 'OPEN',
          urgency: 'HIGH',
          createdAt: new Date('2026-08-30T10:00:00.000Z'),
          resolvedAt: null,
          service: { name: 'Payments', region: 'us-east-1' },
        },
        privateSettings
      )
    ).toEqual({
      status: 'OPEN',
      title: 'Database latency',
      service: { name: 'Payments' },
    });
  });

  it('does not expose incidents or uptime when their parent sections are hidden', () => {
    const visibility = publicStatusVisibility({
      ...privateSettings,
      showIncidents: false,
      showMetrics: false,
    });

    expect(visibility.showIncidents).toBe(false);
    expect(visibility.showMetrics).toBe(false);
    expect(visibility.showUptime).toBe(false);
  });

  it('preserves the established status API service field shape without exposing hidden data', () => {
    expect(
      serializePublicStatusApiIncident(
        {
          id: 'inc-1',
          title: 'Database latency',
          description: 'Internal diagnostic detail',
          status: 'OPEN',
          urgency: 'HIGH',
          createdAt: new Date('2026-08-30T10:00:00.000Z'),
          resolvedAt: null,
          service: { name: 'Payments', region: 'us-east-1' },
        },
        privateSettings
      )
    ).toEqual({ status: 'OPEN', title: 'Database latency', service: 'Payments' });
  });
});
