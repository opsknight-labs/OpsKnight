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

// Support adaptive ramp stages if in adaptive mode
const isAdaptiveRamp = mode === 'adaptive' || __ENV.LOAD_LEVEL === 'L9';

const capacityStages = isAdaptiveRamp
  ? [
      { target: 50, duration: '30s' },
      { target: 100, duration: '30s' },
      { target: 250, duration: '30s' },
      { target: 500, duration: '30s' },
      { target: 750, duration: '30s' },
      { target: 1000, duration: '30s' },
      { target: 1500, duration: '30s' },
      { target: 2000, duration: '30s' },
      { target: 3000, duration: '30s' },
      { target: 5000, duration: '30s' },
      { target: 100, duration: '20s' },
    ]
  : [
      { target: Math.max(10, Math.floor(level.targetRps * 0.5)), duration: durations.warmup },
      { target: level.targetRps, duration: durations.steady },
      { target: Math.max(5, Math.floor(level.targetRps * 0.2)), duration: durations.cooldown },
    ];

export const options = {
  scenarios: {
    contract_bucket_guard: {
      executor: 'constant-arrival-rate',
      rate: mode === 'capacity' ? 2 : 5,
      timeUnit: '1s',
      duration: isAdaptiveRamp ? '320s' : durations.steady,
      preAllocatedVUs: 8,
      maxVUs: 20,
      exec: 'runContractRateLimitScenario',
    },
    capacity_ingestion: {
      executor: 'ramping-arrival-rate',
      startRate: Math.max(5, Math.floor(level.targetRps * 0.25)),
      timeUnit: '1s',
      preAllocatedVUs: isAdaptiveRamp ? 350 : level.vus,
      maxVUs: isAdaptiveRamp ? 1200 : level.maxVUs,
      stages: capacityStages,
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

  // Traffic Distribution:
  // - 35% new incident triggers (unique dedup key)
  // - 25% dedup / update on existing incident
  // - 15% resolve
  // - 10% repeated dedup storm (same service + dedup key -> 1 incident)
  // - 10% high-cardinality storm (unique key per event)
  // - 5% malformed / auth / rate-limit traffic
  const trafficSelector = (__ITER * 17 + __VU * 31) % 100;
  const severity = SEVERITIES[(__VU + __ITER) % SEVERITIES.length];

  let eventAction = 'trigger';
  let dedupKey;
  let subMode = 'unique';
  let payloadBody = null;
  let useBadAuth = false;

  if (trafficSelector < 35) {
    // 35% New Incident Triggers
    subMode = 'new_incident';
    dedupKey = `lt-new-${__VU}-${__ITER}-${Date.now()}`;
    eventAction = 'trigger';
  } else if (trafficSelector < 60) {
    // 25% Dedup / update existing incident
    subMode = 'update_existing';
    const slot = (__VU + __ITER) % 50;
    dedupKey = `lt-existing-incident-${String(slot).padStart(3, '0')}`;
    eventAction = 'trigger';
  } else if (trafficSelector < 75) {
    // 15% Resolve existing incident
    subMode = 'resolve_existing';
    const slot = (__VU + __ITER) % 50;
    dedupKey = `lt-existing-incident-${String(slot).padStart(3, '0')}`;
    eventAction = 'resolve';
  } else if (trafficSelector < 85 || level.name === 'L4_dedup_storm') {
    // 10% Repeated Dedup Storm: 10,000 events to same service and same dedup key -> exactly 1 incident
    subMode = 'dedup_storm';
    dedupKey = 'lt-mega-dedup-storm-hotkey-001';
    eventAction = 'trigger';
  } else if (trafficSelector < 95) {
    // 10% High-Cardinality Storm: unique dedup key per event
    subMode = 'high_cardinality';
    dedupKey = `lt-high-card-${__VU}-${__ITER}-${Date.now()}-${Math.random()}`;
    eventAction = 'trigger';
  } else {
    // 5% Malformed / Auth / Invalid Traffic
    subMode = 'malformed_or_unauthorized';
    if (__ITER % 2 === 0) {
      useBadAuth = true;
      dedupKey = `lt-bad-auth-${__VU}-${__ITER}`;
    } else {
      payloadBody = { invalid_structure: true, missing_required_fields: 123 };
    }
  }

  const effectivePayload = payloadBody || {
    event_action: eventAction,
    dedup_key: dedupKey,
    payload: {
      summary: `[Capacity ${subMode}] ${severity.toUpperCase()} signal on ${dedupKey}`,
      source: `k6-node-${__VU % 32}`,
      severity,
      custom_details: {
        subMode,
        vu: __VU,
        iter: __ITER,
        timestamp: new Date().toISOString(),
      },
    },
  };

  const keyToUse = useBadAuth ? 'invalid_load_cert_token_0000000000' : integrationKey;

  const res = postEventApi(baseUrl, keyToUse, effectivePayload, {
    endpoint: 'events_api',
    mode: 'capacity',
    subMode,
  });

  if (useBadAuth || payloadBody) {
    check(res, {
      'invalid event correctly rejected with 400 or 401': r =>
        r.status === 400 || r.status === 401 || r.status === 422,
    });
  } else {
    check(res, {
      'capacity event accepted (202 or 429 under storm)': r =>
        r.status === 202 || r.status === 429,
    });
  }

  if (subMode === 'resolve_existing') {
    sleep(0.02);
  }
}
