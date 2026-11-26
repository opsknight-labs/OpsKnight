import { describe, expect, it } from 'vitest';
import { buildPreviewSnapshot } from '@/lib/status-pages/preview-snapshot';

const base = {
  pageId: 'preview',
  services: [
    { id: 'api', name: 'API' },
    { id: 'db', name: 'Database' },
    { id: 'cdn', name: 'CDN' },
  ],
  // Page order: db before api.
  mappings: [
    { serviceId: 'db', showOnPage: true },
    { serviceId: 'api', showOnPage: true },
    { serviceId: 'cdn', showOnPage: true },
  ],
  incidents: [],
  announcements: [],
  uptime90: {},
  privacy: null,
  showServices: true,
  showIncidents: true,
  thresholds: { uptimeExcellent: 99.9, uptimeGood: 99 },
  now: new Date('2026-11-26T12:00:00.000Z'),
};

describe('buildPreviewSnapshot business services', () => {
  it('builds group rows from the unsaved layout, members in page order, with demo history', () => {
    const snapshot = buildPreviewSnapshot({
      ...base,
      serviceLayout: 'BUSINESS_EXPANDABLE',
      expandGroupsByDefault: true,
      businessServices: [
        { id: 'checkout', name: 'Checkout', memberServiceIds: ['api', 'db'] },
        { id: 'edge', name: 'Edge', memberServiceIds: ['cdn'], parentIds: ['checkout'] },
      ],
    });
    expect(snapshot.services.map(service => service.id)).toEqual(['db', 'api', 'cdn']);
    expect(snapshot.page.serviceLayout).toBe('BUSINESS_EXPANDABLE');
    expect(snapshot.page.expandGroupsByDefault).toBe(true);
    const [checkout, edge] = snapshot.businessServices ?? [];
    expect(checkout).toMatchObject({
      memberServiceIds: ['db', 'api'],
      memberCount: 2,
      status: 'OPERATIONAL',
      childIds: ['edge'],
    });
    expect(checkout.history).toBeDefined();
    expect(checkout.uptime?.days90.percentage).toBe(100);
    expect(edge.parentId).toBe('checkout');
  });

  it('conceals members of a group that hides them, as the published page does', () => {
    const snapshot = buildPreviewSnapshot({
      ...base,
      serviceLayout: 'BUSINESS_EXPANDABLE',
      businessServices: [
        { id: 'checkout', name: 'Checkout', memberServiceIds: ['api'], showMembers: false },
      ],
    });
    expect(snapshot.services.map(service => service.id)).toEqual(['db', 'cdn']);
    expect(snapshot.businessServices?.[0]).toMatchObject({ memberServiceIds: [], memberCount: 1 });
  });

  it('adds no business services on a flat page', () => {
    const snapshot = buildPreviewSnapshot({
      ...base,
      serviceLayout: 'FLAT',
      businessServices: [{ id: 'checkout', name: 'Checkout', memberServiceIds: ['api'] }],
    });
    expect(snapshot.businessServices).toBeUndefined();
  });
});
