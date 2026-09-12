import type { NotificationTrafficClass } from '@prisma/client';
import type { ProviderAdmissionScope } from './provider-admission';

const ABSOLUTE_RATE_CEILING = 10_000;
const ABSOLUTE_IN_FLIGHT_CEILING = 5_000;
const ADAPTIVE_RECOVERY_INTERVAL_MS = 5_000;

function defaultRate(scope: ProviderAdmissionScope): number {
  switch (scope) {
    case 'EMAIL':
      return 8;
    case 'SMS':
      return 20;
    case 'WHATSAPP':
      return 50;
    case 'PUSH':
      return 100;
    case 'SLACK':
      return 1;
    case 'WEBHOOK':
      return 20;
    case 'MICROSOFT_TEAMS':
      return 2;
  }
}

function defaultInFlight(scope: ProviderAdmissionScope): number {
  switch (scope) {
    case 'EMAIL':
      return 5;
    case 'SMS':
      return 10;
    case 'WHATSAPP':
      return 10;
    case 'PUSH':
      return 20;
    case 'SLACK':
      return 2;
    case 'WEBHOOK':
      return 10;
    case 'MICROSOFT_TEAMS':
      return 2;
  }
}

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
  if (!raw) return 0.8;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0.05 && parsed <= 1 ? parsed : 0.8;
}

function envValue(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = Reflect.get(env, key);
  return typeof value === 'string' ? value : undefined;
}

type AdaptiveRateState = { rate: number; changedAt: number };
const adaptiveRates = new Map<string, AdaptiveRateState>();

function capacityKey(scope: ProviderAdmissionScope, providerKey: string) {
  return `${scope}:${providerKey}`;
}

function recoverAdaptiveRate(
  key: string,
  hardRate: number,
  configuredRate: number,
  nowMs: number
): number {
  const state = adaptiveRates.get(key);
  if (!state) return hardRate;
  const elapsed = Math.max(0, nowMs - state.changedAt);
  const steps = Math.floor(elapsed / ADAPTIVE_RECOVERY_INTERVAL_MS);
  if (steps <= 0) return Math.min(hardRate, state.rate);

  const increment = Math.max(1, Math.ceil(configuredRate * 0.05));
  const recovered = Math.min(hardRate, state.rate + steps * increment);
  if (recovered >= hardRate) {
    adaptiveRates.delete(key);
    return hardRate;
  }
  adaptiveRates.set(key, {
    rate: recovered,
    changedAt: state.changedAt + steps * ADAPTIVE_RECOVERY_INTERVAL_MS,
  });
  return recovered;
}

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
    defaultRate(scope),
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
  const key = capacityKey(scope, providerKey);
  const adaptiveRate = adaptiveBackpressure
    ? recoverAdaptiveRate(key, hardRate, configuredRatePerSecond, Date.now())
    : hardRate;
  const effectiveRatePerSecond = Math.max(1, Math.min(hardRate, adaptiveRate));
  const bulkShare = shareSetting(env.NOTIFICATION_BULK_SHARE);
  const bulkRatePerSecond = Math.max(1, Math.floor(effectiveRatePerSecond * bulkShare));
  const maxInFlight = integerSetting(
    scoped('MAX_IN_FLIGHT'),
    defaultInFlight(scope),
    1,
    ABSOLUTE_IN_FLIGHT_CEILING
  );
  // Keep at least one distributed provider slot reserved for critical/transactional
  // work whenever the provider supports more than one concurrent request.
  const bulkMaxInFlight =
    maxInFlight <= 1
      ? 1
      : Math.max(1, Math.min(maxInFlight - 1, Math.floor(maxInFlight * bulkShare)));

  return {
    configuredRatePerSecond,
    effectiveRatePerSecond,
    bulkRatePerSecond,
    maxInFlight,
    bulkMaxInFlight,
    adaptiveBackpressure,
    quotaBlockSize: integerSetting(env.NOTIFICATION_QUOTA_BLOCK_SIZE, 100, 1, 1_000),
  };
}

export function recordCapacityPressure(scope: ProviderAdmissionScope, providerKey: string): number {
  const capacity = getProviderCapacity(scope, providerKey);
  const reduced = Math.max(1, Math.floor(capacity.effectiveRatePerSecond / 2));
  adaptiveRates.set(capacityKey(scope, providerKey), { rate: reduced, changedAt: Date.now() });
  return reduced;
}

export function recordHealthyCapacity(scope: ProviderAdmissionScope, providerKey: string): number {
  const capacity = getProviderCapacity(scope, providerKey);
  const increased = Math.min(
    capacity.configuredRatePerSecond,
    capacity.effectiveRatePerSecond +
      Math.max(1, Math.ceil(capacity.configuredRatePerSecond * 0.05))
  );
  if (increased >= capacity.configuredRatePerSecond) {
    adaptiveRates.delete(capacityKey(scope, providerKey));
  } else {
    adaptiveRates.set(capacityKey(scope, providerKey), { rate: increased, changedAt: Date.now() });
  }
  return increased;
}

export function usesBulkCapacity(trafficClass: NotificationTrafficClass | undefined): boolean {
  return trafficClass === 'PUBLIC_INCIDENT' || trafficClass === 'BULK';
}

export function resetProviderCapacityForTests(): void {
  adaptiveRates.clear();
}
