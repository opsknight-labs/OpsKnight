import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  source: vi.fn(),
  update: vi.fn(),
  fetch: vi.fn(),
  importDeps: vi.fn(),
  syncBs: vi.fn(),
  audit: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/prisma', () => {
  const topologySource = { findUnique: mocks.source, update: mocks.update };
  return {
    default: {
      topologySource,
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({ topologySource }),
    },
  };
});
vi.mock('@/lib/audit', () => ({ logAudit: mocks.audit }));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/network-security', () => ({
  assertSafeOutboundUrl: vi.fn(),
  safeOutboundFetch: mocks.fetch,
}));
vi.mock('@/lib/intelligence/jobs/db-budget', () => ({
  withDbBudget: (_options: unknown, fn: (tx: unknown) => unknown) => fn({}),
}));
vi.mock('@/lib/intelligence/jobs/work-queue', () => ({
  enqueueWorkItems: vi.fn(),
  WORK_KINDS: { SYNC_TOPOLOGY: 'SYNC_TOPOLOGY' },
}));
vi.mock('@/lib/intelligence/settings/service', () => ({
  getIntelligenceSettings: vi.fn(),
  parseOrThrow: (schema: { parse: (value: unknown) => unknown }, value: unknown) =>
    schema.parse(value),
}));
vi.mock('@/lib/intelligence/dependencies/import', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/intelligence/dependencies/import')>()),
  applyCatalogImport: mocks.importDeps,
}));
vi.mock('@/lib/business-services/catalog-sync', () => ({
  syncBusinessServicesFromCatalog: mocks.syncBs,
}));

import {
  setTopologySourceBusinessSync,
  syncTopologySource,
} from '@/lib/intelligence/dependencies/topology-sources';

const catalog = JSON.stringify([
  { kind: 'System', metadata: { name: 'checkout' }, spec: { domain: 'commerce' } },
]);
const row = {
  id: 'src1',
  name: 'Backstage',
  url: 'https://backstage.example.com/catalog',
  enabled: true,
  syncBusinessServices: true,
  syncDomains: false,
};

describe('scheduled business-service sync on a topology source', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetch.mockResolvedValue(new Response(catalog, { status: 200 }));
    mocks.importDeps.mockResolvedValue({
      entities: 1,
      matched: 0,
      edgesDeclared: 0,
      unmatched: [],
    });
    mocks.syncBs.mockResolvedValue({ status: 'OK', created: 1 });
  });

  it('syncs business services after the dependency import and stores both summaries', async () => {
    mocks.source.mockResolvedValue(row);
    const summary = await syncTopologySource('src1', { maxDbMs: 1000 });
    expect(mocks.syncBs).toHaveBeenCalledWith(row, [
      expect.objectContaining({ name: 'checkout', kind: 'system', domain: 'commerce' }),
    ]);
    expect(summary).toMatchObject({ businessServices: { status: 'OK', created: 1 } });
    expect(mocks.update.mock.calls[0][0].data).toMatchObject({
      lastStatus: 'OK',
      lastSummary: { businessServices: { created: 1 } },
    });
  });

  it('leaves business services alone while the option is off', async () => {
    mocks.source.mockResolvedValue({ ...row, syncBusinessServices: false });
    await syncTopologySource('src1', { maxDbMs: 1000 });
    expect(mocks.syncBs).not.toHaveBeenCalled();
  });

  it('turns the option on or off with an audit of old and new values', async () => {
    mocks.source.mockResolvedValue({ syncBusinessServices: false, syncDomains: false });
    const result = await setTopologySourceBusinessSync(
      'src1',
      { syncBusinessServices: true, syncDomains: true },
      { actorId: 'u1', source: 'UI' }
    );
    expect(result).toBe('updated');
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: 'src1' },
      data: { syncBusinessServices: true, syncDomains: true },
    });
    expect(mocks.audit.mock.calls[0][0]).toMatchObject({
      action: 'intelligence.topology.source.updated',
      oldValue: { syncBusinessServices: false, syncDomains: false },
      newValue: { syncBusinessServices: true, syncDomains: true },
    });
    mocks.source.mockResolvedValue(null);
    expect(
      await setTopologySourceBusinessSync(
        'gone',
        { syncBusinessServices: false, syncDomains: false },
        { actorId: 'u1', source: 'UI' }
      )
    ).toBe('not_found');
  });
});
