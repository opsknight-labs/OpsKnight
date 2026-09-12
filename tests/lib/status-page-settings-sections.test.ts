import { describe, expect, it } from 'vitest';
import { statusPageSectionPatch } from '@/lib/status-pages/settings-sections';

describe('status page section mutation boundaries', () => {
  it('prevents an appearance save from carrying access or service changes', () => {
    expect(
      statusPageSectionPatch('appearance', {
        id: 'page',
        expectedUpdatedAt: '2026-09-07T00:00:00.000Z',
        branding: { primaryColor: '#000000' },
        requireAuth: false,
        serviceIds: ['internal'],
      })
    ).toEqual({
      id: 'page',
      expectedUpdatedAt: '2026-09-07T00:00:00.000Z',
      branding: { primaryColor: '#000000' },
    });
  });

  it('does not persist browser-local history timezone preferences', () => {
    expect(
      statusPageSectionPatch('general', {
        id: 'page',
        name: 'Public status',
        timeZone: 'America/New_York',
      })
    ).toEqual({ id: 'page', name: 'Public status' });
  });

  it('rejects sections that own their own independent controls', () => {
    expect(() => statusPageSectionPatch('subscribers', {})).toThrow();
  });

  it('preserves contactEmail and contactUrl under general section', () => {
    expect(
      statusPageSectionPatch('general', {
        id: 'page',
        name: 'OpsKnight Status',
        contactEmail: 'support@opsknight.com',
        contactUrl: 'https://opsknight.com/support',
        uptimeGoodThreshold: 99.0, // should be dropped from general
      })
    ).toEqual({
      id: 'page',
      name: 'OpsKnight Status',
      contactEmail: 'support@opsknight.com',
      contactUrl: 'https://opsknight.com/support',
    });
  });

  it('preserves showServices, uptime thresholds, branding, and incident flags under content section', () => {
    expect(
      statusPageSectionPatch('content', {
        id: 'page',
        showServices: true,
        showIncidents: true,
        showMetrics: true,
        showSubscribe: true,
        uptimeExcellentThreshold: 99.9,
        uptimeGoodThreshold: 99.0,
        branding: { metaTitle: 'Status Meta', metaDescription: 'Status Description' },
        showRecentIncidents: true,
        showServiceMetrics: true,
        customDomain: 'status.example.com', // should be dropped from content
      })
    ).toEqual({
      id: 'page',
      showServices: true,
      showIncidents: true,
      showMetrics: true,
      showSubscribe: true,
      uptimeExcellentThreshold: 99.9,
      uptimeGoodThreshold: 99.0,
      branding: { metaTitle: 'Status Meta', metaDescription: 'Status Description' },
      showRecentIncidents: true,
      showServiceMetrics: true,
    });
  });

  it('preserves custom fields and incident assignees in privacy section', () => {
    expect(
      statusPageSectionPatch('privacy', {
        id: 'page',
        privacyMode: 'RESTRICTED',
        showCustomFields: true,
        showIncidentAssignees: false,
        allowedCustomFields: ['team', 'env'],
        slug: 'should-be-dropped',
      })
    ).toEqual({
      id: 'page',
      privacyMode: 'RESTRICTED',
      showCustomFields: true,
      showIncidentAssignees: false,
      allowedCustomFields: ['team', 'env'],
    });
  });

  it('preserves branding live feed preferences in advanced section', () => {
    expect(
      statusPageSectionPatch('advanced', {
        id: 'page',
        branding: { autoRefresh: true, refreshInterval: 60, showRssLink: true },
        enableUptimeExports: true,
        statusApiRequireToken: true,
        name: 'dropped-from-advanced',
      })
    ).toEqual({
      id: 'page',
      branding: { autoRefresh: true, refreshInterval: 60, showRssLink: true },
      enableUptimeExports: true,
      statusApiRequireToken: true,
    });
  });
});
