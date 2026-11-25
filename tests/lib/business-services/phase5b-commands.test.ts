import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { APP_ROLES } from '@/lib/authorization';

vi.mock('@/lib/prisma', () => {
  const prisma = {
    $transaction: vi.fn(async () => {
      throw new Error('database must not be reached');
    }),
    businessService: { findMany: vi.fn(), findFirst: vi.fn() },
    businessServiceTemplate: { findUnique: vi.fn(), findMany: vi.fn() },
    customerImpactReport: { create: vi.fn() },
  };
  return { default: prisma };
});

import prisma from '@/lib/prisma';
import {
  BulkEditInputSchema,
  MAX_BULK_ITEMS,
  bulkEditBusinessServices,
  bulkPatch,
} from '@/lib/business-services/bulk';
import {
  CustomerImpactReportInputSchema,
  MAX_REPORT_WINDOW_MS,
  assertReportWindow,
  createCustomerImpactReport,
  listCustomerImpactReports,
} from '@/lib/business-services/customer-reports';
import {
  BusinessServiceTemplateInputSchema,
  BusinessServiceTemplatePatchSchema,
  createBusinessServiceFromTemplate,
  createBusinessServiceTemplate,
  deleteBusinessServiceTemplate,
  listBusinessServiceTemplates,
  templateToInput,
  updateBusinessServiceTemplate,
} from '@/lib/business-services/templates';
import { BusinessServiceInputSchema } from '@/lib/business-services/commands';

const actor = (role: AuthorizationActor['role']): AuthorizationActor => ({
  id: `user-${role}`,
  role,
  status: 'ACTIVE',
  teamIds: ['team-1'],
});
const NOW = new Date('2026-11-25T12:00:00Z');
const minutes = (n: number) => new Date(NOW.getTime() - n * 60_000);

beforeEach(() => vi.clearAllMocks());

describe('role matrix: new commands are manager-only (negative tests)', () => {
  const denied = APP_ROLES.filter(role => role !== 'ADMIN' && role !== 'RESPONDER');
  const report = { source: 'zendesk', count: 3, windowStart: minutes(30), windowEnd: minutes(1) };

  it('covers the four non-manager role cases the policy defines', () => {
    expect(denied).toEqual(['AUDITOR', 'USER', 'STAKEHOLDER']);
  });

  it.each(denied)('%s cannot add customer reports, bulk edit or manage templates', async role => {
    const context = { actor: actor(role) };
    const forbidden = { code: 'AUTHORIZATION_DENIED' };
    await expect(createCustomerImpactReport('bs1', report, context)).rejects.toMatchObject(
      forbidden
    );
    await expect(
      bulkEditBusinessServices({ ids: ['bs1'], changes: { markReviewed: true } }, context)
    ).rejects.toMatchObject(forbidden);
    await expect(createBusinessServiceTemplate({ name: 'T' }, context)).rejects.toMatchObject(
      forbidden
    );
    await expect(updateBusinessServiceTemplate('t1', { name: 'U' }, context)).rejects.toMatchObject(
      forbidden
    );
    await expect(deleteBusinessServiceTemplate('t1', context)).rejects.toMatchObject(forbidden);
    await expect(listBusinessServiceTemplates(actor(role))).rejects.toMatchObject(forbidden);
    await expect(
      createBusinessServiceFromTemplate('t1', { name: 'X' }, context)
    ).rejects.toMatchObject(forbidden);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.businessService.findMany).not.toHaveBeenCalled();
  });

  it('a key without the services:write scope is refused too', async () => {
    const readOnlyKey: AuthorizationActor = {
      ...actor('ADMIN'),
      apiKey: { id: 'k1', scopes: ['services:read'] },
    };
    await expect(
      createCustomerImpactReport('bs1', report, { actor: readOnlyKey })
    ).rejects.toMatchObject({ code: 'AUTHORIZATION_DENIED' });
  });

  it('validates input before any database access, for managers', async () => {
    await expect(
      createCustomerImpactReport('bs1', { ...report, count: 0 }, { actor: actor('RESPONDER') })
    ).rejects.toThrow();
    await expect(
      bulkEditBusinessServices(
        { ids: [], changes: { markReviewed: true } },
        { actor: actor('ADMIN') }
      )
    ).rejects.toThrow();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('listing reports respects the read scope (not-found, not forbidden, for an invisible service)', async () => {
    vi.mocked(prisma.businessService.findFirst).mockResolvedValue(null as never);
    await expect(listCustomerImpactReports('bs1', actor('USER'))).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    });
  });
});

describe('customer report validation', () => {
  const ok = { source: 'Zendesk', count: 5, windowStart: minutes(60), windowEnd: minutes(1) };
  it('normalises the source and bounds the count', () => {
    expect(CustomerImpactReportInputSchema.parse(ok).source).toBe('zendesk');
    for (const bad of [
      { ...ok, count: 0 },
      { ...ok, count: 1.5 },
      { ...ok, count: 1_000_001 },
      { ...ok, source: '' },
      { ...ok, source: 'a b' },
      { ...ok, source: 'x'.repeat(41) },
      { ...ok, externalRef: '' },
      { ...ok, extra: 1 },
    ])
      expect(CustomerImpactReportInputSchema.safeParse(bad).success).toBe(false);
  });
  it('requires a sane window', () => {
    expect(() =>
      assertReportWindow({ windowStart: minutes(60), windowEnd: minutes(1) }, NOW)
    ).not.toThrow();
    expect(() =>
      assertReportWindow({ windowStart: minutes(1), windowEnd: minutes(60) }, NOW)
    ).toThrow(/end after/);
    expect(() =>
      assertReportWindow(
        { windowStart: new Date(NOW.getTime() - MAX_REPORT_WINDOW_MS - 61_000), windowEnd: NOW },
        NOW
      )
    ).toThrow(/7 days/);
    expect(() =>
      assertReportWindow({ windowStart: NOW, windowEnd: new Date(NOW.getTime() + 600_000) }, NOW)
    ).toThrow(/future/);
    expect(() => assertReportWindow({ windowStart: new Date('x'), windowEnd: NOW }, NOW)).toThrow();
  });
});

describe('bulk edit', () => {
  it('limits the selection to 100 and needs at least one change', () => {
    const ids = Array.from({ length: MAX_BULK_ITEMS + 1 }, (_, i) => `bs${i}`);
    const changes = { markReviewed: true as const };
    expect(BulkEditInputSchema.safeParse({ ids: ids.slice(0, 100), changes }).success).toBe(true);
    expect(BulkEditInputSchema.safeParse({ ids, changes }).success).toBe(false);
    expect(BulkEditInputSchema.safeParse({ ids: ['a'], changes: {} }).success).toBe(false);
    expect(BulkEditInputSchema.safeParse({ ids: ['a'], changes: { name: 'x' } }).success).toBe(
      false
    );
    expect(
      BulkEditInputSchema.safeParse({ ids: ['a'], changes: { markReviewed: false } }).success
    ).toBe(false);
    expect(BulkEditInputSchema.safeParse({ ids: ['a'], changes: { sloTarget: 50 } }).success).toBe(
      false
    );
  });
  it('defaults to a real run, and accepts dryRun', () => {
    const parsed = BulkEditInputSchema.parse({ ids: ['a'], changes: { lifecycle: 'BETA' } });
    expect(parsed.dryRun).toBe(false);
    expect(
      BulkEditInputSchema.parse({ ids: ['a'], changes: { lifecycle: 'BETA' }, dryRun: true }).dryRun
    ).toBe(true);
  });
  it('builds the patch: tags add and remove case-insensitively without duplicates', () => {
    const changes = BulkEditInputSchema.parse({
      ids: ['a'],
      changes: { addTags: ['PCI', 'api'], removeTags: ['Legacy'] },
    }).changes;
    expect(bulkPatch(changes, ['legacy', 'api', 'web'], NOW)).toEqual({
      tags: ['api', 'web', 'PCI'],
    });
  });
  it('maps scalar changes and stamps the review time', () => {
    const changes = BulkEditInputSchema.parse({
      ids: ['a'],
      changes: {
        ownerTeamId: null,
        criticality: 'TIER_1',
        lifecycle: 'DEPRECATED',
        markReviewed: true,
        sloTarget: 99.9,
        sloWindowDays: 90,
      },
    }).changes;
    expect(bulkPatch(changes, [], NOW)).toEqual({
      ownerTeamId: null,
      criticality: 'TIER_1',
      lifecycle: 'DEPRECATED',
      sloTarget: 99.9,
      sloWindowDays: 90,
      lastReviewedAt: NOW,
    });
    expect(bulkPatch({ lifecycle: 'BETA' }, ['x'], NOW)).toEqual({ lifecycle: 'BETA' });
  });
});

describe('templates', () => {
  it('validates defaults like a business service does', () => {
    expect(BusinessServiceTemplateInputSchema.safeParse({ name: 'T', sloTarget: 80 }).success).toBe(
      false
    );
    expect(
      BusinessServiceTemplateInputSchema.safeParse({
        name: 'T',
        quorumPartialPct: 80,
        quorumMajorPct: 50,
      }).success
    ).toBe(false);
    expect(BusinessServiceTemplateInputSchema.safeParse({ name: '' }).success).toBe(false);
    expect(
      BusinessServiceTemplateInputSchema.safeParse({ name: 'T', memberServiceIds: ['a'] }).success
    ).toBe(false);
    expect(BusinessServiceTemplatePatchSchema.safeParse({}).success).toBe(false);
    expect(BusinessServiceTemplatePatchSchema.safeParse({ sloTarget: 99.9 }).success).toBe(true);
  });
  it('turns a template into a create input; explicit overrides win and empty defaults are dropped', () => {
    const input = templateToInput(
      {
        description: 'Customer API',
        criticality: 'TIER_1',
        sloTarget: 99.9,
        sloWindowDays: 30,
        quorumPartialPct: null,
        quorumMajorPct: null,
        tags: ['api'],
        environment: 'production',
        lifecycle: 'ACTIVE',
        links: [],
        impactMinUrgency: null,
        impactMaxPriority: 'P2',
        ownerTeamId: 'team-1',
      },
      { name: 'Orders', criticality: 'TIER_0', tags: undefined, ownerTeamId: null }
    );
    expect(input).toEqual({
      name: 'Orders',
      description: 'Customer API',
      criticality: 'TIER_0',
      sloTarget: 99.9,
      sloWindowDays: 30,
      tags: ['api'],
      environment: 'production',
      lifecycle: 'ACTIVE',
      impactMaxPriority: 'P2',
      ownerTeamId: null,
    });
    expect(BusinessServiceInputSchema.safeParse(input).success).toBe(true);
  });
});

describe('business service input: new fields', () => {
  const parse = (extra: object) =>
    BusinessServiceInputSchema.safeParse({ name: 'Checkout', ...extra });
  it('accepts money as integer cents with an ISO currency', () => {
    const parsed = parse({ revenuePerHourCents: 1_200_000, currency: 'eur', customersTotal: 5000 });
    expect(parsed.success && parsed.data.currency).toBe('EUR');
  });
  it('rejects floats, negatives, overflow and bad currencies', () => {
    for (const extra of [
      { revenuePerHourCents: 12.5 },
      { revenuePerHourCents: -1 },
      { revenuePerHourCents: 2_000_000_001 },
      { currency: 'dollars' },
      { customersTotal: -3 },
      { customerReportThreshold: 0 },
      { customerReportWindowMinutes: 4 },
      { customerReportWindowMinutes: 1441 },
      { reviewIntervalDays: 3 },
    ])
      expect(parse(extra).success, JSON.stringify(extra)).toBe(false);
  });
  it('leaves omitted fields undefined so an update keeps stored values', () => {
    const parsed = parse({});
    expect(parsed.success && parsed.data.revenuePerHourCents).toBeUndefined();
    expect(parsed.success && parsed.data.currency).toBeUndefined();
  });
});
