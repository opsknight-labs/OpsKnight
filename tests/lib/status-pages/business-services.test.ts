import { describe, expect, it } from 'vitest';
import {
  buildPublicBusinessServices,
  mergeHistorySegments,
} from '@/lib/status-pages/business-services';
import type { PublicStatusService } from '@/lib/status-pages/public-contract';
import { publicStatusPageSnapshotSchema } from '@/lib/status-pages/public-contract-schema';

const window = (percentage: number | null, overrides = {}) => ({
  percentage,
  incidentCount: 1,
  measuredDays: 90,
  complete: true,
  ...overrides,
});
const service = (
  id: string,
  overrides: Partial<PublicStatusService> = {}
): PublicStatusService => ({
  id,
  name: id,
  status: 'OPERATIONAL',
  activeIncidentCount: 0,
  uptime: { days30: window(100), days90: window(99.95) },
  history: {
    rangeStart: '2026-08-24T00:00:00.000Z',
    rangeEnd: '2026-11-22T00:00:00.000Z',
    coverage: 'COMPLETE',
    segments: [],
  },
  ...overrides,
});

describe('mergeHistorySegments', () => {
  it('keeps the worst status where members overlap and joins equal neighbours', () => {
    expect(
      mergeHistorySegments([
        [{ startAt: '2026-11-01T00:00:00Z', endAt: '2026-11-01T02:00:00Z', status: 'DEGRADED' }],
        [
          {
            startAt: '2026-11-01T01:00:00Z',
            endAt: '2026-11-01T03:00:00Z',
            status: 'MAJOR_OUTAGE',
          },
          {
            startAt: '2026-11-01T03:00:00Z',
            endAt: '2026-11-01T04:00:00Z',
            status: 'MAJOR_OUTAGE',
          },
        ],
      ])
    ).toEqual([
      {
        startAt: '2026-11-01T00:00:00.000Z',
        endAt: '2026-11-01T01:00:00.000Z',
        status: 'DEGRADED',
      },
      {
        startAt: '2026-11-01T01:00:00.000Z',
        endAt: '2026-11-01T04:00:00.000Z',
        status: 'MAJOR_OUTAGE',
      },
    ]);
  });

  it('leaves operational gaps out', () => {
    expect(
      mergeHistorySegments([
        [{ startAt: '2026-11-01T00:00:00Z', endAt: '2026-11-01T01:00:00Z', status: 'DEGRADED' }],
        [{ startAt: '2026-11-01T05:00:00Z', endAt: '2026-11-01T06:00:00Z', status: 'MAINTENANCE' }],
      ]).map(segment => segment.status)
    ).toEqual(['DEGRADED', 'MAINTENANCE']);
    expect(mergeHistorySegments([[], []])).toEqual([]);
  });
});

describe('buildPublicBusinessServices', () => {
  const services = [
    service('api', {
      status: 'PARTIAL_OUTAGE',
      statusSince: '2026-11-21T10:00:00.000Z',
      activeIncidentCount: 2,
      uptime: { days30: window(98.5, { grade: 'BELOW_TARGET' }), days90: window(99.2) },
    }),
    service('db', { statusSince: '2026-11-20T00:00:00.000Z' }),
    service('cdn', { status: 'DEGRADED', statusSince: '2026-11-21T09:00:00.000Z' }),
  ];

  it('takes the worst member status, weakest uptime and summed incidents', () => {
    const [checkout] = buildPublicBusinessServices(
      [{ id: 'b1', name: 'Checkout', memberServiceIds: ['api', 'db', 'cdn'] }],
      services
    );
    expect(checkout).toMatchObject({
      id: 'b1',
      name: 'Checkout',
      status: 'PARTIAL_OUTAGE',
      statusSince: '2026-11-21T10:00:00.000Z',
      memberServiceIds: ['api', 'db', 'cdn'],
      activeIncidentCount: 2,
      impactedServiceCount: 2,
    });
    expect(checkout.uptime?.days30).toEqual({
      percentage: 98.5,
      incidentCount: 3,
      measuredDays: 90,
      complete: true,
      grade: 'BELOW_TARGET',
    });
    expect(checkout.history?.coverage).toBe('COMPLETE');
  });

  it('reports operational since the last member recovered', () => {
    const [group] = buildPublicBusinessServices(
      [{ id: 'b2', name: 'Data', memberServiceIds: ['db', 'missing'] }],
      services
    );
    expect(group).toMatchObject({ status: 'OPERATIONAL', memberServiceIds: ['db'] });
    expect(group.statusSince).toBe('2026-11-20T00:00:00.000Z');
  });

  it('drops a business service with no published member instead of calling it healthy', () => {
    expect(
      buildPublicBusinessServices([{ id: 'b3', name: 'Ghost', memberServiceIds: ['x'] }], services)
    ).toEqual([]);
  });
});

describe('public contract', () => {
  const base = {
    schemaVersion: 3,
    pageId: 'page-1',
    revision: '1',
    generatedAt: '2026-11-22T00:00:00.000Z',
    page: {
      id: 'page-1',
      name: 'Status',
      showSubscribe: true,
      showServicesByRegion: false,
      showRegionHeatmap: false,
      showPostIncidentReview: false,
      showChangelog: false,
      enableUptimeExports: false,
      isDefault: true,
      requireAuth: false,
      enabled: true,
      statusApiRequireToken: false,
      statusApiRateLimitEnabled: false,
      statusApiRateLimitMax: 120,
      statusApiRateLimitWindowSec: 60,
    },
    status: 'OPERATIONAL',
    services: [service('api')],
    regions: [],
    incidents: [],
    announcements: [],
    historyDays: 90,
  };

  it('accepts a flat snapshot without business services (schema 3 unchanged)', () => {
    expect(publicStatusPageSnapshotSchema.safeParse(base).success).toBe(true);
  });

  it('accepts the additive business layout and validates its rows', () => {
    const grouped = {
      ...base,
      page: { ...base.page, serviceLayout: 'BUSINESS_EXPANDABLE' },
      businessServices: buildPublicBusinessServices(
        [{ id: 'b1', name: 'Checkout', memberServiceIds: ['api'] }],
        [service('api')]
      ),
    };
    expect(publicStatusPageSnapshotSchema.safeParse(grouped).success).toBe(true);
    const broken = { ...grouped, businessServices: [{ id: 'b1', name: 'Checkout' }] };
    expect(publicStatusPageSnapshotSchema.safeParse(broken).success).toBe(false);
    expect(
      publicStatusPageSnapshotSchema.safeParse({
        ...grouped,
        page: { ...grouped.page, serviceLayout: 'TREE' },
      }).success
    ).toBe(false);
  });
});
