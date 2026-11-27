import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ findFirst: vi.fn(), budgets: vi.fn(), report: vi.fn() }));
vi.mock('server-only', () => ({}));
// The route factory is covered by api-v2-endpoint.test.ts; here the handler is called directly.
vi.mock('@/lib/api-v2/endpoint', () => ({
  defineV2Route: (config: { handler: (ctx: unknown) => unknown }) => config.handler,
}));
vi.mock('@/lib/prisma', () => ({ default: { businessService: { findFirst: mocks.findFirst } } }));
vi.mock('@/lib/business-services/commands', () => ({ businessServiceReadWhere: () => ({}) }));
vi.mock('@/lib/business-services/stats', () => ({ getErrorBudgets: mocks.budgets }));
vi.mock('@/lib/business-services/sla-report', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/business-services/sla-report')>()),
  getBusinessServiceSlaReport: mocks.report,
}));

import { GET as errorBudget } from '@/app/api/v2/business-services/[id]/error-budget/route';
import { GET as slaReport } from '@/app/api/v2/business-services/[id]/sla-report/route';

const actor = { id: 'u', role: 'ADMIN', status: 'ACTIVE', teamIds: [] };
type Handler = (ctx: unknown) => Promise<{ data?: unknown; headers?: unknown } | Response>;
const call = (route: unknown, query: object = {}) =>
  (route as Handler)({ actor, params: { id: 'bs1' }, query });

describe('GET /business-services/{id}/error-budget', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the budget and burn state of a visible service', async () => {
    const budget = {
      allowedMinutes: 43.2,
      consumedMinutes: 40,
      remainingPercent: 7.4,
      burnState: 'AT_RISK',
    };
    mocks.findFirst.mockResolvedValue({ id: 'bs1', sloTarget: 99.9, sloWindowDays: 30 });
    mocks.budgets.mockResolvedValue(new Map([['bs1', budget]]));
    expect(await call(errorBudget)).toMatchObject({
      data: { businessServiceId: 'bs1', sloTarget: 99.9, sloWindowDays: 30, errorBudget: budget },
      headers: { 'Cache-Control': 'no-store' },
    });
  });

  it('returns a null budget when no SLO is set', async () => {
    mocks.findFirst.mockResolvedValue({ id: 'bs1', sloTarget: null, sloWindowDays: 30 });
    mocks.budgets.mockResolvedValue(new Map());
    expect(await call(errorBudget)).toMatchObject({ data: { errorBudget: null } });
  });

  it('is not found when the caller cannot see the service', async () => {
    mocks.findFirst.mockResolvedValue(null);
    await expect(call(errorBudget)).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    expect(mocks.budgets).not.toHaveBeenCalled();
  });
});

describe('GET /business-services/{id}/sla-report format', () => {
  const report = {
    businessServiceId: 'bs1',
    name: 'Check out/Pay',
    month: '2026-10',
    monthToDate: false,
    uptimePercent: 99.5,
    weightedUptimePercent: 99.4,
    sloTarget: 99.9,
    sloMet: false,
    downtimeMinutes: 216,
    weightedDowntimeMinutes: 260,
    incidentCount: 0,
    mttaMinutes: null,
    mttrMinutes: null,
    incidents: [],
  };
  beforeEach(() => mocks.report.mockResolvedValue(report));

  it('stays JSON by default', async () => {
    expect(await call(slaReport, { month: '2026-10', format: 'json' })).toMatchObject({
      data: report,
    });
  });

  it('returns a CSV attachment for format=csv', async () => {
    const response = (await call(slaReport, { month: '2026-10', format: 'csv' })) as Response;
    expect(response.headers.get('Content-Type')).toBe('text/csv; charset=utf-8');
    expect(response.headers.get('Content-Disposition')).toBe(
      'attachment; filename="sla-Check-out-Pay-2026-10.csv"'
    );
    expect(await response.text()).toContain('SLO,Missed');
  });
});
