import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Enforces the settings → V3 contract boundary so the admin surface can never drift from what the
 * public page actually renders.
 *
 * Two failures this guards against:
 *  1. An internal-only concept (custom fields, assignees) silently leaking into a public surface.
 *  2. A public disclosure toggle quietly losing its wiring, so flipping it in settings stops
 *     affecting the published payload.
 */

// Settings that exist in the admin/DB but are deliberately NOT part of the public V3 contract.
const INTERNAL_ONLY =
  /showCustomFields|showIncidentAssignees|allowedCustomFields|customField|assignee/i;

describe('status-page settings → V3 parity', () => {
  it('never exposes internal-only settings publicly', () => {
    expect(INTERNAL_ONLY.test(readFileSync('src/lib/status-pages/snapshot.ts', 'utf8'))).toBe(
      false
    );
    expect(INTERNAL_ONLY.test(readFileSync('src/lib/status-page-public-data.ts', 'utf8'))).toBe(
      false
    );
    expect(INTERNAL_ONLY.test(readFileSync('src/lib/status-pages/presentation.ts', 'utf8'))).toBe(
      false
    );
    expect(
      INTERNAL_ONLY.test(readFileSync('src/lib/status-pages/event-projection.ts', 'utf8'))
    ).toBe(false);
  });

  it('keeps every public disclosure flag wired into the incident serializer', () => {
    const source = readFileSync('src/lib/status-page-public-data.ts', 'utf8');
    for (const flag of [
      'showIncidents',
      'showRecentIncidents',
      'showServiceMetrics',
      'showUptimeHistory',
      'showServiceSlaTier',
      'showTeamInformation',
      'showServiceOwners',
      'showIncidentDetails',
      'showIncidentTitles',
      'showIncidentDescriptions',
      'showAffectedServices',
      'showIncidentTimestamps',
      'showIncidentUrgency',
      'showPostIncidentReview',
    ]) {
      expect(source.includes(flag), `publicStatusVisibility must consume ${flag}`).toBe(true);
    }
  });

  it('keeps every status-page chrome/presentation field in the branding projector', () => {
    const source = readFileSync('src/lib/status-pages/branding.ts', 'utf8');
    for (const flag of [
      'layout',
      'showHeader',
      'showFooter',
      'autoRefresh',
      'refreshInterval',
      'showApiLink',
      'showRssLink',
    ]) {
      expect(source.includes(flag), `branding projector must preserve ${flag}`).toBe(true);
    }
  });

  it('keeps every page-level toggle wired into the projector', () => {
    const source = readFileSync('src/lib/status-pages/snapshot.ts', 'utf8');
    for (const flag of [
      'showServiceDescriptions',
      'showServiceRegions',
      'showAffectedServices',
      'showChangelog',
      'showPostIncidentReview',
      'enableUptimeExports',
      'uptimeExcellentThreshold',
      'uptimeGoodThreshold',
      'showSubscribe',
    ]) {
      expect(source.includes(flag), `projector must consume ${flag}`).toBe(true);
    }
  });

  it('does not read daily rollups on the snapshot path', () => {
    const source = readFileSync('src/lib/status-pages/snapshot.ts', 'utf8');
    expect(source.includes('rollup-store')).toBe(false);
    expect(source.includes('rollup-engine')).toBe(false);
    expect(source.includes('loadCurrentIncidentsByService')).toBe(true);
    expect(source.includes('needsHistory')).toBe(true);
    expect(source.includes('isActive: true')).toBe(true);
    expect(source.includes('loadDisplayFeed')).toBe(true);
    expect(source.includes('currentAnnouncementDisplayWhere')).toBe(true);
    expect(source.includes('maintenanceInProgressDisplayWhere')).toBe(true);
  });
});
