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

import { resolveStatusPage } from '@/lib/status-page-resolver';
import { canPublishIncidentToStatusPage } from '@/lib/status-page-publication';
import { authorizeStatusApiRequest } from '@/lib/status-api-auth';
import {
  activeMaintenanceServiceIds,
  projectOverallStatus,
  projectServiceStatus,
} from '@/lib/status-page-projection';

describe('enterprise status-page contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rateLimit.mockResolvedValue({ allowed: true, resetAt: Date.now() + 60_000 });
    mocks.tokenFindFirst.mockResolvedValue(null);
  });

  it('resolves the legacy route deterministically to the default page', async () => {
    mocks.statusPageFindFirst.mockResolvedValue({ id: 'page-default' });
    await expect(resolveStatusPage()).resolves.toEqual({ id: 'page-default' });
    expect(mocks.statusPageFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { enabled: true },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
      })
    );
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
});
