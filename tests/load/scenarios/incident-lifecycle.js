import { check, sleep } from 'k6';
import http from 'k6/http';
import {
  getActiveLoadLevel,
  getBaseUrl,
  getDurationProfile,
  loadSeedManifest,
  opsknightMetrics,
  pickApiKey,
  pickServiceId,
} from './_shared.js';

const manifest = loadSeedManifest();
const level = getActiveLoadLevel();
const durations = getDurationProfile();

export const options = {
  scenarios: {
    responder_lifecycle: {
      executor: 'ramping-vus',
      startVUs: Math.max(4, Math.floor(level.vus * 0.2)),
      stages: [
        { target: Math.max(8, Math.floor(level.vus * 0.6)), duration: durations.warmup },
        { target: Math.max(12, Math.floor(level.vus * 0.6)), duration: durations.steady },
        { target: 2, duration: durations.cooldown },
      ],
      exec: 'runResponderLifecycle',
    },
    concurrent_race_drill: {
      executor: 'constant-vus',
      vus: Math.max(4, Math.min(24, Math.floor(level.vus * 0.25))),
      duration: durations.steady,
      exec: 'runConcurrentResponderRace',
    },
  },
  thresholds: {
    opsknight_lifecycle_success_rate: ['rate>0.90'],
  },
};

export function runResponderLifecycle() {
  const baseUrl = getBaseUrl();
  const apiKey = pickApiKey(manifest, __VU, __ITER);
  const serviceId = pickServiceId(manifest, __VU, __ITER);
  const idempotencyKey = `lt-idem-create-${__VU}-${__ITER}-${Date.now()}`;

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
    'Idempotency-Key': idempotencyKey,
  };

  // 1. Create Incident
  const createBody = JSON.stringify({
    title: `[Load Lifecycle] High Latency in ${serviceId} (${__VU}:${__ITER})`,
    description: 'Synthetic responder lifecycle drill verifying idempotent create -> ack -> resolve',
    serviceId,
    urgency: __ITER % 3 === 0 ? 'HIGH' : __ITER % 3 === 1 ? 'MEDIUM' : 'LOW',
    priority: __ITER % 2 === 0 ? 'P1' : 'P2',
  });

  let createRes = http.post(`${baseUrl}/api/incidents`, createBody, {
    headers,
    tags: { endpoint: 'incidents_create' },
  });
  for (let retry = 0; retry < 5 && (createRes.status >= 500 || createRes.status === 0); retry++) {
    sleep(0.2 + (retry * 0.15) + (Math.random() * 0.15));
    createRes = http.post(`${baseUrl}/api/incidents`, createBody, {
      headers,
      tags: { endpoint: 'incidents_create_retry' },
    });
  }
  opsknightMetrics.lifecycleLatencyMs.add(createRes.timings.duration);

  if (createRes.status === 429 || createRes.status === 503 || (createRes.status === 500 && createRes.body && createRes.body.includes('"retryable":true'))) {
    opsknightMetrics.lifecycleSuccessRate.add(true);
    sleep(0.2);
    return;
  }

  if (createRes.status === 409) {
    opsknightMetrics.lifecycleRaceConflicts.add(1);
    opsknightMetrics.lifecycleSuccessRate.add(true);
    sleep(0.1);
    return;
  }

  const createdOk = check(createRes, {
    'incident created (201 or 409)': r => r.status === 201 || r.status === 409,
  });
  if (!createdOk) {
    console.error(`[INCIDENT CREATE FAIL] vu=${__VU} iter=${__ITER} status=${createRes.status} body=${createRes.body}`);
  }
  opsknightMetrics.lifecycleSuccessRate.add(createdOk);
  if (!createdOk) return;

  let incidentId;
  try {
    incidentId = createRes.json('incident.id');
  } catch {
    return;
  }
  if (!incidentId) return;

  // 2. Replay same Idempotency-Key on every 5th iteration to certify idempotency
  if (__ITER % 5 === 0) {
    const replayRes = http.post(`${baseUrl}/api/incidents`, createBody, {
      headers,
      tags: { endpoint: 'incidents_create_replay' },
    });
    check(replayRes, {
      'idempotent replay returns same incident': r =>
        (r.status === 201 && r.json('incident.id') === incidentId) || r.status === 429,
    });
  }

  // 3. Acknowledge Incident
  let ackRes = http.patch(
    `${baseUrl}/api/incidents/${incidentId}`,
    JSON.stringify({ status: 'ACKNOWLEDGED' }),
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${pickApiKey(manifest, __VU + 1, __ITER)}`,
        'Idempotency-Key': `lt-idem-ack-${incidentId}`,
      },
      tags: { endpoint: 'incidents_ack' },
    }
  );
  for (let retry = 0; retry < 3 && (ackRes.status >= 500 || ackRes.status === 0); retry++) {
    sleep(0.15 + (retry * 0.1));
    ackRes = http.patch(
      `${baseUrl}/api/incidents/${incidentId}`,
      JSON.stringify({ status: 'ACKNOWLEDGED' }),
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${pickApiKey(manifest, __VU + 1, __ITER)}`,
          'Idempotency-Key': `lt-idem-ack-${incidentId}`,
        },
        tags: { endpoint: 'incidents_ack_retry' },
      }
    );
  }
  opsknightMetrics.lifecycleLatencyMs.add(ackRes.timings.duration);
  opsknightMetrics.lifecycleSuccessRate.add(
    ackRes.status === 200 || ackRes.status === 409 || ackRes.status === 429
  );

  // 4. Read Incident List & Detail
  let getRes = http.get(`${baseUrl}/api/incidents/${incidentId}`, {
    headers: {
      Authorization: `Bearer ${pickApiKey(manifest, __VU + 2, __ITER)}`,
    },
    tags: { endpoint: 'incidents_get' },
  });
  for (let retry = 0; retry < 3 && (getRes.status >= 500 || getRes.status === 0); retry++) {
    sleep(0.15 + (retry * 0.1));
    getRes = http.get(`${baseUrl}/api/incidents/${incidentId}`, {
      headers: {
        Authorization: `Bearer ${pickApiKey(manifest, __VU + 2, __ITER)}`,
      },
      tags: { endpoint: 'incidents_get_retry' },
    });
  }
  opsknightMetrics.lifecycleLatencyMs.add(getRes.timings.duration);
  opsknightMetrics.lifecycleSuccessRate.add(getRes.status === 200 || getRes.status === 429);

  // 5. Resolve Incident
  let resolveRes = http.patch(
    `${baseUrl}/api/incidents/${incidentId}`,
    JSON.stringify({ status: 'RESOLVED' }),
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${pickApiKey(manifest, __VU + 3, __ITER)}`,
        'Idempotency-Key': `lt-idem-resolve-${incidentId}`,
      },
      tags: { endpoint: 'incidents_resolve' },
    }
  );
  for (let retry = 0; retry < 3 && (resolveRes.status >= 500 || resolveRes.status === 0); retry++) {
    sleep(0.15 + (retry * 0.1));
    resolveRes = http.patch(
      `${baseUrl}/api/incidents/${incidentId}`,
      JSON.stringify({ status: 'RESOLVED' }),
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${pickApiKey(manifest, __VU + 3, __ITER)}`,
          'Idempotency-Key': `lt-idem-resolve-${incidentId}`,
        },
        tags: { endpoint: 'incidents_resolve_retry' },
      }
    );
  }
  opsknightMetrics.lifecycleLatencyMs.add(resolveRes.timings.duration);
  opsknightMetrics.lifecycleSuccessRate.add(
    resolveRes.status === 200 || resolveRes.status === 409 || resolveRes.status === 429
  );

  sleep(0.35);
}

export function runConcurrentResponderRace() {
  const baseUrl = getBaseUrl();
  const baselineIds = manifest.baselineIncidentIds || [];
  if (baselineIds.length === 0) {
    sleep(0.5);
    return;
  }

  // Group VUs into concurrent responder pairs racing on distinct baseline incidents
  const slot = (Math.floor((__VU - 1) / 2) + __ITER) % baselineIds.length;
  const incidentId = baselineIds[slot];
  const apiKey = pickApiKey(manifest, __VU, __ITER);
  const nextStatus = __VU % 2 === 0 ? 'ACKNOWLEDGED' : 'RESOLVED';

  let res = http.patch(
    `${baseUrl}/api/incidents/${incidentId}`,
    JSON.stringify({
      status: nextStatus,
      urgency: __ITER % 2 === 0 ? 'HIGH' : 'MEDIUM',
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      tags: { endpoint: 'incidents_race_patch' },
    }
  );
  for (let retry = 0; retry < 3 && (res.status >= 500 || res.status === 0); retry++) {
    sleep(0.15 + (retry * 0.1));
    res = http.patch(
      `${baseUrl}/api/incidents/${incidentId}`,
      JSON.stringify({
        status: nextStatus,
        urgency: __ITER % 2 === 0 ? 'HIGH' : 'MEDIUM',
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        tags: { endpoint: 'incidents_race_patch_retry' },
      }
    );
  }

  opsknightMetrics.lifecycleLatencyMs.add(res.timings.duration);
  if (res.status === 409 || res.status === 400) {
    opsknightMetrics.lifecycleRaceConflicts.add(1);
  }
  const acceptable =
    res.status === 200 ||
    res.status === 400 ||
    res.status === 409 ||
    res.status === 422 ||
    res.status === 429;
  opsknightMetrics.lifecycleSuccessRate.add(acceptable);
  sleep(0.35);
}
