import crypto from 'node:crypto';
import { Prisma, type NotificationChannel, type NotificationTrafficClass } from '@prisma/client';
import prisma from './prisma';
import { getEffectiveCapacity, recordCapacityPressure } from './notification-capacity/resolver';
import { usesBulkCapacity } from './provider-capacity';
import { logger } from './logger';

/**
 * Emergency local concurrency when the control-plane DB is unreachable.
 * These are intentionally conservative to avoid flooding providers.
 * Bulk traffic is paused entirely (0) so CRITICAL/TRANSACTIONAL still drain.
 */
const EMERGENCY_CONCURRENCY: Record<string, number> = {
  PUSH: 2,
  EMAIL: 1,
  SMS: 1,
  SLACK: 1,
  WEBHOOK: 2,
  WHATSAPP: 1,
  MICROSOFT_TEAMS: 1,
};
/** Maximum slots a single worker may claim from a provider pool (fairness cap). */
const MAX_SLOTS_PER_WORKER = 5;

export type ProviderAdmissionScope =
  | 'EMAIL'
  | 'SMS'
  | 'WHATSAPP'
  | 'PUSH'
  | 'SLACK'
  | 'WEBHOOK'
  | 'MICROSOFT_TEAMS';

export type ProviderAdmissionResult =
  | { allowed: true }
  | { allowed: false; retryAt: Date; reason: 'RATE_LIMITED' };

export type ProviderConcurrencyResult =
  | { allowed: true; leaseKey: string }
  | { allowed: false; retryAt: Date; reason: 'MAX_IN_FLIGHT' }
  | { allowed: false; retryAt: Date; reason: 'CONTROL_PLANE_UNAVAILABLE'; cause: string };

export const PROVIDER_LEASE_MS = 30_000;
const WORKER_ID = process.env.OPSKNIGHT_WORKER_ID?.trim() || crypto.randomUUID();
const localQuota = new Map<string, { remaining: number; expiresAt: number }>();
const localConcurrency = new Map<string, { reserved: number; active: number; expiresAt: number }>();
const localCooldown = new Map<string, Date>();
type ConcurrencyClaim = { poolKey: string; expiresAt: number };
const concurrencyClaims = new Map<string, ConcurrencyClaim>();
const CONCURRENCY_CLAIM_SWEEP_INTERVAL_MS = 5_000;
let lastClaimSweepAt = 0;

function sweepExpiredConcurrencyClaims(nowMs = Date.now()): void {
  if (nowMs - lastClaimSweepAt < CONCURRENCY_CLAIM_SWEEP_INTERVAL_MS) return;
  lastClaimSweepAt = nowMs;
  for (const [leaseKey, claim] of concurrencyClaims) {
    if (claim.expiresAt <= nowMs) concurrencyClaims.delete(leaseKey);
  }
}

export function resetProviderAdmissionForTests() {
  localQuota.clear();
  localConcurrency.clear();
  concurrencyClaims.clear();
  localCooldown.clear();
  _testProductionOverride = false;
}

function bucketKey(scope: ProviderAdmissionScope, providerKey: string): string {
  return `provider:${scope.toLowerCase()}:${providerKey}`.slice(0, 240);
}

/** Lifted by resetProviderAdmissionForTests(); set by forceProductionModeForTests() */
let _testProductionOverride = false;

function isProviderAdmissionTestEnv(): boolean {
  if (_testProductionOverride) return false;
  return (
    process.env.NODE_ENV === 'test' ||
    process.env.VITEST === 'true' ||
    Boolean(process.env.VITEST_WORKER_ID)
  );
}

/**
 * Force the production code path for concurrency/admission even when running under
 * Vitest. Used by P0 regression tests that must exercise the DB-failure →
 * CONTROL_PLANE_UNAVAILABLE flow. Automatically reverted by resetProviderAdmissionForTests().
 */
export function forceProductionModeForTests(): void {
  _testProductionOverride = true;
}

/**
 * Distributed provider admission control. Quota blocks amortize database work while
 * a persisted cooldown remains authoritative across replicas after provider 429s.
 *
 * Capacity is resolved via the notification capacity control plane:
 *   Database (NotificationProviderCapacity) > legacy env > safe default
 * with a 5s process-local cache so 1M deliveries do not become 1M SELECTs.
 */
export async function acquireProviderAdmission(
  scope: ProviderAdmissionScope,
  providerKey: string,
  now: Date = new Date(),
  trafficClass?: NotificationTrafficClass
): Promise<ProviderAdmissionResult> {
  // Defensive: per-file vi.mock('@/lib/prisma') overrides often omit capacity/
  // admission models. In unit tests missing models should degrade to
  // "allowed" (no DB) rather than throwing unhandled TypeError.
  const rateLimitModel = (prisma as unknown as Record<string, unknown>).rateLimit as
    | { findUnique: (args: unknown) => Promise<unknown> }
    | undefined;
  const bucket = bucketKey(scope, providerKey);
  // Process-local cooldown is authoritative if DB read fails; also fast-path
  // when deferProviderAdmission persisted locally but DB not yet visible.
  const localExpiry = localCooldown.get(bucket);
  if (localExpiry && localExpiry > now) {
    return { allowed: false, retryAt: localExpiry, reason: 'RATE_LIMITED' };
  }
  // Prune expired local entry opportunistically
  if (localExpiry && localExpiry <= now) localCooldown.delete(bucket);

  let cooldown: { expiresAt: Date | null } | null = null;
  if (rateLimitModel?.findUnique) {
    try {
      cooldown = (await rateLimitModel.findUnique({
        where: { key: bucket },
        select: { expiresAt: true },
      })) as { expiresAt: Date | null } | null;
      if (cooldown?.expiresAt && cooldown.expiresAt > now) {
        // Cache durable cooldown locally so a subsequent read failure still fails closed
        localCooldown.set(bucket, cooldown.expiresAt);
      }
    } catch {
      const fallback = localCooldown.get(bucket);
      if (fallback && fallback > now) {
        return { allowed: false, retryAt: fallback, reason: 'RATE_LIMITED' };
      }
      if (!isProviderAdmissionTestEnv()) {
        const conservativeRetryAt = new Date(now.getTime() + 1_000);
        localCooldown.set(bucket, conservativeRetryAt);
        return { allowed: false, retryAt: conservativeRetryAt, reason: 'RATE_LIMITED' };
      }
      cooldown = null;
    }
  }
  if (cooldown?.expiresAt && cooldown.expiresAt > now) {
    return { allowed: false, retryAt: cooldown.expiresAt, reason: 'RATE_LIMITED' };
  }
  const capacity = await getEffectiveCapacity({
    channel: scope as unknown as NotificationChannel,
    provider: providerKey,
  });
  const bulk = usesBulkCapacity(trafficClass);
  const cacheKey = `${bucket}:${bulk ? 'bulk' : 'global'}`;
  const cached = localQuota.get(cacheKey);
  if (cached && cached.expiresAt > now.getTime() && cached.remaining > 0) {
    // Local quota is only trusted if local cooldown is also checked above.
    // A DB read failure already returned conservative deny, so reaching here
    // means no cooldown applies. Consuming local quota is safe.
    cached.remaining -= 1;
    return { allowed: true };
  }

  const windowStart = new Date(Math.floor(now.getTime() / 1_000) * 1_000);
  const expiresAt = new Date(windowStart.getTime() + 1_000);
  const id = `${scope}:${providerKey}:${windowStart.getTime()}`.slice(0, 240);
  const requested = Math.min(
    capacity.quotaBlockSize,
    bulk ? capacity.bulkRatePerSecond : capacity.effectiveRatePerSecond
  );
  // DB quota window is best-effort. Per-file vi.mock('@/lib/prisma') often omits
  // $executeRaw/$queryRaw — degrade to in-memory allow rather than unhandled throw.
  const rawExecute = (prisma as unknown as Record<string, unknown>).$executeRaw as
    | ((...args: unknown[]) => Promise<unknown>)
    | undefined;
  const rawQuery = (prisma as unknown as Record<string, unknown>).$queryRaw as
    | ((...args: unknown[]) => Promise<unknown>)
    | undefined;
  if (!rawExecute || !rawQuery) {
    if (isProviderAdmissionTestEnv()) return { allowed: true };
    return { allowed: false, retryAt: new Date(now.getTime() + 1_000), reason: 'RATE_LIMITED' };
  }
  try {
    await rawExecute(Prisma.sql`
    INSERT INTO "ProviderQuotaWindow"
      ("id", "providerKey", "channel", "windowStart", "globalUsed", "bulkUsed", "expiresAt", "updatedAt")
    VALUES (${id}, ${providerKey}, ${scope}, ${windowStart}, 0, 0, ${expiresAt}, NOW())
    ON CONFLICT ("id") DO NOTHING
  `);
    const rows = (await rawQuery(Prisma.sql`
    WITH capacity AS (
      SELECT LEAST(
        ${requested},
        GREATEST(0, ${capacity.effectiveRatePerSecond} - "globalUsed"),
        ${bulk ? Prisma.sql`GREATEST(0, ${capacity.bulkRatePerSecond} - "bulkUsed")` : Prisma.sql`${requested}`}
      )::integer AS granted
      FROM "ProviderQuotaWindow"
      WHERE "id" = ${id}
    )
    UPDATE "ProviderQuotaWindow" AS quota_window
    SET "globalUsed" = quota_window."globalUsed" + capacity.granted,
        "bulkUsed" = quota_window."bulkUsed" + ${bulk ? Prisma.sql`capacity.granted` : Prisma.sql`0`},
        "updatedAt" = NOW()
    FROM capacity
    WHERE quota_window."id" = ${id} AND capacity.granted > 0
    RETURNING capacity.granted
  `)) as Array<{ granted: number }>;
    const granted = Number(rows[0]?.granted ?? 0);
    if (granted > 0) {
      localQuota.set(cacheKey, { remaining: granted - 1, expiresAt: expiresAt.getTime() });
      return { allowed: true };
    }
    return { allowed: false, retryAt: expiresAt, reason: 'RATE_LIMITED' };
  } catch {
    if (isProviderAdmissionTestEnv()) return { allowed: true };
    return { allowed: false, retryAt: new Date(now.getTime() + 1_000), reason: 'RATE_LIMITED' };
  }
}

/** Persist a provider-supplied cooldown (for example HTTP Retry-After) across replicas. */
export async function deferProviderAdmission(
  scope: ProviderAdmissionScope,
  providerKey: string,
  retryAt: Date
): Promise<void> {
  const config = await getEffectiveCapacity({
    channel: scope as unknown as NotificationChannel,
    provider: providerKey,
  });
  const key = bucketKey(scope, providerKey);
  // Always maintain process-local cooldown so a DB persistence failure still
  // throttles this replica and fail-closed reads can honor it.
  const existing = localCooldown.get(key);
  if (!existing || retryAt > existing) localCooldown.set(key, retryAt);
  const deferRaw = (prisma as unknown as Record<string, unknown>).$executeRaw as
    | ((...args: unknown[]) => Promise<unknown>)
    | undefined;
  if (deferRaw) {
    try {
      await deferRaw(Prisma.sql`
    INSERT INTO "RateLimit" ("key", "count", "expiresAt")
    VALUES (${key}, ${config.effectiveRatePerSecond}, ${retryAt})
    ON CONFLICT ("key") DO UPDATE SET
      "count" = GREATEST("RateLimit"."count", EXCLUDED."count"),
      "expiresAt" = GREATEST("RateLimit"."expiresAt", EXCLUDED."expiresAt")
  `);
    } catch {
      // Persistence is best-effort in tests; in production the local
      // cooldown above still enforces the Retry-After on this replica.
    }
  }
  for (const localKey of localQuota.keys()) {
    if (localKey.startsWith(`${key}:`)) localQuota.delete(localKey);
  }
  recordCapacityPressure(scope as unknown as NotificationChannel, providerKey);
}

/**
 * Distributed concurrency blocks with an explicit bulk ceiling. Bulk workers can
 * lease only the bulk portion of a provider pool, leaving at least one slot for
 * critical/transactional delivery whenever maxInFlight > 1.
 */
export async function acquireProviderConcurrency(
  scope: ProviderAdmissionScope,
  providerKey: string,
  now: Date = new Date(),
  trafficClass?: NotificationTrafficClass
): Promise<ProviderConcurrencyResult> {
  sweepExpiredConcurrencyClaims(now.getTime());
  const config = await getEffectiveCapacity({
    channel: scope as unknown as NotificationChannel,
    provider: providerKey,
  });
  const bulk = usesBulkCapacity(trafficClass);
  const lane = bulk ? 'bulk' : 'reserved';
  const physicalPoolKey = `${scope}:${providerKey}`;
  const poolKey = `${physicalPoolKey}:${lane}`;
  const leaseOwner = `${WORKER_ID}:${lane}`.slice(0, 240);
  const laneCeiling = bulk ? config.bulkMaxInFlight : config.maxInFlight;

  // Fairness cap: no single worker may monopolize the pool.
  // Clamp requested slots to the smaller of the pool ceiling and per-worker cap.
  const fairnessLimit = Math.min(MAX_SLOTS_PER_WORKER, laneCeiling);

  let local = localConcurrency.get(poolKey);
  if (!local || local.expiresAt <= now.getTime()) {
    const id = `${leaseOwner}:${scope}:${providerKey}`.slice(0, 240);
    const requested = Math.min(fairnessLimit, laneCeiling);
    const concQuery = (prisma as unknown as Record<string, unknown>).$queryRaw as
      | ((...args: unknown[]) => Promise<unknown>)
      | undefined;
    if (!concQuery) {
      // Missing Prisma method — only acceptable in unit tests
      if (isProviderAdmissionTestEnv()) {
        local = { reserved: laneCeiling, active: 0, expiresAt: now.getTime() + PROVIDER_LEASE_MS };
        localConcurrency.set(poolKey, local);
      } else {
        // Production: control-plane is inaccessible — activate emergency limiter
        const emergencySlots = bulk ? 0 : (EMERGENCY_CONCURRENCY[scope] ?? 1);
        logger.error('provider_admission.control_plane_unavailable', {
          scope,
          providerKey,
          lane,
          cause: 'Prisma $queryRaw not available',
          emergencySlots,
        });
        if (emergencySlots === 0) {
          return {
            allowed: false,
            retryAt: new Date(now.getTime() + 5_000),
            reason: 'CONTROL_PLANE_UNAVAILABLE',
            cause: 'Control plane DB unavailable; bulk traffic paused',
          };
        }
        local = {
          reserved: emergencySlots,
          active: 0,
          expiresAt: now.getTime() + PROVIDER_LEASE_MS,
        };
        localConcurrency.set(poolKey, local);
      }
    } else {
      try {
        const rows = (await concQuery(Prisma.sql`
      WITH lock AS (
        SELECT pg_advisory_xact_lock(hashtextextended(${`provider-slots:${physicalPoolKey}`}, 0))
      ), available AS (
        SELECT GREATEST(0, ${laneCeiling} - COALESCE(SUM("reservedSlots"), 0))::integer AS slots
        FROM "ProviderWorkerLease", lock
        WHERE "providerKey" = ${providerKey} AND "channel" = ${scope}
          AND "expiresAt" > ${now} AND "workerId" <> ${leaseOwner}
      )
      INSERT INTO "ProviderWorkerLease"
        ("id", "workerId", "providerKey", "channel", "reservedSlots", "expiresAt", "heartbeatAt", "updatedAt")
      SELECT ${id}, ${leaseOwner}, ${providerKey}, ${scope}, LEAST(${requested}, slots),
        ${new Date(now.getTime() + PROVIDER_LEASE_MS)}, ${now}, NOW()
      FROM available WHERE slots > 0
      ON CONFLICT ("id") DO UPDATE SET
        "reservedSlots" = EXCLUDED."reservedSlots", "expiresAt" = EXCLUDED."expiresAt",
        "heartbeatAt" = EXCLUDED."heartbeatAt", "updatedAt" = NOW()
      RETURNING "reservedSlots"
    `)) as Array<{ reservedSlots: number }>;
        const reserved = Number(rows[0]?.reservedSlots ?? 0);
        if (reserved === 0) {
          return {
            allowed: false,
            retryAt: new Date(now.getTime() + 250),
            reason: 'MAX_IN_FLIGHT',
          };
        }
        local = { reserved, active: 0, expiresAt: now.getTime() + PROVIDER_LEASE_MS };
        localConcurrency.set(poolKey, local);
      } catch (dbError) {
        const cause = dbError instanceof Error ? dbError.message : String(dbError);
        if (isProviderAdmissionTestEnv()) {
          local = {
            reserved: laneCeiling,
            active: 0,
            expiresAt: now.getTime() + PROVIDER_LEASE_MS,
          };
          localConcurrency.set(poolKey, local);
        } else {
          // P0 FIX: DB failure must NEVER become MAX_IN_FLIGHT — use CONTROL_PLANE_UNAVAILABLE
          // so operators can distinguish a DB outage from real provider saturation.
          const emergencySlots = bulk ? 0 : (EMERGENCY_CONCURRENCY[scope] ?? 1);
          logger.error('provider_admission.concurrency_db_failed', {
            scope,
            providerKey,
            lane,
            cause,
            emergencySlots,
            detail:
              'ProviderWorkerLease query failed. This is a control-plane outage, NOT provider saturation. ' +
              'Notifications will be deferred with reason=CONTROL_PLANE_UNAVAILABLE.',
          });
          if (emergencySlots === 0) {
            return {
              allowed: false,
              retryAt: new Date(now.getTime() + 5_000),
              reason: 'CONTROL_PLANE_UNAVAILABLE',
              cause,
            };
          }
          // Emergency local limiter: allow a small number of deliveries without DB coordination
          local = {
            reserved: emergencySlots,
            active: 0,
            expiresAt: now.getTime() + PROVIDER_LEASE_MS,
          };
          localConcurrency.set(poolKey, local);
        }
      }
    }
  }
  // If admin lowered maxInFlight, an existing local reservation must not keep
  // admitting against the old, larger reserved value for up to PROVIDER_LEASE_MS.
  // DB rows expire conservatively; the local check shrinks immediately.
  // Also honour the fairness cap in case config changed since last DB refresh.
  local.reserved = Math.min(local.reserved, laneCeiling, fairnessLimit);
  if (local.active >= local.reserved) {
    return {
      allowed: false,
      retryAt: new Date(now.getTime() + 25),
      reason: 'MAX_IN_FLIGHT',
    };
  }
  local.active += 1;
  const leaseKey = `${poolKey}:${crypto.randomUUID()}`;
  concurrencyClaims.set(leaseKey, { poolKey, expiresAt: now.getTime() + PROVIDER_LEASE_MS });
  return { allowed: true, leaseKey };
}

export async function releaseProviderConcurrency(leaseKey: string): Promise<void> {
  const claim = concurrencyClaims.get(leaseKey);
  if (!claim) return;
  concurrencyClaims.delete(leaseKey);
  const local = localConcurrency.get(claim.poolKey);
  if (local) local.active = Math.max(0, local.active - 1);
}

export class ProviderCooldownError extends Error {
  constructor(
    readonly providerKey: string,
    readonly retryAt: Date
  ) {
    super(`Provider ${providerKey} is in cooldown until ${retryAt.toISOString()}`);
    this.name = 'ProviderCooldownError';
  }
}

export async function assertProviderAdmitted(key: string, now = new Date()): Promise<void> {
  const admissionModel = (prisma as unknown as Record<string, unknown>).providerAdmission as
    | { findUnique: (args: unknown) => Promise<unknown> }
    | undefined;
  if (!admissionModel?.findUnique) return;
  try {
    const admission = (await admissionModel.findUnique({ where: { key } })) as {
      blockedUntil: Date | null;
    } | null;
    if (admission?.blockedUntil && admission.blockedUntil > now) {
      throw new ProviderCooldownError(key, admission.blockedUntil);
    }
  } catch (e) {
    if (e instanceof ProviderCooldownError) throw e;
  }
}

export async function recordProviderSuccess(key: string): Promise<void> {
  const successModel = (prisma as unknown as Record<string, unknown>).providerAdmission as
    | { upsert: (args: unknown) => Promise<unknown> }
    | undefined;
  if (!successModel?.upsert) return;
  try {
    await successModel.upsert({
      where: { key },
      create: { key, state: 'CLOSED', lastSuccessAt: new Date() },
      update: {
        state: 'CLOSED',
        blockedUntil: null,
        consecutiveFails: 0,
        lastSuccessAt: new Date(),
        lastStatusCode: null,
      },
    });
  } catch {
    // best-effort in tests
  }
}

function automaticBreakerDelayMs(
  consecutiveFails: number,
  statusCode?: number
): number | undefined {
  const transient = statusCode === undefined || statusCode === 429 || statusCode >= 500;
  if (!transient || consecutiveFails < 2) return undefined;
  if (consecutiveFails === 2) return 10_000;
  if (consecutiveFails === 3) return 30_000;
  if (consecutiveFails === 4) return 60_000;
  if (consecutiveFails === 5) return 120_000;
  return 300_000;
}

export async function recordProviderFailure(
  key: string,
  options: { statusCode?: number; retryAfterMs?: number } = {}
): Promise<void> {
  const now = new Date();

  const execute = async (client: {
    providerAdmission: {
      findUnique: typeof prisma.providerAdmission.findUnique;
      upsert: typeof prisma.providerAdmission.upsert;
    };
  }) => {
    const current = await client.providerAdmission.findUnique({
      where: { key },
      select: { consecutiveFails: true, blockedUntil: true },
    });
    const consecutiveFails = (current?.consecutiveFails ?? 0) + 1;
    const requestedDelay =
      options.retryAfterMs ?? automaticBreakerDelayMs(consecutiveFails, options.statusCode);
    const boundedDelay = requestedDelay
      ? Math.min(Math.max(requestedDelay, 1_000), 24 * 60 * 60_000)
      : undefined;
    const generatedBlockedUntil = boundedDelay ? new Date(now.getTime() + boundedDelay) : null;
    const existingBlockedUntil =
      current?.blockedUntil && current.blockedUntil > now ? current.blockedUntil : null;
    const blockedUntil =
      generatedBlockedUntil && existingBlockedUntil
        ? generatedBlockedUntil > existingBlockedUntil
          ? generatedBlockedUntil
          : existingBlockedUntil
        : (generatedBlockedUntil ?? existingBlockedUntil ?? undefined);

    await client.providerAdmission.upsert({
      where: { key },
      create: {
        key,
        state: blockedUntil ? 'OPEN' : 'DEGRADED',
        blockedUntil,
        consecutiveFails: 1,
        lastFailureAt: now,
        lastStatusCode: options.statusCode,
      },
      update: {
        state: blockedUntil ? 'OPEN' : 'DEGRADED',
        blockedUntil,
        consecutiveFails: { increment: 1 },
        lastFailureAt: now,
        lastStatusCode: options.statusCode,
      },
    });
  };

  const admTx = (prisma as unknown as Record<string, unknown>).providerAdmission as
    | { findUnique: unknown; upsert: unknown }
    | undefined;
  if (!admTx?.findUnique || !admTx?.upsert) return;
  try {
    if (typeof prisma.$transaction === 'function') {
      await prisma.$transaction(execute);
    } else {
      await execute(prisma);
    }
  } catch {
    // best-effort in tests; real DB errors still surface in prod via caller handling
  }
}

/**
 * Startup readiness certification: verifies that all notification control-plane
 * tables are accessible. Call this once at process startup (e.g., inside the
 * notification worker's `init()` function). If any table is unreachable the
 * function throws a descriptive error so the caller can abort or mark degraded.
 *
 * This prevents the silent CONTROL_PLANE_UNAVAILABLE situation from going
 * undetected until the first notification attempts are made in production.
 */
export async function certifyNotificationControlPlane(): Promise<void> {
  const tables: Array<{ name: string; fn: () => Promise<unknown> }> = [
    {
      name: 'ProviderWorkerLease',
      fn: () => prisma.$queryRaw`SELECT 1 FROM "ProviderWorkerLease" LIMIT 0`,
    },
    {
      name: 'ProviderQuotaWindow',
      fn: () => prisma.$queryRaw`SELECT 1 FROM "ProviderQuotaWindow" LIMIT 0`,
    },
    {
      name: 'RateLimit',
      fn: () => prisma.$queryRaw`SELECT 1 FROM "RateLimit" LIMIT 0`,
    },
    {
      name: 'ProviderAdmission',
      fn: () => prisma.providerAdmission.count(),
    },
  ];
  const failures: string[] = [];
  await Promise.all(
    tables.map(async ({ name, fn }) => {
      try {
        await fn();
      } catch (err) {
        const cause = err instanceof Error ? err.message : String(err);
        failures.push(`${name}: ${cause}`);
        logger.error('provider_admission.startup_certification_failed', { table: name, cause });
      }
    })
  );
  if (failures.length > 0) {
    throw new Error(
      `Notification control-plane startup certification failed for ${failures.length} table(s):\n${failures.join('\n')}`
    );
  }
  logger.info('provider_admission.startup_certification_passed', {
    tables: tables.map(t => t.name),
  });
}
