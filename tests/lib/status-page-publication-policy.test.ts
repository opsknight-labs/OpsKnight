/* eslint-disable security/detect-object-injection -- fixture keys come from the
   exported classifier tables, not from input. */
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import {
  classifyStatusPageChange,
  STATUS_PAGE_CONTENT_FIELDS,
  STATUS_PAGE_DISCLOSURE_BOOLEANS,
  STATUS_PAGE_DISCLOSURE_BOUNDS,
  STATUS_PAGE_PRESENTATION_FIELDS,
  STATUS_PAGE_RESTRICTION_BOOLEANS,
  STATUS_PAGE_ROUTING_FIELDS,
  type StatusPageClassifierState,
} from '@/lib/status-pages/publication-policy';

const baseline: StatusPageClassifierState = {
  enabled: true,
  slug: 'status',
  isDefault: false,
  subdomain: null,
  customDomain: null,
  name: 'Status',
  organizationName: 'Acme',
  privacyMode: 'PUBLIC',
  requireAuth: false,
  authProvider: null,
  statusApiRequireToken: false,
  statusApiRateLimitEnabled: false,
  statusApiRateLimitMax: 120,
  statusApiRateLimitWindowSec: 60,
  maxIncidentsToShow: 50,
  incidentHistoryDays: 90,
  dataRetentionDays: null,
  allowedCustomFields: ['env'],
  branding: { primaryColor: '#111111', layout: 'default' },
  uptimeExcellentThreshold: 99.9,
  uptimeGoodThreshold: 99,
  footerText: null,
  contactEmail: null,
  contactUrl: null,
  emailProvider: null,
  showSubscribe: true,
  showServicesByRegion: false,
  showRegionHeatmap: false,
  showChangelog: true,
  serviceMappings: [
    { serviceId: 'svc-a', showOnPage: true, displayName: null, order: 0 },
    { serviceId: 'svc-b', showOnPage: true, displayName: null, order: 1 },
  ],
};

for (const field of STATUS_PAGE_DISCLOSURE_BOOLEANS) baseline[field] = true;
for (const field of STATUS_PAGE_RESTRICTION_BOOLEANS) baseline[field] = false;

const classify = (
  patch: Record<string, unknown>,
  extra: Partial<Parameters<typeof classifyStatusPageChange>[0]> = {}
) => classifyStatusPageChange({ current: baseline, patch, ...extra });

describe('classifyStatusPageChange', () => {
  it('treats a branding-only save as presentation and keeps the page live', () => {
    // The regression this whole module exists for: changing a colour used to revoke publication.
    const result = classify({ branding: { primaryColor: '#ff0000', layout: 'default' } });
    expect(result.classes).toEqual(['PRESENTATION']);
    expect(result.failClosed).toBe(false);
    expect(result.revocationReason).toBe('SUPERSEDED');
  });

  it('reports no change for a patch that matches current state', () => {
    const result = classify({
      branding: { layout: 'default', primaryColor: '#111111' },
      slug: 'status',
      name: 'Status',
      maxIncidentsToShow: 50,
    });
    expect(result.classes).toEqual([]);
    expect(result.revocationReason).toBeNull();
    expect(result.failClosed).toBe(false);
  });

  it('ignores whitespace-only text differences', () => {
    expect(classify({ organizationName: '  Acme  ' }).classes).toEqual([]);
    expect(classify({ footerText: '' }).classes).toEqual([]);
  });

  it('ignores branding key reordering', () => {
    expect(classify({ branding: { layout: 'default', primaryColor: '#111111' } }).classes).toEqual(
      []
    );
  });

  describe.each(STATUS_PAGE_DISCLOSURE_BOOLEANS)('disclosure boolean %s', field => {
    it('tightens when turned off and relaxes when turned on', () => {
      expect(classify({ [field]: false }).dominant).toBe('PRIVACY_TIGHTENING');
      expect(
        classifyStatusPageChange({
          current: { ...baseline, [field]: false },
          patch: { [field]: true },
        }).dominant
      ).toBe('PRIVACY_RELAXING');
    });
  });

  describe.each(STATUS_PAGE_RESTRICTION_BOOLEANS)('restriction boolean %s', field => {
    it('tightens when turned on and relaxes when turned off', () => {
      expect(classify({ [field]: true }).dominant).toBe('PRIVACY_TIGHTENING');
      expect(
        classifyStatusPageChange({
          current: { ...baseline, [field]: true },
          patch: { [field]: false },
        }).dominant
      ).toBe('PRIVACY_RELAXING');
    });
  });

  it('fails closed when the login wall is switched on', () => {
    // A previously published payload says requireAuth:false and the public route trusts it.
    expect(classify({ requireAuth: true }).failClosed).toBe(true);
    expect(
      classifyStatusPageChange({
        current: { ...baseline, requireAuth: true },
        patch: { requireAuth: false },
      }).failClosed
    ).toBe(false);
  });

  it('classifies numeric windows by the direction that narrows disclosure', () => {
    expect(classify({ maxIncidentsToShow: 10 }).dominant).toBe('PRIVACY_TIGHTENING');
    expect(classify({ maxIncidentsToShow: 80 }).dominant).toBe('PRIVACY_RELAXING');
    expect(classify({ incidentHistoryDays: 30 }).dominant).toBe('PRIVACY_TIGHTENING');
    expect(classify({ statusApiRateLimitMax: 10 }).dominant).toBe('PRIVACY_TIGHTENING');
    // Same ceiling over a longer window allows fewer requests.
    expect(classify({ statusApiRateLimitWindowSec: 600 }).dominant).toBe('PRIVACY_TIGHTENING');
  });

  it('treats null retention as unbounded', () => {
    expect(classify({ dataRetentionDays: 30 }).dominant).toBe('PRIVACY_TIGHTENING');
    expect(
      classifyStatusPageChange({
        current: { ...baseline, dataRetentionDays: 30 },
        patch: { dataRetentionDays: null },
      }).dominant
    ).toBe('PRIVACY_RELAXING');
  });

  it('ignores an edit both values clamp to the same public bound', () => {
    // maxIncidentsToShow is capped at 100, so 999 and 500 are the same page.
    expect(
      classifyStatusPageChange({
        current: { ...baseline, maxIncidentsToShow: 999 },
        patch: { maxIncidentsToShow: 500 },
      }).classes
    ).toEqual([]);
  });

  it('orders privacy modes and assumes the strict direction for unordered ones', () => {
    expect(classify({ privacyMode: 'PRIVATE' }).dominant).toBe('PRIVACY_TIGHTENING');
    expect(
      classifyStatusPageChange({
        current: { ...baseline, privacyMode: 'PRIVATE' },
        patch: { privacyMode: 'PUBLIC' },
      }).dominant
    ).toBe('PRIVACY_RELAXING');
    expect(classify({ privacyMode: 'CUSTOM' }).dominant).toBe('PRIVACY_TIGHTENING');
    expect(
      classifyStatusPageChange({
        current: { ...baseline, privacyMode: 'CUSTOM' },
        patch: { privacyMode: 'PUBLIC' },
      }).dominant
    ).toBe('PRIVACY_TIGHTENING');
  });

  it('compares allowed custom fields as a set', () => {
    expect(classify({ allowedCustomFields: [] }).dominant).toBe('PRIVACY_TIGHTENING');
    expect(classify({ allowedCustomFields: ['env', 'tier'] }).dominant).toBe('PRIVACY_RELAXING');
    expect(classify({ allowedCustomFields: ['env'] }).classes).toEqual([]);
  });

  it('only treats an identity provider swap as tightening behind a login wall', () => {
    expect(classify({ authProvider: 'okta' }).dominant).toBe('CONTENT');
    expect(classify({ authProvider: 'okta', requireAuth: true }).dominant).toBe(
      'PRIVACY_TIGHTENING'
    );
    expect(
      classifyStatusPageChange({
        current: { ...baseline, requireAuth: true },
        patch: { authProvider: 'okta' },
      }).dominant
    ).toBe('PRIVACY_TIGHTENING');
  });

  it('classifies enable and disable', () => {
    expect(classify({ enabled: false }).dominant).toBe('DISABLE');
    expect(classify({ enabled: false }).revocationReason).toBe('DISABLED');
    expect(
      classifyStatusPageChange({
        current: { ...baseline, enabled: false },
        patch: { enabled: true },
      }).dominant
    ).toBe('ENABLE');
  });

  it('treats layout toggles as presentation and changelog hiding as disclosure tightening', () => {
    // These render data that showServiceRegions already gates.
    expect(classify({ showServicesByRegion: true }).classes).toEqual(['PRESENTATION']);
    expect(classify({ showRegionHeatmap: true }).classes).toEqual(['PRESENTATION']);
    expect(classify({ showChangelog: false }).classes).toEqual(['PRIVACY_TIGHTENING']);
  });

  describe('route deltas', () => {
    it('adds the new key and removes the old on a slug rename', () => {
      const result = classify({ slug: 'health' });
      expect(result.dominant).toBe('ROUTING');
      expect(result.routes).toEqual({ added: ['health'], removed: ['status'] });
    });

    it('removes without adding when a slug is cleared', () => {
      expect(classify({ slug: null }).routes).toEqual({ added: [], removed: ['status'] });
    });

    it('prefixes domain and subdomain keys and lowercases them', () => {
      expect(classify({ customDomain: 'Status.Example.COM' }).routes.added).toEqual([
        'domain:status.example.com',
      ]);
      expect(classify({ subdomain: 'Acme' }).routes.added).toEqual(['subdomain:acme']);
    });

    it('tracks the default route in both directions', () => {
      expect(classify({ isDefault: true }).routes).toEqual({ added: ['default'], removed: [] });
      expect(
        classifyStatusPageChange({
          current: { ...baseline, isDefault: true },
          patch: { isDefault: false },
        }).routes
      ).toEqual({ added: [], removed: ['default'] });
    });
  });

  describe('service mappings', () => {
    const ids = ['svc-a', 'svc-b'];

    it('tightens when a service is removed', () => {
      expect(classify({}, { serviceIds: ['svc-a'] }).dominant).toBe('PRIVACY_TIGHTENING');
    });

    it('relaxes when a service is added', () => {
      expect(classify({}, { serviceIds: [...ids, 'svc-c'] }).dominant).toBe('PRIVACY_RELAXING');
    });

    it('tightens when a mapping is hidden and relaxes when shown', () => {
      expect(
        classify({}, { serviceIds: ids, serviceConfigs: { 'svc-a': { showOnPage: false } } })
          .dominant
      ).toBe('PRIVACY_TIGHTENING');
      expect(
        classifyStatusPageChange({
          current: {
            ...baseline,
            serviceMappings: [
              { serviceId: 'svc-a', showOnPage: false, displayName: null, order: 0 },
            ],
          },
          patch: {},
          serviceIds: ['svc-a'],
          serviceConfigs: { 'svc-a': { showOnPage: true } },
        }).dominant
      ).toBe('PRIVACY_RELAXING');
    });

    it('treats a rename or reorder as presentation', () => {
      const configs = {
        'svc-a': { displayName: 'Checkout', order: 0 },
        'svc-b': { order: 1 },
      };
      expect(classify({}, { serviceIds: ids, serviceConfigs: configs }).classes).toEqual([
        'PRESENTATION',
      ]);
    });

    it('reports no change when mappings are resubmitted unchanged', () => {
      const configs = { 'svc-a': { order: 0 }, 'svc-b': { order: 1 } };
      expect(classify({}, { serviceIds: ids, serviceConfigs: configs }).classes).toEqual([]);
    });
  });

  it('lets the most restrictive component govern a mixed patch', () => {
    const result = classify(
      { branding: { primaryColor: '#00ff00' }, footerText: 'Hello' },
      { serviceIds: ['svc-a'] }
    );
    expect(result.dominant).toBe('PRIVACY_TIGHTENING');
    expect(result.failClosed).toBe(true);
    expect(result.classes).toEqual(['PRIVACY_TIGHTENING', 'CONTENT', 'PRESENTATION']);
  });

  it('reports every field it acted on', () => {
    const result = classify({ showIncidentTitles: false, footerText: 'Hi' });
    expect([...result.changedFields].sort()).toEqual(['footerText', 'showIncidentTitles']);
  });
});

describe('classifier coverage', () => {
  it('classifies every disclosure-capable StatusPage column', () => {
    // Without this, a new column silently defaults to "no class" and its changes stop failing
    // closed, which is exactly the failure mode this module was written to prevent.
    const schema = fs.readFileSync('prisma/schema.prisma', 'utf8');
    const model = schema.slice(schema.indexOf('model StatusPage {'));
    const body = model.slice(0, model.indexOf('\n}'));

    const classified = new Set<string>([
      ...STATUS_PAGE_DISCLOSURE_BOOLEANS,
      ...STATUS_PAGE_RESTRICTION_BOOLEANS,
      ...STATUS_PAGE_DISCLOSURE_BOUNDS.map(bound => bound.field),
      ...STATUS_PAGE_ROUTING_FIELDS,
      ...STATUS_PAGE_CONTENT_FIELDS,
      ...STATUS_PAGE_PRESENTATION_FIELDS,
      'enabled',
      'privacyMode',
      'allowedCustomFields',
      'authProvider',
    ]);

    // Identity, timestamps, revision metadata and relations are not settings and carry no disclosure policy.
    const notSettings = new Set(['id', 'createdAt', 'updatedAt', 'revision']);

    const unclassified = body
      .split('\n')
      .map(line => line.trim())
      .filter(line => /^[a-zA-Z]\w*\s+(Boolean|Int|Float|String|Json)(\s|\?|$)/.test(line))
      .map(line => line.split(/\s+/)[0])
      .filter(field => !classified.has(field) && !notSettings.has(field));

    expect(unclassified).toEqual([]);
  });
});
