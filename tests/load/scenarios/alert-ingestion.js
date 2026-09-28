import { check, sleep } from 'k6';
import {
  getActiveLoadLevel,
  getBaseUrl,
  getDurationProfile,
  loadSeedManifest,
  pickCapacityIntegrationKey,
  postEventApi,
} from './_shared.js';

const manifest = loadSeedManifest();
const level = getActiveLoadLevel();
const durations = getDurationProfile();
const mode = (__ENV.ALERT_INGESTION_MODE || 'mixed').toLowerCase();

export const options = {
  scenarios: {
    contract_bucket_guard: {
      executor: 'constant-arrival-rate',
      rate: mode === 'capacity' ? 2 : 5,
      timeUnit: '1s',
      duration: durations.steady,
      preAllocatedVUs: 8,
      maxVUs: 20,
      exec: 'runContractRateLimitScenario',
    },
    capacity_ingestion: {
      executor: 'ramping-arrival-rate',
      startRate: Math.max(5, Math.floor(level.targetRps * 0.25)),
      timeUnit: '1s',
      preAllocatedVUs: level.vus,
      maxVUs: level.maxVUs,
      stages: [
        { target: Math.max(10, Math.floor(level.targetRps * 0.5)), duration: durations.warmup },
        { target: level.targetRps, duration: durations.steady },
        { target: Math.max(5, Math.floor(level.targetRps * 0.2)), duration: durations.cooldown },
      ],
      exec: 'runCapacityIngestionScenario',
    },
  },
  thresholds: {
    opsknight_events_success_rate: ['rate>0.98'],
  },
};

const SEVERITIES = ['critical', 'error', 'warning', 'info'];

export function runContractRateLimitScenario() {
  const baseUrl = getBaseUrl();
  const dedupKey = `lt-contract-dedup-${__VU}-${__ITER}`;
  const payload = {
    event_action: 'trigger',
    dedup_key: dedupKey,
    payload: {
      summary: `[Contract Bucket] Alert ${dedupKey}`,
      source: 'k6-contract-probe',
      severity: 'warning',
      custom_details: {
        mode: 'contract',
        vu: __VU,
        iter: __ITER,
      },
    },
  };

  const res = postEventApi(baseUrl, manifest.contractIntegrationKey, payload, {
    endpoint: 'events_api',
    mode: 'contract',
  });

  check(res, {
    'contract status is 202 or 429': r => r.status === 202 || r.status === 429,
    'contract 429 includes Retry-After header': r =>
      r.status !== 429 || Boolean(r.headers['Retry-After'] || r.headers['retry-after']),
  });
}

export function runCapacityIngestionScenario() {
  const baseUrl = getBaseUrl();
  const integrationKey = pickCapacityIntegrationKey(manifest, __VU, __ITER);
  const subMode =
    mode !== 'mixed'
      ? mode
      : __ITER % 10 < 5
        ? 'unique'
        : __ITER % 10 < 8
          ? 'dedup_storm'
          : 'flapping';

  const severity = SEVERITIES[(__VU + __ITER) % SEVERITIES.length];
  let dedupKey;
  let eventAction = 'trigger';

  if (subMode === 'dedup_storm' || level.name === 'L4_dedup_storm') {
    // Concentrate concurrent triggers onto 20 hot dedup keys to stress advisory locks
    const hotSlot = (__VU + __ITER) % 20;
    dedupKey = `lt-hot-dedup-key-${String(hotSlot).padStart(3, '0')}`;
  } else if (subMode === 'flapping') {
    const flapSlot = __VU % 30;
    dedupKey = `lt-flap-dedup-key-${String(flapSlot).padStart(3, '0')}`;
    const phase = __ITER % 3;
    eventAction = phase === 0 ? 'trigger' : phase === 1 ? 'acknowledge' : 'resolve';
  } else {
    dedupKey = `lt-cap-unique-${__VU}-${__ITER}-${Date.now()}`;
  }

  const payload = {
    event_action: eventAction,
    dedup_key: dedupKey,
    payload: {
      summary: `[Capacity ${subMode}] ${severity.toUpperCase()} signal on ${dedupKey}`,
      source: `k6-capacity-node-${__VU % 16}`,
      severity,
      custom_details: {
        subMode,
        vu: __VU,
        iter: __ITER,
        timestamp: new Date().toISOString(),
      },
    },
  };

  const res = postEventApi(baseUrl, integrationKey, payload, {
    endpoint: 'events_api',
    mode: 'capacity',
    subMode,
  });

  check(res, {
    'capacity event accepted (202 or 429 under storm)': r => r.status === 202 || r.status === 429,
  });

  if (subMode === 'flapping') {
    sleep(0.05);
  }
}
