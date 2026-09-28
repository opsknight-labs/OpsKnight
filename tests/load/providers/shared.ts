export type ProviderName = 'email' | 'slack' | 'sms' | 'push' | 'teams' | 'webhook';

export type ProviderMode =
  | 'normal'
  | 'rate_limit'
  | 'transient_failure'
  | 'permanent_failure'
  | 'slow'
  | 'timeout'
  | 'outage';

export interface ProviderBehaviorConfig {
  mode: ProviderMode;
  latencyMs: number;
  failureRate: number;
  rateLimitPerSec: number;
  retryAfterSec: number;
  statusCodeOverride?: number;
  outageUntilEpochMs?: number;
}

export interface DeliveryRecord {
  deliveryKey: string;
  channel: ProviderName;
  recipient?: string;
  trafficClass?: string;
  attempts: number;
  succeededCount: number;
  firstAttemptAt: number;
  lastAttemptAt: number;
  firstSuccessAt?: number;
}

export interface ProviderTelemetrySnapshot {
  provider: ProviderName;
  behavior: ProviderBehaviorConfig;
  effectiveMode: ProviderMode;
  totalRequests: number;
  accepted2xx: number;
  rateLimited429: number;
  clientErrors4xx: number;
  serverErrors5xx: number;
  timeouts: number;
  inFlight: number;
  maxInFlight: number;
  uniqueDeliveriesSucceeded: number;
  duplicateDeliveries: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
}

export const ALL_PROVIDERS: readonly ProviderName[] = [
  'email',
  'slack',
  'sms',
  'push',
  'teams',
  'webhook',
] as const;

interface InternalProviderState {
  behavior: ProviderBehaviorConfig;
  totalRequests: number;
  accepted2xx: number;
  rateLimited429: number;
  clientErrors4xx: number;
  serverErrors5xx: number;
  timeouts: number;
  inFlight: number;
  maxInFlight: number;
  windowEpochSec: number;
  windowCount: number;
  deliveries: Map<string, DeliveryRecord>;
  duplicateDeliveries: number;
  latenciesMs: number[];
}

function defaultBehavior(): ProviderBehaviorConfig {
  return {
    mode: 'normal',
    latencyMs: 20,
    failureRate: 0,
    rateLimitPerSec: 0, // 0 = unlimited unless set
    retryAfterSec: 5,
  };
}

const providerRegistry = new Map<ProviderName, InternalProviderState>();

function getState(provider: ProviderName): InternalProviderState {
  let state = providerRegistry.get(provider);
  if (!state) {
    state = {
      behavior: defaultBehavior(),
      totalRequests: 0,
      accepted2xx: 0,
      rateLimited429: 0,
      clientErrors4xx: 0,
      serverErrors5xx: 0,
      timeouts: 0,
      inFlight: 0,
      maxInFlight: 0,
      windowEpochSec: Math.floor(Date.now() / 1000),
      windowCount: 0,
      deliveries: new Map(),
      duplicateDeliveries: 0,
      latenciesMs: [],
    };
    providerRegistry.set(provider, state);
  }
  return state;
}

export function setProviderBehavior(
  provider: ProviderName | 'all',
  patch: Partial<ProviderBehaviorConfig>
): void {
  const targets = provider === 'all' ? ALL_PROVIDERS : [provider];
  for (const name of targets) {
    const state = getState(name);
    state.behavior = {
      ...state.behavior,
      ...patch,
    };
  }
}

export function scheduleProviderOutage(
  provider: ProviderName | 'all',
  durationSeconds: number,
  mode: 'outage' | 'rate_limit' | 'timeout' = 'outage'
): void {
  const until = Date.now() + Math.max(1, durationSeconds) * 1000;
  setProviderBehavior(provider, {
    mode,
    outageUntilEpochMs: until,
  });
}

export function resetProviderTelemetry(provider: ProviderName | 'all' = 'all'): void {
  const targets = provider === 'all' ? ALL_PROVIDERS : [provider];
  for (const name of targets) {
    providerRegistry.set(name, {
      behavior: defaultBehavior(),
      totalRequests: 0,
      accepted2xx: 0,
      rateLimited429: 0,
      clientErrors4xx: 0,
      serverErrors5xx: 0,
      timeouts: 0,
      inFlight: 0,
      maxInFlight: 0,
      windowEpochSec: Math.floor(Date.now() / 1000),
      windowCount: 0,
      deliveries: new Map(),
      duplicateDeliveries: 0,
      latenciesMs: [],
    });
  }
}

export interface EvaluatedProviderDecision {
  allow: boolean;
  statusCode: number;
  delayMs: number;
  retryAfterSec?: number;
  errorCode?: string;
  errorMessage?: string;
  hangTimeout?: boolean;
}

export async function executeProviderEmulatorStep(
  provider: ProviderName,
  meta: {
    deliveryKey: string;
    recipient?: string;
    trafficClass?: string;
    successStatusCode?: number;
  }
): Promise<EvaluatedProviderDecision> {
  const state = getState(provider);
  const now = Date.now();
  const currentSec = Math.floor(now / 1000);

  if (state.windowEpochSec !== currentSec) {
    state.windowEpochSec = currentSec;
    state.windowCount = 0;
  }
  state.windowCount += 1;
  state.totalRequests += 1;
  state.inFlight += 1;
  if (state.inFlight > state.maxInFlight) {
    state.maxInFlight = state.inFlight;
  }

  // Automatic recovery from scheduled outage window
  if (state.behavior.outageUntilEpochMs && now >= state.behavior.outageUntilEpochMs) {
    state.behavior.mode = 'normal';
    state.behavior.outageUntilEpochMs = undefined;
  }

  const effectiveMode = state.behavior.mode;
  let decision: EvaluatedProviderDecision;

  if (
    effectiveMode === 'rate_limit' ||
    (state.behavior.rateLimitPerSec > 0 && state.windowCount > state.behavior.rateLimitPerSec)
  ) {
    decision = {
      allow: false,
      statusCode: 429,
      delayMs: state.behavior.latencyMs,
      retryAfterSec: state.behavior.retryAfterSec || 5,
      errorCode: 'rate_limited',
      errorMessage: 'Too Many Requests: Provider rate limit exceeded',
    };
  } else if (effectiveMode === 'timeout') {
    decision = {
      allow: false,
      statusCode: 504,
      delayMs: Math.max(state.behavior.latencyMs, 12_000),
      errorCode: 'provider_timeout',
      errorMessage: 'Upstream provider socket timed out',
      hangTimeout: true,
    };
  } else if (effectiveMode === 'outage') {
    decision = {
      allow: false,
      statusCode: state.behavior.statusCodeOverride || 503,
      delayMs: state.behavior.latencyMs,
      errorCode: 'service_unavailable',
      errorMessage: 'Provider undergoing scheduled outage',
    };
  } else if (
    effectiveMode === 'transient_failure' &&
    (state.behavior.failureRate >= 1 || Math.random() < (state.behavior.failureRate || 0.5))
  ) {
    decision = {
      allow: false,
      statusCode: state.behavior.statusCodeOverride || 502,
      delayMs: state.behavior.latencyMs,
      errorCode: 'bad_gateway',
      errorMessage: 'Transient upstream provider 502/503 error',
    };
  } else if (
    effectiveMode === 'permanent_failure' &&
    (state.behavior.failureRate >= 1 || Math.random() < (state.behavior.failureRate || 1))
  ) {
    decision = {
      allow: false,
      statusCode: state.behavior.statusCodeOverride || 400,
      delayMs: state.behavior.latencyMs,
      errorCode: 'invalid_request',
      errorMessage: 'Permanent client error (invalid credentials or recipient)',
    };
  } else {
    const delayMs =
      effectiveMode === 'slow'
        ? Math.max(state.behavior.latencyMs, 1500)
        : state.behavior.latencyMs;
    decision = {
      allow: true,
      statusCode: meta.successStatusCode ?? 200,
      delayMs,
    };
  }

  const startedAt = Date.now();
  try {
    if (decision.delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, decision.delayMs));
    }

    const existing = state.deliveries.get(meta.deliveryKey);
    const record: DeliveryRecord = existing ?? {
      deliveryKey: meta.deliveryKey,
      channel: provider,
      recipient: meta.recipient,
      trafficClass: meta.trafficClass,
      attempts: 0,
      succeededCount: 0,
      firstAttemptAt: now,
      lastAttemptAt: now,
    };
    record.attempts += 1;
    record.lastAttemptAt = Date.now();

    if (decision.allow) {
      state.accepted2xx += 1;
      record.succeededCount += 1;
      if (record.succeededCount === 1) {
        record.firstSuccessAt = Date.now();
      } else {
        state.duplicateDeliveries += 1;
      }
    } else if (decision.statusCode === 429) {
      state.rateLimited429 += 1;
    } else if (decision.hangTimeout || decision.statusCode === 504) {
      state.timeouts += 1;
    } else if (decision.statusCode >= 500) {
      state.serverErrors5xx += 1;
    } else if (decision.statusCode >= 400) {
      state.clientErrors4xx += 1;
    }

    state.deliveries.set(meta.deliveryKey, record);
    return decision;
  } finally {
    state.inFlight = Math.max(0, state.inFlight - 1);
    const elapsed = Date.now() - startedAt;
    state.latenciesMs.push(elapsed);
    if (state.latenciesMs.length > 5_000) {
      state.latenciesMs.splice(0, state.latenciesMs.length - 5_000);
    }
  }
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[idx] ?? 0;
}

export function getProviderTelemetry(provider: ProviderName): ProviderTelemetrySnapshot {
  const state = getState(provider);
  const now = Date.now();
  const effectiveMode =
    state.behavior.outageUntilEpochMs && now >= state.behavior.outageUntilEpochMs
      ? 'normal'
      : state.behavior.mode;

  let uniqueSucceeded = 0;
  for (const rec of state.deliveries.values()) {
    if (rec.succeededCount > 0) uniqueSucceeded += 1;
  }

  return {
    provider,
    behavior: { ...state.behavior },
    effectiveMode,
    totalRequests: state.totalRequests,
    accepted2xx: state.accepted2xx,
    rateLimited429: state.rateLimited429,
    clientErrors4xx: state.clientErrors4xx,
    serverErrors5xx: state.serverErrors5xx,
    timeouts: state.timeouts,
    inFlight: state.inFlight,
    maxInFlight: state.maxInFlight,
    uniqueDeliveriesSucceeded: uniqueSucceeded,
    duplicateDeliveries: state.duplicateDeliveries,
    p50LatencyMs: percentile(state.latenciesMs, 0.5),
    p95LatencyMs: percentile(state.latenciesMs, 0.95),
    p99LatencyMs: percentile(state.latenciesMs, 0.99),
  };
}

export function getAllProvidersTelemetry(): Record<ProviderName, ProviderTelemetrySnapshot> {
  return {
    email: getProviderTelemetry('email'),
    slack: getProviderTelemetry('slack'),
    sms: getProviderTelemetry('sms'),
    push: getProviderTelemetry('push'),
    teams: getProviderTelemetry('teams'),
    webhook: getProviderTelemetry('webhook'),
  };
}
