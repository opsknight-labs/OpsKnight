import { sleep } from 'k6';
import http from 'k6/http';
import { Counter, Rate, Trend } from 'k6/metrics';

export const LOAD_LEVELS = {
  L0: {
    name: 'L0_smoke',
    description: 'Smoke correctness (5-10 VUs, 10-20 req/s)',
    vus: 8,
    maxVUs: 16,
    targetRps: 15,
    sseStreams: 10,
  },
  L1: {
    name: 'L1_steady_baseline',
    description: 'Steady baseline (25 VUs, 50 req/s)',
    vus: 25,
    maxVUs: 50,
    targetRps: 50,
    sseStreams: 100,
  },
  L2: {
    name: 'L2_normal_production_peak',
    description: 'Normal production peak (100 VUs, 150 req/s)',
    vus: 100,
    maxVUs: 200,
    targetRps: 150,
    sseStreams: 250,
  },
  L3: {
    name: 'L3_alert_storm',
    description: 'Alert storm (250 VUs, 500 req/s across 300+ integration keys)',
    vus: 250,
    maxVUs: 450,
    targetRps: 500,
    sseStreams: 500,
  },
  L4: {
    name: 'L4_dedup_storm',
    description: 'Deduplication & advisory-lock storm (250 VUs, 500 req/s onto 20 hot dedup keys)',
    vus: 250,
    maxVUs: 450,
    targetRps: 500,
    sseStreams: 250,
  },
  L5: {
    name: 'L5_major_outage_fanout',
    description: 'Major outage + status-page fanout (300 VUs, 50k+ notifications)',
    vus: 300,
    maxVUs: 500,
    targetRps: 300,
    sseStreams: 500,
  },
  L6: {
    name: 'L6_provider_degradation',
    description: 'Downstream provider 429/500/timeout degradation (150 VUs)',
    vus: 150,
    maxVUs: 300,
    targetRps: 150,
    sseStreams: 250,
  },
  L7: {
    name: 'L7_realtime_sse_scale',
    description: 'Realtime SSE scale (100 -> 500 -> 1,500 -> 5,000 streams)',
    vus: 500,
    maxVUs: 5000,
    targetRps: 100,
    sseStreams: 1500,
  },
  L8: {
    name: 'L8_Chaos_Recovery',
    description: 'Chaos & worker/DB recovery under active load (150 VUs)',
    vus: 150,
    maxVUs: 300,
    targetRps: 150,
    sseStreams: 200,
  },
  L9: {
    name: 'L9_breaking_point_ramp',
    description: 'Breaking-point step ramp until saturation (up to 1,000 VUs)',
    vus: 500,
    maxVUs: 1000,
    targetRps: 1000,
    sseStreams: 1000,
  },
};

export const DURATION_PROFILES = {
  cert: {
    warmup: '3s',
    steady: '8s',
    cooldown: '2s',
  },
  fast: {
    warmup: '15s',
    steady: '45s',
    cooldown: '15s',
  },
  standard: {
    warmup: '2m',
    steady: '10m',
    cooldown: '2m',
  },
  soak: {
    warmup: '5m',
    steady: '110m',
    cooldown: '5m',
  },
};

export const opsknightMetrics = {
  eventsAccepted: new Counter('opsknight_events_accepted_total'),
  eventsRateLimited: new Counter('opsknight_events_rate_limited_total'),
  eventsUnexpectedError: new Counter('opsknight_events_unexpected_error_total'),
  eventsSuccessRate: new Rate('opsknight_events_success_rate'),
  eventsLatencyMs: new Trend('opsknight_events_latency_ms', true),

  lifecycleSuccessRate: new Rate('opsknight_lifecycle_success_rate'),
  lifecycleLatencyMs: new Trend('opsknight_lifecycle_latency_ms', true),
  lifecycleRaceConflicts: new Counter('opsknight_lifecycle_race_conflicts_total'),

  statusPageReadLatencyMs: new Trend('opsknight_status_page_read_latency_ms', true),
  statusPageSuccessRate: new Rate('opsknight_status_page_success_rate'),

  sseConnectSuccessRate: new Rate('opsknight_sse_connect_success_rate'),
  sseConnectLatencyMs: new Trend('opsknight_sse_connect_latency_ms', true),
};

export function getActiveLoadLevel() {
  const levelKey = (__ENV.LOAD_LEVEL || 'L1').toUpperCase();
  return LOAD_LEVELS[levelKey] || LOAD_LEVELS.L1;
}

export function getDurationProfile() {
  const profileKey = (__ENV.LOAD_DURATION_PROFILE || 'fast').toLowerCase();
  return DURATION_PROFILES[profileKey] || DURATION_PROFILES.fast;
}

export function getBaseUrl() {
  return (__ENV.BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
}

export function getControlBaseUrl() {
  return (__ENV.LOAD_EMULATOR_CONTROL_URL || 'http://127.0.0.1:8088').replace(/\/$/, '');
}

export function loadSeedManifest() {
  const candidates = [
    __ENV.LOAD_SEED_MANIFEST,
    '../../artifacts/load-certification/seed-manifest.json',
    './artifacts/load-certification/seed-manifest.json',
  ].filter(Boolean);

  for (let i = 0; i < candidates.length; i++) {
    try {
      const raw = open(candidates[i]);
      if (raw) {
        return JSON.parse(raw);
      }
    } catch {
      // Try next candidate
    }
  }

  // Fallback synthetic manifest when running k6 smoke check without disk manifest
  const fallbackCapacityKeys = [];
  const fallbackServiceIds = [];
  for (let i = 2; i <= 12; i++) {
    const keyPadded = String(i).padStart(4, '0');
    const svcPadded = String(i).padStart(3, '0');
    fallbackCapacityKeys.push(`lt_capacity_events_key_${keyPadded}`);
    fallbackServiceIds.push(`lt-service-${svcPadded}`);
  }

  const fallbackApiKeys = [];
  for (let i = 1; i <= 12; i++) {
    const padded = String(i).padStart(4, '0');
    fallbackApiKeys.push(`ok_load_cert_token_${padded}_9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c`);
  }

  return {
    baseUrl: getBaseUrl(),
    contractIntegrationKey: 'lt_contract_events_key_0001',
    contractServiceId: 'lt-service-001',
    capacityIntegrationKeys: fallbackCapacityKeys,
    capacityServiceIds: fallbackServiceIds,
    allServiceIds: ['lt-service-001'].concat(fallbackServiceIds),
    apiKeys: fallbackApiKeys,
    adminApiKey: fallbackApiKeys[0],
    sessionCookies: [],
    statusPage: {
      id: 'lt-status-page-001',
      slug: 'load-cert-status',
      subscriberCount: 500,
    },
    scheduleIds: ['lt-schedule-001'],
    escalationPolicyIds: ['lt-policy-001'],
    baselineIncidentIds: ['lt-incident-00001'],
  };
}

http.setResponseCallback(
  http.expectedStatuses({ min: 200, max: 399 }, 400, 409, 422, 429, 503)
);

export function pickCapacityIntegrationKey(manifest, vu, iter) {
  const keys = manifest.capacityIntegrationKeys || [];
  if (keys.length === 0) return manifest.contractIntegrationKey;
  // Prefer internal services (index >= 3) for general load so status-page services are not spammed
  const startIdx = keys.length > 3 ? 3 : 0;
  const idx = startIdx + ((vu * 131 + iter) % (keys.length - startIdx));
  return keys[idx];
}

export function pickApiKey(manifest, vu, iter) {
  const keys = manifest.apiKeys || [];
  if (keys.length === 0) return manifest.adminApiKey;
  const idx = (vu * 37 + iter) % keys.length;
  return keys[idx];
}

export function pickServiceId(manifest, vu, iter) {
  const ids = manifest.capacityServiceIds || manifest.allServiceIds || [];
  if (ids.length === 0) return manifest.contractServiceId;
  const startIdx = ids.length > 3 ? 3 : 0;
  const idx = startIdx + ((vu * 53 + iter) % (ids.length - startIdx));
  return ids[idx];
}

export function postEventApi(baseUrl, integrationKey, payload, tags) {
  const effectiveTags = tags || { endpoint: 'events_api' };
  let res = http.post(`${baseUrl}/api/events`, JSON.stringify(payload), {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Token token=${integrationKey}`,
    },
    tags: effectiveTags,
  });

  for (let retry = 0; retry < 3 && (res.status >= 500 || res.status === 0); retry++) {
    sleep(0.1 + Math.random() * 0.15);
    res = http.post(`${baseUrl}/api/events`, JSON.stringify(payload), {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Token token=${integrationKey}`,
      },
      tags: effectiveTags,
    });
  }

  opsknightMetrics.eventsLatencyMs.add(res.timings.duration, effectiveTags);
  if (res.status === 202) {
    opsknightMetrics.eventsAccepted.add(1);
    opsknightMetrics.eventsSuccessRate.add(true);
  } else if (res.status === 429) {
    opsknightMetrics.eventsRateLimited.add(1);
    opsknightMetrics.eventsSuccessRate.add(true);
  } else {
    console.error(`[postEventApi Error] status=${res.status} body=${res.body}`);
    opsknightMetrics.eventsUnexpectedError.add(1);
    opsknightMetrics.eventsSuccessRate.add(false);
  }

  return res;
}

export function setEmulatorBehavior(controlBaseUrl, body) {
  return http.post(`${controlBaseUrl}/behavior`, JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    tags: { endpoint: 'emulator_control' },
  });
}
