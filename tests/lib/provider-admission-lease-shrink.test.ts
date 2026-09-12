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

import { acquireProviderConcurrency, releaseProviderConcurrency, resetProviderAdmissionForTests } from '@/lib/provider-admission';
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
    // DB capacity starts at maxInFlight 20 (bulk lane ceiling floor(20*0.8)=16 capped to 19 reserved slot math)
    // First acquire reserves against current ceiling.
    mocks.queryRaw.mockResolvedValueOnce([{ reservedSlots: 20 }]);
    mocks.capacityFindUnique.mockResolvedValue(null);
    mocks.runtimeFindUnique.mockResolvedValue(null);

    // Use EMAIL default which is maxInFlight 5 baseline; WEBHOOK 10. To test shrink, we mock DB row.
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

    const first = await acquireProviderConcurrency('EMAIL', 'default', t0, 'BULK');
    expect(first.allowed).toBe(true);
    // Exhaust the bulk lane: bulkMaxInFlight = max(1, min(19, floor(20*0.8)))=16
    // We got 20 slots (min 20, laneCeiling) but local.reserved=20, active=1 after first
    // Fill to near cap via repeated acquires (no DB roundtrip while local lease valid)
    for (let i = 1; i < 15; i++) {
      const res = await acquireProviderConcurrency('EMAIL', 'default', new Date(t0.getTime() + i * 10), 'BULK');
      expect(res.allowed).toBe(true);
    }
    // One more should still be allowed up to 16 bulk slots (20 physical but bulk lane 16)
    const oneMore = await acquireProviderConcurrency('EMAIL', 'default', new Date(t0.getTime() + 200), 'BULK');
    expect(oneMore.allowed).toBe(true);
    // Fill to exactly 16
    // Now admin lowers maxInFlight from 20 -> 4 (bulkMaxInFlight becomes 3)
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

    // Next acquire after ceiling lowered: existing local.reserved=20 active=16+
    // Without `local.reserved = min(local.reserved, laneCeiling)` the check
    // `active >= reserved` would still use 20 and admit one more.
    // With the fix it shrinks to laneCeiling (bulk 3) and active (16) >= 3 => denied.
    const denied = await acquireProviderConcurrency('EMAIL', 'default', new Date(t0.getTime() + 500), 'BULK');
    expect(denied.allowed).toBe(false);
    if (!denied.allowed) expect(denied.reason).toBe('MAX_IN_FLIGHT');

    if (first.allowed) await releaseProviderConcurrency(first.leaseKey);
  });

  it('operations page uses union inventory (stored rows + synthetic defaults so no channel is hidden)', async () => {
    const src = await import('node:fs').then(m => m.readFileSync('src/app/(app)/settings/notifications/operations/page.tsx', 'utf8'));
    expect(src).toContain('storedProviderCapacities');
    expect(src).toContain('getEffectiveCapacity');
    // Union inventory: stored rows are authoritative but missing lanes get a synthetic `default` entry
    // so the operations page never hides channels.
    expect(src).toContain('inventory');
    expect(src).toContain('storedProviderCapacities.map');
    expect(src).toMatch(/inventory\.map\(\(\{\s*channel,\s*provider\s*\}\)\s*=>\s*getEffectiveCapacity/);
    // Must loop over the channels constant to synthesize missing defaults
    expect(src).toMatch(/for\s*\(\s*const\s+channel\s+of\s+channels\s*\)/);
  });
});
