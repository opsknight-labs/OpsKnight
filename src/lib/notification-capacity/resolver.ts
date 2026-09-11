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
import { HARD_LIMITS } from './hard-limits';
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
  adaptiveRates.set(key, { rate: recovered, changedAt: state.changedAt + steps * ADAPTIVE_RECOVERY_INTERVAL_MS });
  return recovered;
}

async function resolveRuntimeSettingsCached(nowMs: number) {
  const cached = runtimeCache.get('runtime', nowMs);
  if (cached) return cached as Awaited<ReturnType<typeof prisma.notificationRuntimeSettings.findUnique>>;
  const record = await prisma.notificationRuntimeSettings.findUnique({ where: { id: 'default' } });
  runtimeCache.set('runtime', record, nowMs, CACHE_TTLS.runtimeTtlMs);
  return record;
}

function resolveEnvCapacity(
  channel: NotificationChannel,
  provider: string,
  env: NodeJS.ProcessEnv
): { configuredRate?: number; configuredInFlight?: number; bulkShare?: number; adaptive?: boolean; ceiling?: number; hasAny: boolean } {
  const providerEnvKey = provider.toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 80);
  const scoped = (suffix: string) =>
    envValue(env, `NOTIFICATION_${channel}_${providerEnvKey}_${suffix}`) ?? envValue(env, `NOTIFICATION_${channel}_${suffix}`);
  const rateRaw = scoped('RATE_PER_SECOND');
  const inFlightRaw = scoped('MAX_IN_FLIGHT');
  const hasAny = Boolean(rateRaw || inFlightRaw || env.NOTIFICATION_BULK_SHARE || env.NOTIFICATION_ADAPTIVE_BACKPRESSURE || env.NOTIFICATION_DEPLOYMENT_RATE_CEILING || env.NOTIFICATION_QUOTA_BLOCK_SIZE);
  let configuredRate: number | undefined;
  if (rateRaw && Number.isSafeInteger(Number(rateRaw)) && Number(rateRaw) >= HARD_LIMITS.ratePerSecond.min && Number(rateRaw) <= HARD_LIMITS.ratePerSecond.max) {
    configuredRate = Number(rateRaw);
  }
  let configuredInFlight: number | undefined;
  if (inFlightRaw && Number.isSafeInteger(Number(inFlightRaw)) && Number(inFlightRaw) >= HARD_LIMITS.maxInFlight.min && Number(inFlightRaw) <= HARD_LIMITS.maxInFlight.max) {
    configuredInFlight = Number(inFlightRaw);
  }
  return {
    configuredRate,
    configuredInFlight,
    bulkShare: shareFromEnv(env.NOTIFICATION_BULK_SHARE),
    adaptive: env.NOTIFICATION_ADAPTIVE_BACKPRESSURE !== 'false',
    ceiling: integerSetting(env.NOTIFICATION_DEPLOYMENT_RATE_CEILING, HARD_LIMITS.ratePerSecond.max, 1, HARD_LIMITS.ratePerSecond.max),
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
  const cached = capacityCache.get(cacheKey, nowMs) as EffectiveCapacityConfig | null;
  if (cached) {
    // Cheap refresh for adaptive recovery without re-querying Postgres every call.
    if (cached.adaptiveBackpressure) {
      const key = capacityKey(channel, provider);
      const effective = recoverAdaptiveRate(key, Math.min(cached.configuredRatePerSecond, integerSetting(env.NOTIFICATION_DEPLOYMENT_RATE_CEILING, HARD_LIMITS.ratePerSecond.max, 1, HARD_LIMITS.ratePerSecond.max)), cached.configuredRatePerSecond, nowMs);
      const bulkRate = Math.max(1, Math.floor(effective * cached.bulkShare));
      return { ...cached, effectiveRatePerSecond: Math.max(1, Math.min(cached.configuredRatePerSecond, effective)), bulkRatePerSecond: bulkRate } as EffectiveCapacityConfig;
    }
    return cached;
  }

  const [runtime, stored] = await Promise.all([
    resolveRuntimeSettingsCached(nowMs),
    prisma.notificationProviderCapacity.findUnique({ where: { provider_channel: { provider, channel } } }),
  ]);

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
  source: CapacitySource;
  revision: number | null;
}> {
  const env = input?.env ?? process.env;
  const nowMs = input?.nowMs ?? Date.now();
  const runtime = (await resolveRuntimeSettingsCached(nowMs)) as Awaited<ReturnType<typeof prisma.notificationRuntimeSettings.findUnique>> | null;
  if (runtime) {
    return {
      low: runtime.bulkQueueLowWatermark,
      high: Math.max(runtime.bulkQueueLowWatermark, runtime.bulkQueueHighWatermark),
      source: 'DATABASE',
      revision: runtime.revision,
    };
  }
  const envLowRaw = env.NOTIFICATION_BULK_QUEUE_LOW_WATERMARK;
  const envHighRaw = env.NOTIFICATION_BULK_QUEUE_HIGH_WATERMARK;
  const hasEnv = Boolean(envLowRaw || envHighRaw);
  if (hasEnv) {
    const bounded = (value: string | undefined, fallback: number) => {
      const parsed = Number(value);
      return Number.isSafeInteger(parsed) && parsed >= 100 && parsed <= 1_000_000 ? parsed : fallback;
    };
    const low = bounded(envLowRaw, DEFAULT_BULK_QUEUE_LOW_WATERMARK);
    const high = bounded(envHighRaw, DEFAULT_BULK_QUEUE_HIGH_WATERMARK);
    return { low, high: Math.max(low, high), source: 'ENV', revision: null };
  }
  return {
    low: DEFAULT_BULK_QUEUE_LOW_WATERMARK,
    high: Math.max(DEFAULT_BULK_QUEUE_LOW_WATERMARK, DEFAULT_BULK_QUEUE_HIGH_WATERMARK),
    source: 'DEFAULT',
    revision: null,
  };
}

export function recordCapacityPressure(channel: NotificationChannel, provider: string, nowMs = Date.now()): number {
  const effectiveKey = `${channel}:${normalizedProvider(provider || 'default')}`;
  const cached = capacityCache.get(effectiveKey, nowMs) as EffectiveCapacityConfig | null;
  let configured: number;
  if (cached) configured = cached.configuredRatePerSecond;
  else {
    const envCap = resolveEnvCapacity(channel, normalizedProvider(provider || 'default'), process.env);
    configured = envCap.configuredRate ?? defaultRate(channel);
  }
  const adaptiveCurrent = adaptiveRates.get(effectiveKey)?.rate;
  const current = adaptiveCurrent ?? cached?.effectiveRatePerSecond ?? configured;
  const reduced = Math.max(1, Math.floor(current / 2));
  adaptiveRates.set(effectiveKey, { rate: reduced, changedAt: nowMs });
  // Invalidate so the next admission recomputes effective.
  capacityCache.invalidate(effectiveKey);
  return reduced;
}

export function recordHealthyCapacity(channel: NotificationChannel, provider: string, nowMs = Date.now()): number {
  const effectiveKey = `${channel}:${normalizedProvider(provider || 'default')}`;
  const cached = capacityCache.get(effectiveKey, nowMs) as EffectiveCapacityConfig | null;
  let configured: number;
  if (cached) configured = cached.configuredRatePerSecond;
  else {
    const envCap = resolveEnvCapacity(channel, normalizedProvider(provider || 'default'), process.env);
    configured = envCap.configuredRate ?? defaultRate(channel);
  }
  const adaptiveCurrent = adaptiveRates.get(effectiveKey)?.rate;
  const effective = adaptiveCurrent ?? cached?.effectiveRatePerSecond ?? configured;
  const increased = Math.min(configured, effective + Math.max(1, Math.ceil(configured * 0.05)));
  if (increased >= configured) adaptiveRates.delete(effectiveKey);
  else adaptiveRates.set(effectiveKey, { rate: increased, changedAt: nowMs });
  capacityCache.invalidate(effectiveKey);
  return increased;
}

export function resetCapacityResolverForTests() {
  adaptiveRates.clear();
  capacityCache.invalidate();
  runtimeCache.invalidate();
}
