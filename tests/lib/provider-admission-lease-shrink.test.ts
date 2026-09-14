import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  capacityFindUnique: vi.fn().mockResolvedValue(null),
  runtimeFindUnique: vi.fn().mockResolvedValue(null),
  queryRaw: vi.fn(),
  executeRaw: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    notificationProviderCapacity: { findUnique: mocks.capacityFindUnique },
    notificationRuntimeSettings: { findUnique: mocks.runtimeFindUnique },
    $queryRaw: mocks.queryRaw,
    $executeRaw: mocks.executeRaw,
    rateLimit: { findUnique: vi.fn().mockResolvedValue(null) },
    $transaction: vi.fn(),
  },
}));

import {
  acquireProviderConcurrency,
  releaseProviderConcurrency,
  resetProviderAdmissionForTests,
} from '@/lib/provider-admission';
import { resetCapacityResolverForTests } from '@/lib/notification-capacity/resolver';

describe('provider-admission lease-shrink regression', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.capacityFindUnique.mockResolvedValue(null);
    mocks.runtimeFindUnique.mockResolvedValue(null);
    resetProviderAdmissionForTests();
    resetCapacityResolverForTests();
  });

  it('capacity decrease caps the existing local reservation — does not keep admitting against old larger reserved', async () => {
    const t0 = new Date('2026-09-01T00:00:00.000Z');
    // DB capacity starts at maxInFlight 20. We'll use BULK lane but only acquire
    // up to MAX_SLOTS_PER_WORKER (5) since the fairness cap limits a single worker.
    mocks.queryRaw.mockResolvedValueOnce([{ reservedSlots: 20 }]);
    mocks.capacityFindUnique.mockResolvedValue({
      provider: 'default',
      channel: 'EMAIL',
      mode: 'CUSTOM',
      ratePerSecond: 100,
      maxInFlight: 20,
      bulkSharePercent: 80,
      adaptiveBackpressure: false,
      revision: 1,
      updatedAt: new Date(),
    });

    // First acquire (sets local pool, fairness-capped at 5)
    const first = await acquireProviderConcurrency('EMAIL', 'default', t0, 'BULK');
    expect(first.allowed).toBe(true);

    // Fill to fairness cap (5 total: first + 4 more)
    for (let i = 1; i < 5; i++) {
      const res = await acquireProviderConcurrency(
        'EMAIL',
        'default',
        new Date(t0.getTime() + i * 10),
        'BULK'
      );
      expect(res.allowed).toBe(true);
    }

    // Now admin lowers maxInFlight from 20 → 4 (laneCeiling becomes 4, bulkMaxInFlight = 3)
    mocks.capacityFindUnique.mockResolvedValue({
      provider: 'default',
      channel: 'EMAIL',
      mode: 'CUSTOM',
      ratePerSecond: 100,
      maxInFlight: 4,
      bulkSharePercent: 80,
      adaptiveBackpressure: false,
      revision: 2,
      updatedAt: new Date(),
    });
    // Invalidate resolver cache so new ceiling is seen
    resetCapacityResolverForTests();

    // Next acquire after ceiling lowered: local.reserved is re-clamped to laneCeiling (bulk 3).
    // active (5) >= reserved (3) => denied, proving the shrink is applied immediately.
    // Without `local.reserved = min(local.reserved, laneCeiling)` this would still admit.
    const denied = await acquireProviderConcurrency(
      'EMAIL',
      'default',
      new Date(t0.getTime() + 500),
      'BULK'
    );
    expect(denied.allowed).toBe(false);
    if (!denied.allowed) expect(denied.reason).toBe('MAX_IN_FLIGHT');

    if (first.allowed) await releaseProviderConcurrency(first.leaseKey);
  });

  it('operations page uses union inventory (stored rows + synthetic defaults so no channel is hidden)', async () => {
    const src = await import('node:fs').then(m =>
      m.readFileSync('src/app/(app)/settings/notifications/operations/page.tsx', 'utf8')
    );
    expect(src).toContain('storedProviderCapacities');
    expect(src).toContain('getEffectiveCapacity');
    // Union inventory: stored rows are authoritative but missing lanes get a synthetic `default` entry
    // so the operations page never hides channels.
    expect(src).toContain('inventory');
    expect(src).toContain('storedProviderCapacities.map');
    expect(src).toMatch(
      /inventory\.map\(\(\{\s*channel,\s*provider\s*\}\)\s*=>\s*getEffectiveCapacity/
    );
    // Must loop over the channels constant to synthesize missing defaults
    expect(src).toMatch(/for\s*\(\s*const\s+channel\s+of\s+channels\s*\)/);
  });
});
