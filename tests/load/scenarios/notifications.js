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
    critical_notification_stream: {
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
      exec: 'runCriticalNotificationTraffic',
    },
    bulk_notification_backlog_storm: {
      executor: 'constant-arrival-rate',
      rate: Math.max(15, Math.floor(level.targetRps * 0.5)),
      timeUnit: '1s',
      duration: durations.steady,
      preAllocatedVUs: 15,
      maxVUs: 40,
      exec: 'runBulkNotificationTraffic',
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

export function runCriticalNotificationTraffic() {
  const baseUrl = getBaseUrl();
  const integrationKey = pickCapacityIntegrationKey(manifest, __VU, __ITER);
  const dedupKey = `lt-notif-crit-${__VU}-${__ITER}-${Date.now()}`;

  // Critical incidents trigger multi-channel notifications (EMAIL, SMS, PUSH, SLACK, WEBHOOK)
  const res = postEventApi(
    baseUrl,
    integrationKey,
    {
      event_action: 'trigger',
      dedup_key: dedupKey,
      payload: {
        summary: `[CRITICAL Pipeline] Urgent paging dispatch ${dedupKey}`,
        source: `k6-critical-notif-${__VU}`,
        severity: 'critical',
        custom_details: {
          trafficClass: 'CRITICAL',
          channels: ['EMAIL', 'SMS', 'PUSH', 'SLACK', 'WEBHOOK'],
          dedupKey,
          queuedAt: Date.now(),
        },
      },
    },
    { endpoint: 'events_api', scenario: 'notifications_critical' }
  );

  check(res, {
    'critical notification ingested (202 or 429)': r => r.status === 202 || r.status === 429,
  });
}

export function runBulkNotificationTraffic() {
  const baseUrl = getBaseUrl();
  const integrationKey = pickCapacityIntegrationKey(manifest, __VU + 150, __ITER);
  const dedupKey = `lt-notif-bulk-${__VU}-${__ITER}-${Date.now()}`;

  // Low-urgency / informational traffic categorized as BULK notifications
  const res = postEventApi(
    baseUrl,
    integrationKey,
    {
      event_action: 'trigger',
      dedup_key: dedupKey,
      payload: {
        summary: `[BULK Notification Backlog] Background digest message ${dedupKey}`,
        source: `k6-bulk-notif-${__VU}`,
        severity: 'info',
        custom_details: {
          trafficClass: 'BULK',
          channels: ['EMAIL', 'WEBHOOK'],
          dedupKey,
          queuedAt: Date.now(),
        },
      },
    },
    { endpoint: 'events_api', scenario: 'notifications_bulk' }
  );

  check(res, {
    'bulk notification ingested': r => r.status === 202 || r.status === 429,
  });
}

export function runProviderFaultSchedule() {
  const controlBaseUrl = getControlBaseUrl();
  const isCert = (__ENV.LOAD_DURATION_PROFILE || 'fast').toLowerCase() === 'cert';
  const is25m = (__ENV.LOAD_DURATION_PROFILE || 'fast').toLowerCase() === 'mega25m';
  const stepSec = isCert ? 2 : is25m ? 60 : 10;

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

  // Phase 1: Healthy baseline (200 OK, 15ms)
  setEmulatorBehavior(controlBaseUrl, {
    provider: 'all',
    mode: '200_fast',
    latencyMs: 15,
    jitterMs: 10,
    errorRate: 0,
  });
  sleep(stepSec);

  // Phase 2: High latency degradation (500ms - 2s latency)
  setEmulatorBehavior(controlBaseUrl, {
    provider: 'slack',
    mode: '200_slow',
    latencyMs: 800,
    jitterMs: 250,
  });
  setEmulatorBehavior(controlBaseUrl, {
    provider: 'webhook',
    mode: '200_slow',
    latencyMs: 1500,
    jitterMs: 400,
  });
  sleep(stepSec);

  // Phase 3: Downstream rate limiting (HTTP 429 with Retry-After)
  setEmulatorBehavior(controlBaseUrl, {
    provider: 'sms',
    mode: 'mixed',
    errorRate: 0.35,
    retryAfterSeconds: 2,
    latencyMs: 40,
  });
  setEmulatorBehavior(controlBaseUrl, {
    provider: 'push',
    mode: 'mixed',
    errorRate: 0.3,
    retryAfterSeconds: 2,
    latencyMs: 30,
  });
  sleep(stepSec);

  // Phase 4: Downstream 503 and complete outage simulation
  setEmulatorBehavior(controlBaseUrl, {
    provider: 'all',
    mode: '503_outage',
    retryAfterSeconds: 3,
  });
  // Simulate complete provider outage (scaled to duration profile)
  sleep(Math.max(2, Math.floor(stepSec * 1.5)));

  // Phase 5: Provider restoration and queue drain
  setEmulatorBehavior(controlBaseUrl, {
    provider: 'all',
    mode: '200_fast',
    latencyMs: 10,
    jitterMs: 5,
    errorRate: 0,
  });
}
