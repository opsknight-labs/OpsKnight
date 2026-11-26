import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  aliases: vi.fn(),
  services: vi.fn(),
  updateMany: vi.fn(),
  audit: vi.fn(),
  apply: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/prisma', () => {
  const tx = {
    businessService: { updateMany: mocks.updateMany },
    auditLog: { create: mocks.audit },
    user: { findUnique: async () => null },
  };
  return {
    default: {
      businessService: { findMany: mocks.findMany },
      catalogServiceAlias: { findMany: mocks.aliases },
      service: { findMany: mocks.services },
      $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
    },
  };
});
vi.mock('@/lib/business-services/import', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/business-services/import')>()),
  applyImportRows: mocks.apply,
}));

import { syncBusinessServicesFromCatalog } from '@/lib/business-services/catalog-sync';
import type { CatalogEntity } from '@/lib/intelligence/dependencies/import';

const source = { id: 'src1', name: 'Backstage', syncDomains: false };
const entity = (over: Partial<CatalogEntity>): CatalogEntity => ({
  name: 'x',
  kind: 'component',
  namespace: 'default',
  serviceId: null,
  dependsOn: [],
  system: null,
  domain: null,
  ...over,
});
const catalog = [
  entity({ name: 'checkout', kind: 'system', domain: 'commerce' }),
  entity({ name: 'payments', kind: 'system', domain: 'commerce', dependsOn: ['system:ghost'] }),
  entity({ name: 'cart-api', system: 'checkout' }),
  entity({ name: 'pay-api', system: 'payments', serviceId: 'svc_pay' }),
  entity({ name: 'unknown-api', system: 'payments' }),
];
const applied = { applied: true, issues: [], summary: { create: 1, update: 1, unchanged: 0 } };
const actions = () => mocks.audit.mock.calls.map(call => call[0].data.action);

describe('syncBusinessServicesFromCatalog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.aliases.mockResolvedValue([{ name: 'cart-api', serviceId: 'svc_cart' }]);
    mocks.services.mockResolvedValue([{ id: 'svc_pay', name: 'Payments API' }]);
    mocks.apply.mockResolvedValue(applied);
    mocks.updateMany.mockResolvedValue({ count: 1 });
  });

  it('upserts Systems with resolved members, stamps external keys and audits the sync', async () => {
    mocks.findMany
      .mockResolvedValueOnce([{ name: 'Checkout', externalKey: null }]) // by name: a manual one
      .mockResolvedValueOnce([]) // owned by this source
      .mockResolvedValueOnce([]); // unknown dependsOn refs
    const summary = await syncBusinessServicesFromCatalog(source, catalog);
    expect(summary).toMatchObject({ status: 'OK', created: 1, updated: 1, skipped: [] });
    expect(summary.unmatched.sort()).toEqual(['ghost', 'unknown-api']);
    const [rows, , options, context] = mocks.apply.mock.calls[0];
    expect(rows).toEqual([
      expect.objectContaining({ name: 'checkout', members: ['svc_cart'], dependsOn: [] }),
      expect.objectContaining({ name: 'payments', members: ['svc_pay'], dependsOn: [] }),
    ]);
    expect(options).toEqual({ format: 'backstage', dryRun: false });
    expect(context.auditActor).toEqual({ type: 'SYSTEM', id: 'topology-source:src1' });
    // The manual "Checkout" is adopted by name; nothing is ever deleted.
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: {
        name: { equals: 'checkout', mode: 'insensitive' },
        OR: [{ externalKey: null }, { externalKey: 'backstage:src1:checkout' }],
      },
      data: { externalKey: 'backstage:src1:checkout', externalRemovedAt: null },
    });
    expect(actions()).toEqual(['business_service.catalog_synced']);
  });

  it('marks synced business services whose System left the catalog, and restores returning ones', async () => {
    mocks.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'bs_old',
          name: 'Legacy',
          externalKey: 'backstage:src1:legacy',
          externalRemovedAt: null,
        },
        {
          id: 'bs_back',
          name: 'checkout',
          externalKey: 'backstage:src1:checkout',
          externalRemovedAt: new Date('2026-11-01T00:00:00Z'),
        },
      ])
      .mockResolvedValueOnce([]);
    const now = new Date('2026-11-26T00:00:00Z');
    const summary = await syncBusinessServicesFromCatalog(source, catalog, now);
    expect(summary.removed).toEqual(['Legacy']);
    expect(summary.restored).toEqual(['checkout']);
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['bs_old'] } },
      data: { externalRemovedAt: now },
    });
    expect(actions()).toEqual([
      'business_service.catalog_removed',
      'business_service.catalog_restored',
      'business_service.catalog_synced',
    ]);
  });

  it('leaves business services owned by another source alone', async () => {
    mocks.findMany
      .mockResolvedValueOnce([{ name: 'payments', externalKey: 'backstage:other:payments' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const summary = await syncBusinessServicesFromCatalog(source, catalog);
    expect(summary.skipped).toEqual(['payments']);
    expect(mocks.apply.mock.calls[0][0].map((row: { name: string }) => row.name)).toEqual([
      'checkout',
    ]);
  });

  it('maps Domains to business services supported by their Systems when enabled', async () => {
    mocks.findMany.mockResolvedValue([]);
    await syncBusinessServicesFromCatalog({ ...source, syncDomains: true }, catalog);
    expect(mocks.apply.mock.calls[0][0]).toContainEqual(
      expect.objectContaining({ name: 'commerce', dependsOn: ['checkout', 'payments'] })
    );
  });

  it('reports a rejected plan as a failure without stamping or auditing', async () => {
    mocks.findMany.mockResolvedValue([]);
    mocks.apply.mockResolvedValue({
      applied: false,
      issues: [
        { line: 0, message: 'The dependencies between business services would form a cycle.' },
      ],
      summary: { create: 0, update: 0, unchanged: 0 },
    });
    const summary = await syncBusinessServicesFromCatalog(source, catalog);
    expect(summary).toMatchObject({ status: 'FAILED', created: 0 });
    expect(summary.error).toContain('cycle');
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});
