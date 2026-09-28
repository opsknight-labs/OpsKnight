import { check, sleep } from 'k6';
import http from 'k6/http';
import {
  getActiveLoadLevel,
  getBaseUrl,
  getControlBaseUrl,
  loadSeedManifest,
  opsknightMetrics,
  pickApiKey,
  pickCapacityIntegrationKey,
  postEventApi,
  setEmulatorBehavior,
} from './_shared.js';

const manifest = loadSeedManifest();
const level = getActiveLoadLevel();
const durationProfile = (__ENV.LOAD_DURATION_PROFILE || 'mega25m').toLowerCase();
const isFastTest = durationProfile === 'cert' || durationProfile === 'fast';

// Stage durations: either 25 minutes (1500s) or fast test (150s / 15s)
const scaleFactor = isFastTest ? (durationProfile === 'cert' ? 0.01 : 0.1) : 1.0;

function formatStageDuration(sec) {
  const effectiveSec = Math.max(2, Math.round(sec * scaleFactor));
  return `${effectiveSec}s`;
}

export const options = {
  scenarios: {
    mega_alert_pipeline: {
      executor: 'ramping-arrival-rate',
      startRate: 50,
      timeUnit: '1s',
      preAllocatedVUs: Math.max(20, Math.floor(level.vus * 0.5)),
      maxVUs: Math.max(100, level.maxVUs),
      stages: [
        { target: 50, duration: formatStageDuration(120) }, // 0-2 min: Baseline
        { target: Math.round(level.targetRps * 0.4), duration: formatStageDuration(180) }, // 2-5 min: 40% Normal
        { target: Math.round(level.targetRps * 0.7), duration: formatStageDuration(180) }, // 5-8 min: 70% Heavy
        { target: Math.round(level.targetRps * 1.0), duration: formatStageDuration(180) }, // 8-11 min: 100% Incident Storm
        { target: Math.round(level.targetRps * 1.0), duration: formatStageDuration(180) }, // 11-14 min: Notification Storm
        { target: Math.round(level.targetRps * 0.8), duration: formatStageDuration(180) }, // 14-17 min: User Storm
        { target: Math.round(level.targetRps * 0.8), duration: formatStageDuration(180) }, // 17-20 min: Outage Accumulation
        { target: Math.round(level.targetRps * 0.5), duration: formatStageDuration(120) }, // 20-22 min: Failure Injection
        { target: Math.round(level.targetRps * 1.35), duration: formatStageDuration(120) }, // 22-24 min: 135% Extreme Burst
        { target: 0, duration: formatStageDuration(60) }, // 24-25 min: Drain & Recovery
      ],
      exec: 'runMegaAlertTraffic',
    },
    mega_interactive_users: {
      executor: 'ramping-vus',
      startVUs: 10,
      stages: [
        { target: 25, duration: formatStageDuration(120) }, // 0-2 min
        { target: 50, duration: formatStageDuration(180) }, // 2-5 min
        { target: 100, duration: formatStageDuration(180) }, // 5-8 min
        { target: 150, duration: formatStageDuration(180) }, // 8-11 min
        { target: 200, duration: formatStageDuration(180) }, // 11-14 min
        { target: Math.max(300, level.vus), duration: formatStageDuration(180) }, // 14-17 min: Peak User Storm
        { target: 100, duration: formatStageDuration(180) }, // 17-20 min
        { target: 50, duration: formatStageDuration(120) }, // 20-22 min
        { target: 100, duration: formatStageDuration(120) }, // 22-24 min
        { target: 5, duration: formatStageDuration(60) }, // 24-25 min
      ],
      exec: 'runMegaInteractiveUserTraffic',
    },
    mega_provider_chaos_timeline: {
      executor: 'per-vu-iterations',
      vus: 1,
      iterations: 1,
      exec: 'runMegaProviderChaosTimeline',
    },
  },
  thresholds: {
    opsknight_events_success_rate: ['rate>0.95'],
  },
};

export function runMegaAlertTraffic() {
  const baseUrl = getBaseUrl();
  const integrationKey = pickCapacityIntegrationKey(manifest, __VU, __ITER);
  const dedupKey = `lt-mega-event-${__VU}-${__ITER}-${Date.now()}`;
  const isCritical = (__ITER + __VU) % 3 === 0;

  const res = postEventApi(
    baseUrl,
    integrationKey,
    {
      event_action: 'trigger',
      dedup_key: dedupKey,
      payload: {
        summary: `[Mega Journey] ${isCritical ? 'CRITICAL' : 'WARNING'} Alert ${dedupKey}`,
        source: `k6-mega-producer-${__VU}`,
        severity: isCritical ? 'critical' : 'warning',
        custom_details: {
          journey: 'mega_certification_25m',
          timestamp: Date.now(),
        },
      },
    },
    { endpoint: 'events_api', scenario: 'mega_journey' }
  );

  check(res, {
    'mega event handled (202 or 429 under extreme burst)': r =>
      r.status === 202 || r.status === 429,
  });
}

export function runMegaInteractiveUserTraffic() {
  const baseUrl = getBaseUrl();
  const apiKey = pickApiKey(manifest, __VU, __ITER);
  const headers = { Authorization: `Bearer ${apiKey}` };

  const listRes = http.get(`${baseUrl}/api/incidents?limit=20`, {
    headers,
    tags: { endpoint: 'mega_user_list' },
  });
  opsknightMetrics.userWorkloadSuccessRate.add(listRes.status === 200 || listRes.status === 429);

  if (__ITER % 4 === 0) {
    const healthRes = http.get(`${baseUrl}/api/health`, {
      headers,
      tags: { endpoint: 'mega_health' },
    });
    check(healthRes, { 'system responds': r => r.status < 500 });
  }

  sleep(0.3);
}

export function runMegaProviderChaosTimeline() {
  const controlBaseUrl = getControlBaseUrl();

  // Minutes 0-17: Baseline through incident storm (providers normal fast)
  setEmulatorBehavior(controlBaseUrl, {
    provider: 'all',
    mode: '200_fast',
    latencyMs: 15,
    jitterMs: 10,
    errorRate: 0,
  });
  sleep(Math.max(2, Math.round(1020 * scaleFactor))); // 17 minutes

  // Minutes 17-20: Provider Outage Storm (emulator returns 429 / 503)
  setEmulatorBehavior(controlBaseUrl, {
    provider: 'all',
    mode: '503_outage',
    retryAfterSeconds: 3,
  });
  sleep(Math.max(2, Math.round(180 * scaleFactor))); // 3 minutes outage

  // Minutes 20-25: Provider Restored for Extreme Burst & Recovery Drain
  setEmulatorBehavior(controlBaseUrl, {
    provider: 'all',
    mode: '200_fast',
    latencyMs: 10,
    jitterMs: 5,
    errorRate: 0,
  });
  sleep(Math.max(2, Math.round(300 * scaleFactor))); // Remaining 5 minutes
}
