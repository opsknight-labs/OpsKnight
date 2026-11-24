import { beforeEach, describe, expect, it, vi } from 'vitest';

const tx = vi.hoisted(() => ({
  service: { count: vi.fn(), findMany: vi.fn() },
  serviceDependency: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    upsert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  serviceDependencyEvent: { create: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({
  default: { $transaction: (run: (t: typeof tx) => unknown) => run(tx) },
}));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/intelligence/settings/service', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/intelligence/settings/service')>()),
  memoizeIntelligenceRead: (_key: string, _client: unknown, load: () => unknown) => load(),
}));

import {
  declareDependency,
  removeDependency,
  reviewDependency,
} from '@/lib/intelligence/dependencies/service';

const actor = { actorId: 'u1', source: 'UI' } as never;
const event = (state: string, origin: string) =>
  expect.objectContaining({
    data: expect.objectContaining({
      upstreamServiceId: 'up',
      downstreamServiceId: 'down',
      state,
      origin,
      actorId: 'u1',
    }),
  });

beforeEach(() => vi.clearAllMocks());

describe('dependency history is written with the edge', () => {
  it('records ACTIVE/DECLARED when an edge is declared', async () => {
    tx.service.count.mockResolvedValue(2);
    tx.serviceDependency.findUnique.mockResolvedValue(null);
    tx.serviceDependency.findMany.mockResolvedValue([]);
    tx.serviceDependency.count.mockResolvedValue(0);
    tx.serviceDependency.upsert.mockResolvedValue({ id: 'e1' });
    await declareDependency({ upstreamServiceId: 'up', downstreamServiceId: 'down' }, actor);
    expect(tx.serviceDependencyEvent.create).toHaveBeenCalledWith(event('ACTIVE', 'DECLARED'));
  });

  it.each([
    ['APPROVE', 'ACTIVE'],
    ['REJECT', 'REJECTED'],
  ] as const)('records %s as %s, keeping the edge origin', async (decision, state) => {
    tx.serviceDependency.findUnique.mockResolvedValue({
      status: 'SUGGESTED',
      origin: 'OBSERVED',
      upstreamServiceId: 'up',
      downstreamServiceId: 'down',
    });
    await reviewDependency('e1', decision, actor);
    expect(tx.serviceDependencyEvent.create).toHaveBeenCalledWith(event(state, 'OBSERVED'));
  });

  it('records nothing when the edge is not reviewable or not found', async () => {
    tx.serviceDependency.findUnique.mockResolvedValue({ status: 'ACTIVE', origin: 'DECLARED' });
    expect(await reviewDependency('e1', 'APPROVE', actor)).toBe('not_found');
    tx.serviceDependency.findUnique.mockResolvedValue(null);
    expect(await removeDependency('e1', actor)).toBe('not_found');
    expect(tx.serviceDependencyEvent.create).not.toHaveBeenCalled();
  });

  it('records REMOVED with the edge origin', async () => {
    tx.serviceDependency.findUnique.mockResolvedValue({
      origin: 'OBSERVED',
      upstreamServiceId: 'up',
      downstreamServiceId: 'down',
    });
    await removeDependency('e1', actor);
    expect(tx.serviceDependencyEvent.create).toHaveBeenCalledWith(event('REMOVED', 'OBSERVED'));
  });
});
