/**
 * P0 Regression Tests: Notification Control-Plane Concurrency
 *
 * Guards against the production bug where ProviderWorkerLease query failures
 * silently returned MAX_IN_FLIGHT, making a DB outage indistinguishable from
 * real provider saturation (→ notifications deferred indefinitely with 0 attempts).
 *
 * Fixed behavior:
 *   - DB failure for BULK traffic → CONTROL_PLANE_UNAVAILABLE (bulk paused)
 *   - DB failure for non-bulk → emergency local limiter (2 PUSH, 1 EMAIL/SMS/etc)
 *   - Real pool exhaustion (DB success, 0 rows) → MAX_IN_FLIGHT (short retry)
 *   - Verbose logging on any DB failure (was silently swallowed before fix)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const loggerMocks = vi.hoisted(() => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
}));

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  capacityFindUnique: vi.fn(),
  runtimeFindUnique: vi.fn(),
  providerAdmissionCount: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({ logger: loggerMocks }));

vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    $queryRaw: mocks.queryRaw,
    notificationProviderCapacity: { findUnique: mocks.capacityFindUnique },
    notificationRuntimeSettings: { findUnique: mocks.runtimeFindUnique },
    providerAdmission: { count: mocks.providerAdmissionCount },
  },
}));

import {
  acquireProviderAdmission,
  acquireProviderConcurrency,
  certifyNotificationControlPlane,
  forceProductionModeForTests,
  releaseProviderConcurrency,
  resetProviderAdmissionForTests,
} from '@/lib/provider-admission';
import { resetCapacityResolverForTests } from '@/lib/notification-capacity/resolver';

function setup() {
  vi.clearAllMocks();
  mocks.capacityFindUnique.mockResolvedValue(null);
  mocks.runtimeFindUnique.mockResolvedValue(null);
  mocks.providerAdmissionCount.mockResolvedValue(0);
  resetCapacityResolverForTests();
  resetProviderAdmissionForTests();
  forceProductionModeForTests();
}

describe('P0: provider concurrency control-plane', () => {
  beforeEach(setup);

  // ─── Test 1 ────────────────────────────────────────────────────────────────
  // P0 BUG: BULK traffic must return CONTROL_PLANE_UNAVAILABLE when DB fails.
  // Before fix: any ProviderWorkerLease error silently became MAX_IN_FLIGHT —
  // bulk notifications would spin on 250ms retries until they expired with 0 attempts.
  // After fix: BULK returns CONTROL_PLANE_UNAVAILABLE (longer retry, distinct reason).
  it('[P0-1] BULK: DB failure returns CONTROL_PLANE_UNAVAILABLE — never MAX_IN_FLIGHT', async () => {
    mocks.queryRaw.mockRejectedValue(new Error('connection refused: ProviderWorkerLease'));

    const result = await acquireProviderConcurrency('PUSH', 'web-push', new Date(), 'BULK');

    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe('CONTROL_PLANE_UNAVAILABLE');
      expect(result.reason).not.toBe('MAX_IN_FLIGHT');
    }
  });

  // ─── Test 2 ────────────────────────────────────────────────────────────────
  it('[P0-2] CONTROL_PLANE_UNAVAILABLE result always includes a cause string', async () => {
    // Any DB error (including Prisma template issues in test env) must produce a cause.
    mocks.queryRaw.mockRejectedValue(new Error('DB auth failed'));

    // BULK → CONTROL_PLANE_UNAVAILABLE with cause
    const result = await acquireProviderConcurrency('PUSH', 'web-push', new Date(), 'BULK');

    expect(result.allowed).toBe(false);
    if (!result.allowed && result.reason === 'CONTROL_PLANE_UNAVAILABLE') {
      // cause must be a non-empty string — exact message may differ by env
      expect(typeof (result as { cause: string }).cause).toBe('string');
      expect((result as { cause: string }).cause.length).toBeGreaterThan(0);
    }
  });

  // ─── Test 3 ────────────────────────────────────────────────────────────────
  // DB failures MUST be logged verbosely. Before the fix they were silently swallowed.
  it('[P0-3] DB failure is logged with verbose details — not silently swallowed', async () => {
    mocks.queryRaw.mockRejectedValue(new Error('DB connection lost'));

    // Trigger via BULK to exercise the logging path that records CONTROL_PLANE_UNAVAILABLE
    await acquireProviderConcurrency('PUSH', 'web-push', new Date(), 'BULK');

    expect(loggerMocks.error).toHaveBeenCalledWith(
      'provider_admission.concurrency_db_failed',
      expect.objectContaining({
        scope: 'PUSH',
        providerKey: 'web-push',
        detail: expect.stringContaining('CONTROL_PLANE_UNAVAILABLE'),
      })
    );
  });

  // ─── Test 4 ────────────────────────────────────────────────────────────────
  // Emergency local limiter: when DB is down, non-bulk PUSH still gets 2 slots
  // so critical incident alerts still go out during a control-plane outage.
  it('[P0-4] Emergency local limiter allows TRANSACTIONAL Push when DB is down', async () => {
    mocks.queryRaw.mockRejectedValue(new Error('DB unavailable'));

    const result = await acquireProviderConcurrency(
      'PUSH',
      'web-push',
      new Date(),
      'TRANSACTIONAL'
    );

    // Emergency concurrency for PUSH (non-bulk) = 2 → first call allowed
    expect(result.allowed).toBe(true);
  });

  // ─── Test 5 ────────────────────────────────────────────────────────────────
  // BULK must be completely paused during outage so critical/transactional are not starved.
  it('[P0-5] Bulk traffic is paused entirely when DB is unavailable', async () => {
    mocks.queryRaw.mockRejectedValue(new Error('DB unavailable'));

    const result = await acquireProviderConcurrency('EMAIL', 'sendgrid', new Date(), 'BULK');

    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe('CONTROL_PLANE_UNAVAILABLE');
      // Retry for bulk-paused should be longer than real MAX_IN_FLIGHT (25–250ms)
      const retryMs = result.retryAt.getTime() - Date.now();
      expect(retryMs).toBeGreaterThan(500);
    }
  });

  // ─── Test 6 ────────────────────────────────────────────────────────────────
  // Fairness cap: exhausting the emergency local limiter yields CONTROL_PLANE_UNAVAILABLE.
  // With PUSH emergency = 2 slots, the 3rd concurrent delivery is denied.
  it('[P0-6] Emergency limiter is exhausted after MAX slots; 3rd PUSH is denied', async () => {
    mocks.queryRaw.mockRejectedValue(new Error('DB unavailable'));
    // Re-init so no prior state bleeds in from P0-4
    resetProviderAdmissionForTests();
    forceProductionModeForTests();

    const r1 = await acquireProviderConcurrency('PUSH', 'web-push', new Date(), 'TRANSACTIONAL');
    const r2 = await acquireProviderConcurrency('PUSH', 'web-push', new Date(), 'TRANSACTIONAL');
    // Third call: local emergency pool is exhausted (2 slots used)
    const r3 = await acquireProviderConcurrency('PUSH', 'web-push', new Date(), 'TRANSACTIONAL');

    expect(r1.allowed).toBe(true);
    expect(r2.allowed).toBe(true);
    expect(r3.allowed).toBe(false); // pool exhausted
  });

  // ─── Test 7 ────────────────────────────────────────────────────────────────
  // When local pool slots are exhausted (whether from DB or emergency limiter),
  // subsequent calls return MAX_IN_FLIGHT — NOT CONTROL_PLANE_UNAVAILABLE.
  // This distinction matters: operators must know whether the pool is full or the DB is down.
  it('[P0-7] Local pool exhaustion returns MAX_IN_FLIGHT (distinct from CONTROL_PLANE_UNAVAILABLE)', async () => {
    mocks.queryRaw.mockRejectedValue(new Error('DB unavailable')); // forces emergency limiter
    resetProviderAdmissionForTests();
    forceProductionModeForTests();

    // Exhaust the PUSH emergency pool (2 slots)
    const r1 = await acquireProviderConcurrency('PUSH', 'web-push', new Date(), 'TRANSACTIONAL');
    const r2 = await acquireProviderConcurrency('PUSH', 'web-push', new Date(), 'TRANSACTIONAL');
    expect(r1.allowed).toBe(true);
    expect(r2.allowed).toBe(true);

    // Third call: local pool exhausted → MAX_IN_FLIGHT (not CONTROL_PLANE_UNAVAILABLE)
    const r3 = await acquireProviderConcurrency('PUSH', 'web-push', new Date(), 'TRANSACTIONAL');
    expect(r3.allowed).toBe(false);
    if (!r3.allowed) {
      expect(r3.reason).toBe('MAX_IN_FLIGHT');
      expect(r3.reason).not.toBe('CONTROL_PLANE_UNAVAILABLE');
    }
  });

  // ─── Test 8 ────────────────────────────────────────────────────────────────
  it('[P0-8] Successful DB acquisition returns allowed=true with a leaseKey', async () => {
    mocks.queryRaw.mockResolvedValue([{ reservedSlots: 3 }]);

    const result = await acquireProviderConcurrency('PUSH', 'web-push');

    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(typeof result.leaseKey).toBe('string');
      expect(result.leaseKey.length).toBeGreaterThan(0);
    }
  });

  // ─── Test 9 ────────────────────────────────────────────────────────────────
  // After releasing a lease, the slot is returned to the pool so the next
  // delivery can proceed. Broken release = deadlocked pool.
  it('[P0-9] releaseProviderConcurrency returns a slot to the local pool', async () => {
    mocks.queryRaw.mockRejectedValue(new Error('DB unavailable')); // emergency limiter
    resetProviderAdmissionForTests();
    forceProductionModeForTests();

    // PUSH emergency = 2 slots. Acquire both.
    const first = await acquireProviderConcurrency('PUSH', 'web-push', new Date(), 'TRANSACTIONAL');
    const second = await acquireProviderConcurrency(
      'PUSH',
      'web-push',
      new Date(),
      'TRANSACTIONAL'
    );
    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);

    // Pool exhausted (2/2 slots active)
    const overflow = await acquireProviderConcurrency(
      'PUSH',
      'web-push',
      new Date(),
      'TRANSACTIONAL'
    );
    expect(overflow.allowed).toBe(false);

    // Release one lease → active drops to 1/2
    if (first.allowed) await releaseProviderConcurrency(first.leaseKey);

    // Now should be able to acquire again
    const reacquired = await acquireProviderConcurrency(
      'PUSH',
      'web-push',
      new Date(),
      'TRANSACTIONAL'
    );
    expect(reacquired.allowed).toBe(true);
  });

  // ─── Test 10 ───────────────────────────────────────────────────────────────
  // Startup certification must throw when control-plane tables are missing.
  // This prevents the service from starting in a degraded state where every
  // notification gets stuck in CONTROL_PLANE_UNAVAILABLE indefinitely.
  it('[P0-10] certifyNotificationControlPlane throws and logs when tables are inaccessible', async () => {
    const certErr = new Error('relation "ProviderWorkerLease" does not exist');
    mocks.queryRaw.mockRejectedValue(certErr);
    mocks.providerAdmissionCount.mockRejectedValue(certErr);

    await expect(certifyNotificationControlPlane()).rejects.toThrow(
      /startup certification failed/i
    );

    expect(loggerMocks.error).toHaveBeenCalledWith(
      'provider_admission.startup_certification_failed',
      expect.objectContaining({ table: expect.any(String) })
    );
  });

  // ─── Test 11 ───────────────────────────────────────────────────────────────
  // GATE 1: Unified emergency mode: when DB fails, rate/quota admission must
  // allow CRITICAL / TRANSACTIONAL pushes at bounded process-local rates.
  it('[P0-11] Unified emergency admission: rate limit allows TRANSACTIONAL traffic when DB quota window fails', async () => {
    mocks.queryRaw.mockRejectedValue(new Error('relation ProviderQuotaWindow does not exist'));
    resetProviderAdmissionForTests();
    forceProductionModeForTests();

    // With DB quota failing, TRANSACTIONAL push must still be admitted locally (emergency rate = 5/s)
    const admission = await acquireProviderAdmission(
      'PUSH',
      'web-push',
      new Date(),
      'TRANSACTIONAL'
    );
    expect(admission.allowed).toBe(true);

    // Concurrency also allows under emergency limiter (2 slots)
    const concurrency = await acquireProviderConcurrency(
      'PUSH',
      'web-push',
      new Date(),
      'TRANSACTIONAL'
    );
    expect(concurrency.allowed).toBe(true);
  });

  // ─── Test 12 ───────────────────────────────────────────────────────────────
  // GATE 1: Bulk traffic must be paused under rate admission when DB is unreachable.
  it('[P0-12] Unified emergency admission: rate limit pauses BULK traffic when DB quota window fails', async () => {
    mocks.queryRaw.mockRejectedValue(new Error('relation ProviderQuotaWindow does not exist'));
    resetProviderAdmissionForTests();
    forceProductionModeForTests();

    // BULK traffic fails closed as CONTROL_PLANE_UNAVAILABLE
    const admission = await acquireProviderAdmission('PUSH', 'web-push', new Date(), 'BULK');
    expect(admission.allowed).toBe(false);
    if (!admission.allowed) {
      expect(admission.reason).toBe('CONTROL_PLANE_UNAVAILABLE');
    }
  });

  // ─── Test 13 ───────────────────────────────────────────────────────────────
  // GATE 1: Complete PostgreSQL outage: when capacityFindUnique, runtimeFindUnique,
  // and $queryRaw all throw (e.g. total database partition after cache expiry),
  // TRANSACTIONAL traffic must STILL successfully enter emergency mode without crashing.
  it('[P0-13] Full DB outage: emergency mode entered even when getEffectiveCapacity and $queryRaw both fail', async () => {
    resetCapacityResolverForTests();
    resetProviderAdmissionForTests();
    forceProductionModeForTests();

    // Total database outage: all Prisma reads throw
    const dbOutageError = new Error("Can't reach database server at postgres:5432");
    mocks.capacityFindUnique.mockRejectedValue(dbOutageError);
    mocks.runtimeFindUnique.mockRejectedValue(dbOutageError);
    mocks.queryRaw.mockRejectedValue(dbOutageError);

    // 1. acquireProviderAdmission for TRANSACTIONAL must gracefully admit under emergency rate limit
    const admission = await acquireProviderAdmission(
      'PUSH',
      'web-push',
      new Date(),
      'TRANSACTIONAL'
    );
    expect(admission.allowed).toBe(true);

    // 2. acquireProviderConcurrency for TRANSACTIONAL must gracefully admit under emergency concurrency slots
    const concurrency = await acquireProviderConcurrency(
      'PUSH',
      'web-push',
      new Date(),
      'TRANSACTIONAL'
    );
    expect(concurrency.allowed).toBe(true);
    if (concurrency.allowed) {
      expect(concurrency.leaseKey).toBeDefined();
    }

    // 3. BULK traffic must pause closed under full outage
    const bulkAdmission = await acquireProviderAdmission('PUSH', 'web-push', new Date(), 'BULK');
    expect(bulkAdmission.allowed).toBe(false);
    if (!bulkAdmission.allowed) {
      expect(bulkAdmission.reason).toBe('CONTROL_PLANE_UNAVAILABLE');
    }

    const bulkConcurrency = await acquireProviderConcurrency(
      'PUSH',
      'web-push',
      new Date(),
      'BULK'
    );
    expect(bulkConcurrency.allowed).toBe(false);
    if (!bulkConcurrency.allowed) {
      expect(bulkConcurrency.reason).toBe('CONTROL_PLANE_UNAVAILABLE');
    }
  });
});
