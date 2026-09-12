import type { NotificationChannel } from '@prisma/client';
import prisma from '@/lib/prisma';
import { CACHE_TTLS, capacityCache, runtimeCache } from './cache';
import {
  DEFAULT_ADAPTIVE_BACKPRESSURE,
  DEFAULT_BULK_QUEUE_HIGH_WATERMARK,
  DEFAULT_BULK_QUEUE_LOW_WATERMARK,
  DEFAULT_BULK_SHARE,
  DEFAULT_QUOTA_BLOCK_SIZE,
  defaultInFlight,
  defaultRate,
} from './defaults';
import { clampInt, HARD_LIMITS } from './hard-limits';
import type { CapacitySource, EffectiveCapacityConfig } from './types';

function normalizedProvider(provider: string): string {
  return provider.trim().toLowerCase();
}

function envValue(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = Reflect.get(env, key);
  return typeof value === 'string' ? value : undefined;
}

function integerSetting(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

function shareFromEnv(raw: string | undefined, fallback = DEFAULT_BULK_SHARE): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0.05 && parsed <= 1 ? parsed : fallback;
}

function boundedQuotaBlockSize(env: NodeJS.ProcessEnv): number {
  return integerSetting(env.NOTIFICATION_QUOTA_BLOCK_SIZE, DEFAULT_QUOTA_BLOCK_SIZE, HARD_LIMITS.quotaBlockSize.min, HARD_LIMITS.quotaBlockSize.max);
}

const adaptiveRates = new Map<string, { rate: number; changedAt: number }>();
const ADAPTIVE_RECOVERY_INTERVAL_MS = 5_000;
const ADAPTIVE_MAX_ENTRIES = 1024;
let adaptiveEvictionsTotal = 0;

function setAdaptiveRate(key: string, rate: number, nowMs: number) {
  if (adaptiveRates.has(key)) adaptiveRates.delete(key);
  else if (adaptiveRates.size >= ADAPTIVE_MAX_ENTRIES) {
    const oldest = adaptiveRates.keys().next().value as string | undefined;
    if (oldest !== undefined) {
      adaptiveRates.delete(oldest);
      adaptiveEvictionsTotal++;
    }
  }
  adaptiveRates.set(key, { rate, changedAt: nowMs });
}

function capacityKey(channel: string, provider: string): string {
  return `${channel}:${provider}`;
}

function recoverAdaptiveRate(key: string, hardRate: number, configured: number, nowMs: number): number {
  const state = adaptiveRates.get(key);
  if (!state) return hardRate;
  const elapsed = Math.max(0, nowMs - state.changedAt);
  const steps = Math.floor(elapsed / ADAPTIVE_RECOVERY_INTERVAL_MS);
  if (steps <= 0) return Math.min(hardRate, state.rate);
  const increment = Math.max(1, Math.ceil(configured * 0.05));
  const recovered = Math.min(hardRate, state.rate + steps * increment);
  if (recovered >= hardRate) {
    adaptiveRates.delete(key);
    return hardRate;
  }
  setAdaptiveRate(key, recovered, state.changedAt + steps * ADAPTIVE_RECOVERY_INTERVAL_MS);
  return recovered;
}

async function resolveRuntimeSettingsCached(nowMs: number) {
  // runtimeCache distinguishes undefined (miss/expired) from null (cached absence)
  const cached = runtimeCache.get('runtime', nowMs) as
    | Awaited<ReturnType<typeof prisma.notificationRuntimeSettings.findUnique>>
    | null
    | undefined;
  if (cached !== undefined) return cached;
  const record = await prisma.notificationRuntimeSettings.findUnique({ where: { id: 'default' } });
  // Cache null (no row yet) as negative cache so fanout doesn't hammer Postgres before first admin save.
  runtimeCache.set('runtime', record as unknown as null, nowMs, CACHE_TTLS.runtimeTtlMs);
  return record;
}

function resolveEnvCapacity(
  channel: NotificationChannel,
  provider: string,
  env: NodeJS.ProcessEnv
): { configuredRate?: number; configuredInFlight?: number; bulkShare?: number; adaptive?: boolean; ceiling: number; quotaBlockSize: number; hasAny: boolean } {
  const providerEnvKey = provider.toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 80);
  const scoped = (suffix: string) =>
    envValue(env, `NOTIFICATION_${channel}_${providerEnvKey}_${suffix}`) ?? envValue(env, `NOTIFICATION_${channel}_${suffix}`);
  const rateRaw = scoped('RATE_PER_SECOND');
  const inFlightRaw = scoped('MAX_IN_FLIGHT');
  const bulkShareRaw = env.NOTIFICATION_BULK_SHARE;
  const adaptiveRaw = env.NOTIFICATION_ADAPTIVE_BACKPRESSURE;
  // Only capacity-relevant env vars drive the ENV branch. Deployment ceiling and
  // quota-block size are independent infrastructure clamps and must not hijack
  // DB-owned bulkShare/adaptive values (e.g. DB 50% + emergency ceiling=1000
  // must keep the DB's 50%, not fall through to the env-default 80%).
  const hasRate = Boolean(rateRaw && Number.isSafeInteger(Number(rateRaw)) && Number(rateRaw) >= HARD_LIMITS.ratePerSecond.min && Number(rateRaw) <= HARD_LIMITS.ratePerSecond.max);
  const hasInFlight = Boolean(inFlightRaw && Number.isSafeInteger(Number(inFlightRaw)) && Number(inFlightRaw) >= HARD_LIMITS.maxInFlight.min && Number(inFlightRaw) <= HARD_LIMITS.maxInFlight.max);
  const hasBulkShare = typeof bulkShareRaw === 'string' && bulkShareRaw.trim() !== '' && Number.isFinite(Number(bulkShareRaw)) && Number(bulkShareRaw) >= 0.05 && Number(bulkShareRaw) <= 1;
  const hasAdaptive = typeof adaptiveRaw === 'string' && adaptiveRaw.trim() !== '';
  const hasAny = Boolean(hasRate || hasInFlight || hasBulkShare || hasAdaptive);
  let configuredRate: number | undefined;
  if (hasRate) configuredRate = Number(rateRaw);
  let configuredInFlight: number | undefined;
  if (hasInFlight) configuredInFlight = Number(inFlightRaw);
  return {
    configuredRate,
    configuredInFlight,
    bulkShare: hasBulkShare ? shareFromEnv(bulkShareRaw) : undefined,
    adaptive: hasAdaptive ? adaptiveRaw !== 'false' : undefined,
    ceiling: integerSetting(env.NOTIFICATION_DEPLOYMENT_RATE_CEILING, HARD_LIMITS.ratePerSecond.max, 1, HARD_LIMITS.ratePerSecond.max),
    quotaBlockSize: boundedQuotaBlockSize(env),
    hasAny,
  };
}

function computeBulkInFlight(maxInFlight: number, bulkShare: number): number {
  if (maxInFlight <= 1) return 1;
  return Math.max(1, Math.min(maxInFlight - 1, Math.floor(maxInFlight * bulkShare)));
}

export async function getEffectiveCapacity(input: {
  channel: NotificationChannel;
  provider: string;
  env?: NodeJS.ProcessEnv;
  nowMs?: number;
}): Promise<EffectiveCapacityConfig> {
  const channel = input.channel;
  const provider = normalizedProvider(input.provider || 'default');
  const env = input.env ?? process.env;
  const nowMs = input.nowMs ?? Date.now();
  const cacheKey = `${channel}:${provider}`;
  const cached = capacityCache.get(cacheKey, nowMs) as EffectiveCapacityConfig | undefined;
  if (cached !== undefined) {
    // Cheap refresh for adaptive recovery without re-querying Postgres every call.
    if (cached.adaptiveBackpressure) {
      const key = capacityKey(channel, provider);
      const effective = recoverAdaptiveRate(key, Math.min(cached.configuredRatePerSecond, integerSetting(env.NOTIFICATION_DEPLOYMENT_RATE_CEILING, HARD_LIMITS.ratePerSecond.max, 1, HARD_LIMITS.ratePerSecond.max)), cached.configuredRatePerSecond, nowMs);
      const bulkRate = Math.max(1, Math.floor(effective * cached.bulkShare));
      return { ...cached, effectiveRatePerSecond: Math.max(1, Math.min(cached.configuredRatePerSecond, effective)), bulkRatePerSecond: bulkRate } as EffectiveCapacityConfig;
    }
    return cached;
  }

  const runtimePromise = resolveRuntimeSettingsCached(nowMs);
  let stored = await prisma.notificationProviderCapacity.findUnique({ where: { provider_channel: { provider, channel } } });
  // WEBHOOK/SLACK admission uses dynamic bucket keys (e.g. WEBHOOK:<origin>) but is
  // governed by a single logical profile WEBHOOK:default (similarly SLACK:default).
  // Without a fallback an admin saving WEBHOOK:default would see no effect on
  // actual webhook deliveries because each origin would resolve to DEFAULT.
  if (!stored && (channel === 'WEBHOOK' || channel === 'SLACK') && provider !== 'default') {
    stored = await prisma.notificationProviderCapacity.findUnique({ where: { provider_channel: { provider: 'default', channel } } });
  }
  const runtime = await runtimePromise;

  const runtimeBulkShare = runtime ? runtime.defaultBulkSharePercent / 100 : DEFAULT_BULK_SHARE;
  const envCapacity = resolveEnvCapacity(channel, provider, env);
  const deploymentCeiling = integerSetting(env.NOTIFICATION_DEPLOYMENT_RATE_CEILING, HARD_LIMITS.ratePerSecond.max, 1, HARD_LIMITS.ratePerSecond.max);

  let source: CapacitySource;
  let mode: 'AUTO' | 'CUSTOM' = 'AUTO';
  let configuredRate: number;
  let configuredInFlight: number;
  let bulkShare: number;
  let adaptiveBackpressure: boolean;
  let revision: number | null = null;

  if (stored) {
    source = 'DATABASE';
    mode = stored.mode as 'AUTO' | 'CUSTOM';
    if (mode === 'CUSTOM') {
      configuredRate = stored.ratePerSecond ?? defaultRate(channel);
      configuredInFlight = stored.maxInFlight ?? defaultInFlight(channel);
    } else {
      configuredRate = defaultRate(channel);
      configuredInFlight = defaultInFlight(channel);
    }
    bulkShare = (stored.bulkSharePercent ?? runtime?.defaultBulkSharePercent ?? Math.round(DEFAULT_BULK_SHARE * 100)) / 100;
    adaptiveBackpressure = stored.adaptiveBackpressure;
    revision = stored.revision;
  } else if (envCapacity.hasAny) {
    source = 'ENV';
    configuredRate = envCapacity.configuredRate ?? defaultRate(channel);
    configuredInFlight = envCapacity.configuredInFlight ?? defaultInFlight(channel);
    bulkShare = envCapacity.bulkShare ?? runtimeBulkShare;
    adaptiveBackpressure = envCapacity.adaptive ?? runtime?.adaptiveBackpressure ?? DEFAULT_ADAPTIVE_BACKPRESSURE;
    mode = 'CUSTOM';
  } else {
    source = 'DEFAULT';
    configuredRate = defaultRate(channel);
    configuredInFlight = defaultInFlight(channel);
    bulkShare = runtimeBulkShare;
    adaptiveBackpressure = runtime?.adaptiveBackpressure ?? DEFAULT_ADAPTIVE_BACKPRESSURE;
    mode = 'AUTO';
  }

  configuredRate = Math.min(HARD_LIMITS.ratePerSecond.max, Math.max(HARD_LIMITS.ratePerSecond.min, configuredRate));
  configuredInFlight = Math.min(HARD_LIMITS.maxInFlight.max, Math.max(HARD_LIMITS.maxInFlight.min, configuredInFlight));
  bulkShare = Math.min(0.95, Math.max(0.05, bulkShare));

  const hardRate = Math.min(configuredRate, deploymentCeiling);
  const adaptiveRate = adaptiveBackpressure ? recoverAdaptiveRate(cacheKey, hardRate, configuredRate, nowMs) : hardRate;
  const effectiveRatePerSecond = Math.max(1, Math.min(hardRate, adaptiveRate));
  const bulkRatePerSecond = Math.max(1, Math.floor(effectiveRatePerSecond * bulkShare));
  const bulkMaxInFlight = computeBulkInFlight(configuredInFlight, bulkShare);
  const quotaBlockSize = boundedQuotaBlockSize(env);

  const effective: EffectiveCapacityConfig = {
    channel,
    provider,
    mode,
    configuredRatePerSecond: configuredRate,
    effectiveRatePerSecond,
    bulkRatePerSecond,
    maxInFlight: configuredInFlight,
    bulkMaxInFlight,
    quotaBlockSize,
    bulkShare,
    adaptiveBackpressure,
    source,
    revision,
  };
  capacityCache.set(cacheKey, effective, nowMs, CACHE_TTLS.capacityTtlMs);
  return effective;
}

export async function getEffectiveWatermarks(input?: { env?: NodeJS.ProcessEnv; nowMs?: number }): Promise<{
  low: number;
  high: number;
  defaultBulkSharePercent: number;
  adaptiveBackpressure: boolean;
  source: CapacitySource;
  revision: number | null;
}> {
  const env = input?.env ?? process.env;
  const nowMs = input?.nowMs ?? Date.now();
  const runtime = (await resolveRuntimeSettingsCached(nowMs)) as Awaited<ReturnType<typeof prisma.notificationRuntimeSettings.findUnique>> | null;
  if (runtime) {
    // Defense in depth: a bad manual DB edit or stale migration must not widen into an invalid fanout.
    const lowClamped = clampInt(runtime.bulkQueueLowWatermark, HARD_LIMITS.queueLowWatermark.min, HARD_LIMITS.queueLowWatermark.max);
    const highClamped = clampInt(runtime.bulkQueueHighWatermark, HARD_LIMITS.queueHighWatermark.min, HARD_LIMITS.queueHighWatermark.max);
    return {
      low: lowClamped,
      high: Math.max(lowClamped, highClamped),
      defaultBulkSharePercent: clampInt(runtime.defaultBulkSharePercent, HARD_LIMITS.bulkSharePercent.min, HARD_LIMITS.bulkSharePercent.max),
      adaptiveBackpressure: runtime.adaptiveBackpressure,
      source: 'DATABASE',
      revision: runtime.revision,
    };
  }
  const envLowRaw = env.NOTIFICATION_BULK_QUEUE_LOW_WATERMARK;
  const envHighRaw = env.NOTIFICATION_BULK_QUEUE_HIGH_WATERMARK;
  const envBulkRaw = env.NOTIFICATION_BULK_SHARE;
  const envAdaptiveRaw = env.NOTIFICATION_ADAPTIVE_BACKPRESSURE;
  const hasEnvLowHigh = Boolean(envLowRaw || envHighRaw);
  const hasBulkShare = typeof envBulkRaw === 'string' && envBulkRaw.trim() !== '' && Number.isFinite(Number(envBulkRaw)) && Number(envBulkRaw) >= 0.05 && Number(envBulkRaw) <= 1;
  const hasAdaptive = typeof envAdaptiveRaw === 'string' && envAdaptiveRaw.trim() !== '';
  const hasEnv = hasEnvLowHigh || hasBulkShare || hasAdaptive;
  if (hasEnv) {
    const boundedLow = (value: string | undefined, fallback: number) => {
      const parsed = Number(value);
      return Number.isSafeInteger(parsed) &&
        parsed >= HARD_LIMITS.queueLowWatermark.min &&
        parsed <= HARD_LIMITS.queueLowWatermark.max
        ? parsed
        : fallback;
    };
    const boundedHigh = (value: string | undefined, fallback: number) => {
      const parsed = Number(value);
      return Number.isSafeInteger(parsed) &&
        parsed >= HARD_LIMITS.queueHighWatermark.min &&
        parsed <= HARD_LIMITS.queueHighWatermark.max
        ? parsed
        : fallback;
    };
    const low = boundedLow(envLowRaw, DEFAULT_BULK_QUEUE_LOW_WATERMARK);
    const high = boundedHigh(envHighRaw, DEFAULT_BULK_QUEUE_HIGH_WATERMARK);
    const bulkPercent = hasBulkShare ? Math.round(shareFromEnv(envBulkRaw) * 100) : Math.round(DEFAULT_BULK_SHARE * 100);
    const adaptive = hasAdaptive ? envAdaptiveRaw !== 'false' : DEFAULT_ADAPTIVE_BACKPRESSURE;
    return {
      low,
      high: Math.max(low, high),
      defaultBulkSharePercent: clampInt(bulkPercent, HARD_LIMITS.bulkSharePercent.min, HARD_LIMITS.bulkSharePercent.max),
      adaptiveBackpressure: adaptive,
      source: 'ENV',
      revision: null,
    };
  }
  return {
    low: DEFAULT_BULK_QUEUE_LOW_WATERMARK,
    high: Math.max(DEFAULT_BULK_QUEUE_LOW_WATERMARK, DEFAULT_BULK_QUEUE_HIGH_WATERMARK),
    defaultBulkSharePercent: Math.round(DEFAULT_BULK_SHARE * 100),
    adaptiveBackpressure: DEFAULT_ADAPTIVE_BACKPRESSURE,
    source: 'DEFAULT',
    revision: null,
  };
}

export function recordCapacityPressure(channel: NotificationChannel, provider: string, nowMs = Date.now()): number {
  const effectiveKey = `${channel}:${normalizedProvider(provider || 'default')}`;
  const cached = capacityCache.get(effectiveKey, nowMs) as EffectiveCapacityConfig | undefined;
  let configured: number;
  if (cached !== undefined) configured = cached.configuredRatePerSecond;
  else {
    const envCap = resolveEnvCapacity(channel, normalizedProvider(provider || 'default'), process.env);
    configured = envCap.configuredRate ?? defaultRate(channel);
  }
  const adaptiveCurrent = adaptiveRates.get(effectiveKey)?.rate;
  const current = adaptiveCurrent ?? cached?.effectiveRatePerSecond ?? configured;
  const reduced = Math.max(1, Math.floor(current / 2));
  setAdaptiveRate(effectiveKey, reduced, nowMs);
  // Invalidate so the next admission recomputes effective.
  capacityCache.invalidate(effectiveKey);
  return reduced;
}

export function recordHealthyCapacity(channel: NotificationChannel, provider: string, nowMs = Date.now()): number {
  const effectiveKey = `${channel}:${normalizedProvider(provider || 'default')}`;
  const cached = capacityCache.get(effectiveKey, nowMs) as EffectiveCapacityConfig | undefined;
  let configured: number;
  if (cached !== undefined) configured = cached.configuredRatePerSecond;
  else {
    const envCap = resolveEnvCapacity(channel, normalizedProvider(provider || 'default'), process.env);
    configured = envCap.configuredRate ?? defaultRate(channel);
  }
  const adaptiveCurrent = adaptiveRates.get(effectiveKey)?.rate;
  const effective = adaptiveCurrent ?? cached?.effectiveRatePerSecond ?? configured;
  const increased = Math.min(configured, effective + Math.max(1, Math.ceil(configured * 0.05)));
  if (increased >= configured) adaptiveRates.delete(effectiveKey);
  else setAdaptiveRate(effectiveKey, increased, nowMs);
  capacityCache.invalidate(effectiveKey);
  return increased;
}

export function getAdaptiveRatesMetrics(): { entries: number; evictionsTotal: number } {
  return { entries: adaptiveRates.size, evictionsTotal: adaptiveEvictionsTotal };
}

export function resetCapacityResolverForTests() {
  adaptiveRates.clear();
  adaptiveEvictionsTotal = 0;
  capacityCache.invalidate();
  runtimeCache.invalidate();
}
