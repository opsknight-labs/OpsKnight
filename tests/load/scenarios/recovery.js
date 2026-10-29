import { check, sleep } from 'k6';
import http from 'k6/http';
import {
  getActiveLoadLevel,
  getBaseUrl,
  getDurationProfile,
  loadSeedManifest,
  opsknightMetrics,
  pickApiKey,
  pickCapacityIntegrationKey,
  postEventApi,
} from './_shared.js';

const manifest = loadSeedManifest();
const level = getActiveLoadLevel();
const durations = getDurationProfile();

export const options = {
  scenarios: {
    recovery_event_stream: {
      executor: 'constant-arrival-rate',
      rate: Math.max(10, Math.floor(level.targetRps * 0.4)),
      timeUnit: '1s',
      duration: durations.steady,
      preAllocatedVUs: Math.max(15, Math.floor(level.vus * 0.5)),
      maxVUs: level.maxVUs,
      exec: 'runRecoveryEventStream',
    },
    recovery_health_and_api_probe: {
      executor: 'constant-vus',
      vus: 6,
      duration: durations.steady,
      exec: 'runRecoveryHealthAndApiProbe',
    },
  },
  thresholds: {
    opsknight_events_success_rate: ['rate>0.95'],
  },
};

export function runRecoveryEventStream() {
  const baseUrl = getBaseUrl();
  const integrationKey = pickCapacityIntegrationKey(manifest, __VU, __ITER);
  const dedupKey = `lt-recovery-${__VU}-${__ITER}-${Date.now()}`;

  const res = postEventApi(
    baseUrl,
    integrationKey,
    {
      event_action: 'trigger',
      dedup_key: dedupKey,
      payload: {
        summary: `[Recovery Drill] Continuous alert ingestion ${dedupKey}`,
        source: `k6-recovery-probe-${__VU}`,
        severity: 'critical',
        custom_details: {
          drill: __ENV.RECOVERY_DRILL_NAME || 'worker_restart',
          dedupKey,
        },
      },
    },
    { endpoint: 'events_api', scenario: 'recovery' }
  );

  check(res, {
    'recovery event accepted (202)': r => r.status === 202,
  });
}

export function runRecoveryHealthAndApiProbe() {
  const baseUrl = getBaseUrl();
  const apiKey = pickApiKey(manifest, __VU, __ITER);

  const healthRes = http.get(`${baseUrl}/api/health`, {
    tags: { endpoint: 'health_probe' },
  });
  check(healthRes, {
    'health endpoint returns 200': r => r.status === 200,
  });

  const listRes = http.get(`${baseUrl}/api/incidents?limit=10`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    tags: { endpoint: 'incidents_list_recovery' },
  });
  opsknightMetrics.lifecycleLatencyMs.add(listRes.timings.duration);
  opsknightMetrics.lifecycleSuccessRate.add(
    listRes.status === 200 || listRes.status === 429
  );

  sleep(0.25);
}
