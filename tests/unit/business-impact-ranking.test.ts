import { describe, expect, it, vi } from 'vitest';

const findMany = vi.fn();
vi.mock('server-only', () => ({}));
vi.mock('@/lib/prisma', () => ({
  default: {
    incidentBusinessServiceImpact: { findMany: (...args: unknown[]) => findMany(...args) },
  },
}));
vi.mock('@/lib/business-services/commands', () => ({ businessServiceReadWhere: vi.fn() }));
vi.mock('@/lib/business-services/contract', () => ({ getBusinessServiceStats: vi.fn() }));

import { rankByImpact } from '@/lib/business-services/impact-report';

const now = new Date('2026-11-24T00:00:00Z');
const window = { from: new Date('2026-11-17T00:00:00Z'), to: now };
const hour = 3_600_000;
const at = (h: number) => new Date(window.from.getTime() + h * hour);

describe('rankByImpact', () => {
  it('keeps the worst services past the first page, not the first by name', async () => {
    const found = ['a', 'b', 'c'].map(id => ({ id, name: id }));
    findMany.mockResolvedValue([
      { businessServiceId: 'c', startedAt: at(0), endedAt: at(5) },
      { businessServiceId: 'c', startedAt: at(3), endedAt: at(6) }, // overlap counts once: 6h
      { businessServiceId: 'b', startedAt: at(0), endedAt: at(1) },
    ]);
    expect((await rankByImpact(found, window, now, 2)).map(s => s.id)).toEqual(['c', 'b']);
  });

  it('skips the query when everything fits', async () => {
    findMany.mockClear();
    const found = [{ id: 'a', name: 'a' }];
    expect(await rankByImpact(found, window, now, 2)).toEqual(found);
    expect(findMany).not.toHaveBeenCalled();
  });
});
