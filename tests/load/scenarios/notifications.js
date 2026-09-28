import { check, sleep } from 'k6';
import {
  getActiveLoadLevel,
  getBaseUrl,
  getControlBaseUrl,
  getDurationProfile,
  loadSeedManifest,
  pickCapacityIntegrationKey,
  postEventApi,
  setEmulatorBehavior,
} from './_shared.js';

const manifest = loadSeedManifest();
const level = getActiveLoadLevel();
const durations = getDurationProfile();
const providerFaultMode = (__ENV.PROVIDER_FAULT_MODE || 'progressive').toLowerCase();

export const options = {
  scenarios: {
    notification_generator: {
      executor: 'ramping-arrival-rate',
      startRate: Math.max(5, Math.floor(level.targetRps * 0.2)),
      timeUnit: '1s',
      preAllocatedVUs: Math.max(12, Math.floor(level.vus * 0.5)),
      maxVUs: level.maxVUs,
      stages: [
        { target: Math.max(10, Math.floor(level.targetRps * 0.4)), duration: durations.warmup },
        { target: Math.max(20, Math.floor(level.targetRps * 0.6)), duration: durations.steady },
        { target: 5, duration: durations.cooldown },
      ],
      exec: 'runNotificationTraffic',
    },
    provider_fault_controller: {
      executor: 'per-vu-iterations',
      vus: 1,
      iterations: 1,
      exec: 'runProviderFaultSchedule',
    },
  },
  thresholds: {
    opsknight_events_success_rate: ['rate>0.98'],
  },
};

export function runNotificationTraffic() {
  const baseUrl = getBaseUrl();
  const integrationKey = pickCapacityIntegrationKey(manifest, __VU, __ITER);
  const dedupKey = `lt-notif-burst-${__VU}-${__ITER}-${Date.now()}`;

  // Critical incidents trigger multi-channel notifications via outbox -> notification worker
  // Because outbox is decoupled, /api/events must remain fast even when providers return 429/503
  const res = postEventApi(
    baseUrl,
    integrationKey,
    {
      event_action: 'trigger',
      dedup_key: dedupKey,
      payload: {
        summary: `[Notification Pipeline] Multi-channel critical dispatch ${dedupKey}`,
        source: `k6-notif-driver-${__VU}`,
        severity: 'critical',
        custom_details: {
          channels: ['EMAIL', 'SMS', 'PUSH', 'SLACK', 'WEBHOOK'],
          dedupKey,
        },
      },
    },
    { endpoint: 'events_api', scenario: 'notifications' }
  );

  check(res, {
    'event ingestion decoupled from provider latency (202 or 429)': r =>
      r.status === 202 || r.status === 429,
  });
}

export function runProviderFaultSchedule() {
  const controlBaseUrl = getControlBaseUrl();
  const isCert = (__ENV.LOAD_DURATION_PROFILE || 'fast').toLowerCase() === 'cert';
  const stepSec = isCert ? 2 : 10;

  if (providerFaultMode === 'none' || providerFaultMode === '200_fast') {
    setEmulatorBehavior(controlBaseUrl, {
      provider: 'all',
      mode: '200_fast',
      latencyMs: 15,
      jitterMs: 10,
      errorRate: 0,
    });
    return;
  }

  // Phase 1: Healthy fast providers (200 OK, 15ms)
  setEmulatorBehavior(controlBaseUrl, {
    provider: 'all',
    mode: '200_fast',
    latencyMs: 15,
    jitterMs: 10,
    errorRate: 0,
  });
  sleep(stepSec);

  // Phase 2: Slow downstream providers (500ms-1.5s latency)
  setEmulatorBehavior(controlBaseUrl, {
    provider: 'slack',
    mode: '200_slow',
    latencyMs: 650,
    jitterMs: 250,
  });
  setEmulatorBehavior(controlBaseUrl, {
    provider: 'webhook',
    mode: '200_slow',
    latencyMs: 800,
    jitterMs: 300,
  });
  sleep(stepSec);

  // Phase 3: Rate-limiting (HTTP 429 with Retry-After: 2s on 30% of requests)
  setEmulatorBehavior(controlBaseUrl, {
    provider: 'sms',
    mode: 'mixed',
    errorRate: 0.3,
    retryAfterSeconds: 2,
    latencyMs: 40,
  });
  setEmulatorBehavior(controlBaseUrl, {
    provider: 'push',
    mode: 'mixed',
    errorRate: 0.25,
    retryAfterSeconds: 2,
    latencyMs: 30,
  });
  sleep(stepSec);

  // Phase 4: Brief 503 outage on webhook & slack, then full recovery to 200_fast
  setEmulatorBehavior(controlBaseUrl, {
    provider: 'webhook',
    mode: '503_outage',
    retryAfterSeconds: 3,
  });
  sleep(Math.max(1, Math.floor(stepSec * 0.8)));

  // Phase 5: Restore all providers to 200_fast so retry queue drains cleanly
  setEmulatorBehavior(controlBaseUrl, {
    provider: 'all',
    mode: '200_fast',
    latencyMs: 10,
    jitterMs: 5,
    errorRate: 0,
  });
}
