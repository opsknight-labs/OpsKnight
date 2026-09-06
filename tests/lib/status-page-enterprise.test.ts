import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  StatusAnnouncementCreateSchema,
  StatusPageBrandingSchema,
  StatusPageSettingsSchema,
} from '@/lib/validation';

const mocks = vi.hoisted(() => ({
  statusPageFindFirst: vi.fn(),
  mappingFindFirst: vi.fn(),
  tokenFindFirst: vi.fn(),
  tokenUpdateMany: vi.fn(),
  tokenUpdate: vi.fn(),
  rateLimit: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    statusPage: { findFirst: mocks.statusPageFindFirst },
    statusPageService: { findFirst: mocks.mappingFindFirst },
    statusPageApiToken: {
      findFirst: mocks.tokenFindFirst,
      updateMany: mocks.tokenUpdateMany,
      update: mocks.tokenUpdate,
    },
  },
}));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: mocks.rateLimit }));
vi.mock('@/lib/api-keys', () => ({
  hashTokenV2: () => 'v2-hash',
  hashLegacyScryptToken: async () => 'v1-hash',
}));

import { resolveStatusPage, statusPageSlugMatches } from '@/lib/status-page-resolver';
import { canPublishIncidentToStatusPage } from '@/lib/status-page-publication';
import { authorizeStatusApiRequest } from '@/lib/status-api-auth';
import {
  activeMaintenanceServiceIds,
  projectOverallStatus,
  projectServiceStatus,
  statusProjectionClock,
  visibleMaintenanceServiceIds,
  visibleStatusPageMappings,
} from '@/lib/status-page-projection';

describe('enterprise status-page contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rateLimit.mockResolvedValue({ allowed: true, resetAt: Date.now() + 60_000 });
    mocks.tokenFindFirst.mockResolvedValue(null);
  });

  it('resolves the legacy route only to the enabled default page', async () => {
    mocks.statusPageFindFirst.mockResolvedValue({ id: 'page-default' });
    await expect(resolveStatusPage()).resolves.toEqual({ id: 'page-default' });
    expect(mocks.statusPageFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { isDefault: true, enabled: true },
      })
    );
  });

  it('does not fall through from a disabled default page to another enabled page', async () => {
    mocks.statusPageFindFirst.mockResolvedValue(null);
    await expect(resolveStatusPage()).resolves.toBeNull();
    expect(mocks.statusPageFindFirst).toHaveBeenCalledTimes(1);
    expect(mocks.statusPageFindFirst).toHaveBeenCalledWith({
      where: { isDefault: true, enabled: true },
    });
  });

  it('binds verification and unsubscribe tokens to the slug in the route', () => {
    expect(statusPageSlugMatches('page-a', 'page-a')).toBe(true);
    expect(statusPageSlugMatches('page-a', 'page-b')).toBe(false);
    expect(statusPageSlugMatches('page-a')).toBe(true);
  });

  it('fails closed unless page, mapping, service and public incident authorize a postmortem', async () => {
    mocks.mappingFindFirst.mockResolvedValue(null);
    await expect(
      canPublishIncidentToStatusPage('page-a', 'incident-private', 'postmortem')
    ).resolves.toBe(false);
    expect(mocks.mappingFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          statusPageId: 'page-a',
          showOnPage: true,
          statusPage: expect.objectContaining({ enabled: true, showPostIncidentReview: true }),
          service: { incidents: { some: { id: 'incident-private', visibility: 'PUBLIC' } } },
        }),
      })
    );
  });

  it('rate-limits invalid bearer tokens by IP before credential work', async () => {
    const request = new NextRequest('https://status.example/api/status', {
      headers: {
        authorization: 'Bearer attacker-controlled-token',
        'x-forwarded-for': '203.0.113.9',
      },
    });
    await authorizeStatusApiRequest(request, 'page-a', {
      requireToken: false,
      rateLimitEnabled: true,
    });
    expect(mocks.rateLimit).toHaveBeenCalledTimes(1);
    expect(mocks.rateLimit.mock.calls[0]?.[0]).toContain('203.0.113.9');
  });

  it('enforces status-page domain and threshold invariants', () => {
    expect(
      StatusPageSettingsSchema.safeParse({ customDomain: 'https://bad.example' }).success
    ).toBe(false);
    expect(
      StatusPageSettingsSchema.safeParse({ uptimeExcellentThreshold: 98, uptimeGoodThreshold: 99 })
        .success
    ).toBe(false);
    expect(
      StatusAnnouncementCreateSchema.safeParse({
        statusPageId: 'p',
        title: 'Maintenance',
        message: 'Window',
        startDate: '2026-09-06T12:00:00Z',
        endDate: '2026-09-06T11:00:00Z',
      }).success
    ).toBe(false);
  });

  it('bounds and validates the versioned branding contract without breaking legacy keys', () => {
    expect(
      StatusPageBrandingSchema.safeParse({
        version: 1,
        logoUrl: 'https://cdn.example/status.png',
        primaryColor: '#123abc',
        refreshInterval: 30,
        legacyThemeKey: 'preserved',
      }).success
    ).toBe(true);
    expect(StatusPageBrandingSchema.safeParse({ primaryColor: 'expression(alert(1))' }).success).toBe(
      false
    );
    expect(StatusPageBrandingSchema.safeParse({ logoUrl: 'javascript:alert(1)' }).success).toBe(
      false
    );
    expect(StatusPageBrandingSchema.safeParse({ refreshInterval: 1 }).success).toBe(false);
  });

  it('uses identical maintenance precedence for HTML and API projections', () => {
    const maintenance = activeMaintenanceServiceIds(
      [
        {
          type: 'MAINTENANCE',
          isActive: true,
          startDate: '2026-09-06T10:00:00Z',
          endDate: '2026-09-06T12:00:00Z',
          affectedServiceIds: ['service-a'],
        },
      ],
      new Date('2026-09-06T11:00:00Z')
    );
    expect(projectServiceStatus('service-a', 'OPERATIONAL', maintenance)).toBe('MAINTENANCE');
    expect(projectServiceStatus('service-a', 'CRITICAL', maintenance)).toBe('CRITICAL');
    expect(projectOverallStatus(true, true, maintenance)).toBe('outage');
    expect(projectOverallStatus(false, false, maintenance)).toBe('maintenance');
  });

  it('ignores maintenance that references services hidden or removed from the page', () => {
    const maintenance = visibleMaintenanceServiceIds(
      [
        {
          type: 'MAINTENANCE',
          isActive: true,
          startDate: '2026-09-06T10:00:00Z',
          endDate: '2026-09-06T12:00:00Z',
          affectedServiceIds: ['visible-service', 'removed-service'],
        },
      ],
      ['visible-service'],
      new Date('2026-09-06T11:00:00Z')
    );
    expect([...maintenance]).toEqual(['visible-service']);
    expect(projectOverallStatus(false, false, new Set(['removed-service']))).toBe('maintenance');
    expect(
      projectOverallStatus(
        false,
        false,
        visibleMaintenanceServiceIds(
          [
            {
              type: 'MAINTENANCE',
              affectedServiceIds: ['removed-service'],
            },
          ],
          ['visible-service'],
          new Date()
        )
      )
    ).toBe('operational');
  });

  it('keeps hidden service mappings out of every downstream public projection', () => {
    const visible = visibleStatusPageMappings([
      { serviceId: 'visible', showOnPage: true },
      { serviceId: 'hidden', showOnPage: false },
    ]);
    expect(visible).toEqual([{ serviceId: 'visible', showOnPage: true }]);
    expect(visible.map(mapping => mapping.serviceId)).not.toContain('hidden');
  });

  it('uses a stable projection clock within an edge-cache window', () => {
    expect(statusProjectionClock(Date.parse('2026-09-06T11:26:01.000Z')).toISOString()).toBe(
      '2026-09-06T11:26:00.000Z'
    );
    expect(statusProjectionClock(Date.parse('2026-09-06T11:26:59.999Z')).toISOString()).toBe(
      '2026-09-06T11:26:00.000Z'
    );
  });
});
