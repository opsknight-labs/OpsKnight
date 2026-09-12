import type { NotificationChannel, NotificationTrafficClass } from '@prisma/client';
import type { ProviderAdmissionScope } from './provider-admission';
import { DEFAULT_BULK_SHARE, defaultInFlight, defaultRate } from './notification-capacity/defaults';
import { HARD_LIMITS } from './notification-capacity/hard-limits';
import {
  getEffectiveCapacity,
  getEffectiveWatermarks as resolverWatermarks,
  recordCapacityPressure as resolverPressure,
  recordHealthyCapacity as resolverHealthy,
  resetCapacityResolverForTests,
} from './notification-capacity/resolver';

const ABSOLUTE_RATE_CEILING = HARD_LIMITS.ratePerSecond.max;
const ABSOLUTE_IN_FLIGHT_CEILING = HARD_LIMITS.maxInFlight.max;

export interface ProviderCapacity {
  configuredRatePerSecond: number;
  effectiveRatePerSecond: number;
  bulkRatePerSecond: number;
  maxInFlight: number;
  bulkMaxInFlight: number;
  adaptiveBackpressure: boolean;
  quotaBlockSize: number;
}

function integerSetting(raw: string | undefined, fallback: number, min: number, max: number) {
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

function shareSetting(raw: string | undefined): number {
  if (!raw) return DEFAULT_BULK_SHARE;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0.05 && parsed <= 1 ? parsed : DEFAULT_BULK_SHARE;
}

function envValue(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = Reflect.get(env, key);
  return typeof value === 'string' ? value : undefined;
}

/**
 * Legacy synchronous resolver preserved for unit tests and the single sanctioned
 * compatibility path inside `notification-capacity/resolver.ts`. Product code
 * outside tests must use `getEffectiveProviderCapacity` — the async DB-backed
 * resolver with 5s process-local cache so 1M deliveries do not become 1M SELECTs.
 *
 * Resolution precedence (resolver.ts): Database > legacy env > safe default.
 * Hard ceilings always apply.
 */
export function getProviderCapacity(
  scope: ProviderAdmissionScope,
  providerKey = 'default',
  env: NodeJS.ProcessEnv = process.env
): ProviderCapacity {
  const providerEnvKey = providerKey.toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 80);
  const scoped = (suffix: string) =>
    envValue(env, `NOTIFICATION_${scope}_${providerEnvKey}_${suffix}`) ??
    envValue(env, `NOTIFICATION_${scope}_${suffix}`);
  const configuredRatePerSecond = integerSetting(
    scoped('RATE_PER_SECOND'),
    defaultRate(scope as NotificationChannel),
    1,
    ABSOLUTE_RATE_CEILING
  );
  const deploymentRateCeiling = integerSetting(
    env.NOTIFICATION_DEPLOYMENT_RATE_CEILING,
    ABSOLUTE_RATE_CEILING,
    1,
    ABSOLUTE_RATE_CEILING
  );
  const hardRate = Math.min(configuredRatePerSecond, deploymentRateCeiling);
  const adaptiveBackpressure = env.NOTIFICATION_ADAPTIVE_BACKPRESSURE !== 'false';
  const bulkShare = shareSetting(env.NOTIFICATION_BULK_SHARE);
  const bulkRatePerSecond = Math.max(1, Math.floor(hardRate * bulkShare));
  const maxInFlight = integerSetting(
    scoped('MAX_IN_FLIGHT'),
    defaultInFlight(scope as NotificationChannel),
    1,
    ABSOLUTE_IN_FLIGHT_CEILING
  );
  const bulkMaxInFlight =
    maxInFlight <= 1 ? 1 : Math.max(1, Math.min(maxInFlight - 1, Math.floor(maxInFlight * bulkShare)));
  return {
    configuredRatePerSecond,
    effectiveRatePerSecond: hardRate,
    bulkRatePerSecond,
    maxInFlight,
    bulkMaxInFlight,
    adaptiveBackpressure,
    quotaBlockSize: integerSetting(env.NOTIFICATION_QUOTA_BLOCK_SIZE, 100, 1, 1_000),
  };
}

export async function getEffectiveProviderCapacity(
  scope: ProviderAdmissionScope,
  providerKey = 'default'
): Promise<ProviderCapacity & { mode: 'AUTO' | 'CUSTOM'; source: string; bulkShare: number; revision: number | null }> {
  const effective = await getEffectiveCapacity({ channel: scope as NotificationChannel, provider: providerKey });
  return {
    configuredRatePerSecond: effective.configuredRatePerSecond,
    effectiveRatePerSecond: effective.effectiveRatePerSecond,
    bulkRatePerSecond: effective.bulkRatePerSecond,
    maxInFlight: effective.maxInFlight,
    bulkMaxInFlight: effective.bulkMaxInFlight,
    adaptiveBackpressure: effective.adaptiveBackpressure,
    quotaBlockSize: effective.quotaBlockSize,
    mode: effective.mode,
    source: effective.source,
    bulkShare: effective.bulkShare,
    revision: effective.revision,
  };
}

// Keep adaptation behavior through the resolver's single map so DB and env
// paths converge on the same effective-rate recovery curve.
export function recordCapacityPressure(scope: ProviderAdmissionScope, providerKey: string): number {
  return resolverPressure(scope as NotificationChannel, providerKey);
}

export function recordHealthyCapacity(scope: ProviderAdmissionScope, providerKey: string): number {
  return resolverHealthy(scope as NotificationChannel, providerKey);
}

export function usesBulkCapacity(trafficClass: NotificationTrafficClass | undefined): boolean {
  return trafficClass === 'PUBLIC_INCIDENT' || trafficClass === 'BULK';
}

export function resetProviderCapacityForTests(): void {
  resetCapacityResolverForTests();
}

// Exposed for fanout watermark migration — prefer getEffectiveWatermarks().
export async function getEffectiveWatermarks() {
  return resolverWatermarks();
}
