import { describe, expect, it, vi } from 'vitest';

type Row = { status: string; updatedAt: Date };
const state = vi.hoisted(() => ({ row: null as { status: string; updatedAt: Date } | null }));
const matches = vi.hoisted(() => (where: Record<string, unknown>, row: Row): boolean => {
  const or = where.OR as Array<{ status: string; updatedAt?: { lt: Date } }>;
  return or.some(c => c.status === row.status && (!c.updatedAt || row.updatedAt < c.updatedAt.lt));
});
const db = vi.hoisted(() => ({
  businessServiceReviewRun: {
    createMany: vi.fn(async () => {
      if (state.row) return { count: 0 };
      state.row = { status: 'PENDING', updatedAt: new Date() };
      return { count: 1 };
    }),
    updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Row }) => {
      if (!state.row || !matches(where, state.row)) return { count: 0 };
      state.row = { ...state.row, status: data.status, updatedAt: data.updatedAt };
      return { count: 1 };
    }),
  },
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/prisma', () => ({ default: db }));
vi.mock('@/lib/audit', () => ({ emitAuditEvent: vi.fn() }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn() }));
vi.mock('@/lib/authorization-actors', () => ({ resolveUserActor: vi.fn() }));
vi.mock('@/lib/notification-control-plane', () => ({ enqueueCentralNotification: vi.fn() }));
vi.mock('@/lib/notification-providers', () => ({ getAllConfiguredEmailProviders: vi.fn() }));
vi.mock('@/lib/business-services/commands', () => ({ businessServiceReadWhere: vi.fn() }));
vi.mock('@/lib/business-services/reviews/config', () => ({ getReviewConfig: vi.fn() }));
vi.mock('@/lib/business-services/reviews/data', () => ({ collectServiceReviews: vi.fn() }));

import { claim, STALE_PENDING_MS } from '@/lib/business-services/reviews/run';

const minutes = (m: number) => new Date(Date.now() + m * 60_000);

describe('review claim state machine', () => {
  it('does not reclaim a fresh PENDING', async () => {
    state.row = null;
    expect(await claim('2026-10', 'DIGEST', 'u1')).toBe(true);
    expect(await claim('2026-10', 'DIGEST', 'u1')).toBe(false);
  });

  it('reclaims a stale PENDING exactly once', async () => {
    state.row = { status: 'PENDING', updatedAt: new Date(Date.now() - STALE_PENDING_MS - 1000) };
    const later = minutes(0);
    expect(await claim('2026-10', 'DIGEST', 'u1', later)).toBe(true);
    expect(await claim('2026-10', 'DIGEST', 'u1', later)).toBe(false);
  });

  it('retries FAILED but never SENT or SKIPPED', async () => {
    state.row = { status: 'FAILED', updatedAt: new Date() };
    expect(await claim('p', 'DIGEST', 'u')).toBe(true);
    for (const status of ['SENT', 'SKIPPED']) {
      state.row = { status, updatedAt: new Date(0) };
      expect(await claim('p', 'DIGEST', 'u', minutes(600))).toBe(false);
    }
  });
});
