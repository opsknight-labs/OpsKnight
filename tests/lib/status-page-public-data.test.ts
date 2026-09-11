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

  it('publishes only a boolean post-incident-review capability marker', () => {
    const incident = {
      id: 'inc-1',
      title: 'Database latency',
      status: 'RESOLVED',
      createdAt: new Date('2026-08-30T10:00:00.000Z'),
      resolvedAt: new Date('2026-08-30T11:00:00.000Z'),
      postmortem: { status: 'PUBLISHED', isPublic: true },
    };

    expect(
      serializePublicStatusIncident(incident, {
        ...privateSettings,
        showPostIncidentReview: true,
      })
    ).toMatchObject({ postIncidentReview: true });
    expect(
      serializePublicStatusIncident(incident, {
        ...privateSettings,
        showPostIncidentReview: false,
      })
    ).not.toHaveProperty('postIncidentReview');
    expect(
      serializePublicStatusIncident(
        { ...incident, postmortem: { status: 'DRAFT', isPublic: true } },
        { ...privateSettings, showPostIncidentReview: true }
      )
    ).not.toHaveProperty('postIncidentReview');
  });

  it('never forwards internal IncidentEvent free text to public incident updates', () => {
    const at = new Date('2026-08-30T10:05:00.000Z');
    const result = serializePublicStatusIncident(
      {
        id: 'inc-1',
        title: 'Database latency',
        description: 'Customer-visible description',
        status: 'RESOLVED',
        urgency: 'HIGH',
        createdAt: new Date('2026-08-30T10:00:00.000Z'),
        resolvedAt: new Date('2026-08-30T11:00:00.000Z'),
        events: [
          {
            id: 'event-assignment',
            type: 'ASSIGNMENT',
            message: 'Incident assigned to Alice from the Payments team',
            createdAt: at,
          },
          {
            id: 'event-status-change',
            type: 'STATUS_CHANGE',
            message: 'Jira OPS-123 linked and war room #secret-channel created',
            createdAt: at,
          },
          {
            id: 'event-ack',
            type: 'ACKNOWLEDGED',
            message: 'Incident acknowledged by Alice',
            createdAt: at,
          },
          {
            id: 'event-resolved',
            type: 'MANUAL_RESOLVED',
            message: 'Resolved: rotated secret credential from internal runbook',
            createdAt: at,
          },
        ],
      },
      {
        ...privateSettings,
        showIncidentDetails: true,
        showIncidentDescriptions: true,
        showIncidentTimestamps: true,
      },
      { pageId: 'page-1' }
    );

    expect(result.updates).toEqual([
      {
        id: expect.stringMatching(/^evt_[0-9a-f]{32}$/),
        type: 'ACKNOWLEDGED',
        message: 'Incident acknowledged',
        createdAt: at.toISOString(),
      },
      {
        id: expect.stringMatching(/^evt_[0-9a-f]{32}$/),
        type: 'RESOLVED',
        message: 'Incident resolved',
        createdAt: at.toISOString(),
      },
    ]);
    expect(JSON.stringify(result)).not.toContain('Alice');
    expect(JSON.stringify(result)).not.toContain('OPS-123');
    expect(JSON.stringify(result)).not.toContain('secret credential');
  });
});
