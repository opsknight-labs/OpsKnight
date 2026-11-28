import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  findMany: vi.fn(),
  deleteMany: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({
  default: { inboundDelivery: { findMany: db.findMany, deleteMany: db.deleteMany } },
}));

import {
  cleanupInboundDeliveries,
  inboundDeliveryRetentionDays,
  INBOUND_DELIVERY_RETENTION_BATCH,
  INBOUND_DELIVERY_RETENTION_MAX_BATCHES,
} from '@/lib/integrations/delivery-retention';

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `d${i}` }));

describe('inbound delivery retention', () => {
  beforeEach(() => {
    db.findMany.mockReset();
    db.deleteMany.mockReset();
    db.deleteMany.mockImplementation(async (args: { where: { id: { in: string[] } } }) => ({
      count: args.where.id.in.length,
    }));
  });
  afterEach(() => vi.unstubAllEnvs());

  it('keeps 30 days by default and reads the window from the environment, clamped', () => {
    expect(inboundDeliveryRetentionDays()).toBe(30);
    vi.stubEnv('OPSKNIGHT_INBOUND_DELIVERY_RETENTION_DAYS', '7');
    expect(inboundDeliveryRetentionDays()).toBe(7);
    vi.stubEnv('OPSKNIGHT_INBOUND_DELIVERY_RETENTION_DAYS', '0');
    expect(inboundDeliveryRetentionDays()).toBe(1);
    vi.stubEnv('OPSKNIGHT_INBOUND_DELIVERY_RETENTION_DAYS', 'soon');
    expect(inboundDeliveryRetentionDays()).toBe(30);
  });

  it('deletes only finished rows older than the window, in batches of 1,000', async () => {
    const now = new Date('2026-11-28T00:00:00Z');
    db.findMany.mockResolvedValueOnce(rows(40));
    await expect(cleanupInboundDeliveries(now)).resolves.toBe(40);
    const args = db.findMany.mock.calls[0][0] as {
      where: { createdAt: { lt: Date }; status: { in: string[] } };
      take: number;
    };
    expect(args.take).toBe(INBOUND_DELIVERY_RETENTION_BATCH);
    expect(args.where.status.in).toEqual(['COMPLETED', 'FAILED']);
    expect(args.where.createdAt.lt.toISOString()).toBe('2026-10-29T00:00:00.000Z');
  });

  it('stops after 10 full batches so one run stays bounded', async () => {
    db.findMany.mockImplementation(async () => rows(INBOUND_DELIVERY_RETENTION_BATCH));
    const removed = await cleanupInboundDeliveries();
    expect(db.findMany).toHaveBeenCalledTimes(INBOUND_DELIVERY_RETENTION_MAX_BATCHES);
    expect(removed).toBe(INBOUND_DELIVERY_RETENTION_BATCH * INBOUND_DELIVERY_RETENTION_MAX_BATCHES);
  });

  it('stops on a short batch', async () => {
    db.findMany
      .mockResolvedValueOnce(rows(INBOUND_DELIVERY_RETENTION_BATCH))
      .mockResolvedValueOnce(rows(3));
    await expect(cleanupInboundDeliveries()).resolves.toBe(INBOUND_DELIVERY_RETENTION_BATCH + 3);
    expect(db.findMany).toHaveBeenCalledTimes(2);
  });
});
