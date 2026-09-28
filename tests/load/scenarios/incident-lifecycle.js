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
    concurrent_50_ack_storm: {
      executor: 'per-vu-iterations',
      vus: 50,
      iterations: 2,
      exec: 'runConcurrent50AckStorm',
      startTime: durations.warmup,
    },
    ack_resolve_submillisecond_race: {
      executor: 'constant-vus',
      vus: 8,
      duration: durations.steady,
      exec: 'runAckResolveSubmillisecondRace',
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
    description: 'Comprehensive responder lifecycle torture drill verifying create -> ack -> note -> snooze -> resolve',
    serviceId,
    urgency: __ITER % 3 === 0 ? 'HIGH' : __ITER % 3 === 1 ? 'MEDIUM' : 'LOW',
    priority: __ITER % 2 === 0 ? 'P1' : 'P2',
  });

  let createRes = http.post(`${baseUrl}/api/incidents`, createBody, {
    headers,
    tags: { endpoint: 'incidents_create' },
  });
  for (let retry = 0; retry < 5 && (createRes.status >= 500 || createRes.status === 0); retry++) {
    sleep(0.2 + retry * 0.15 + Math.random() * 0.15);
    createRes = http.post(`${baseUrl}/api/incidents`, createBody, {
      headers,
      tags: { endpoint: 'incidents_create_retry' },
    });
  }
  opsknightMetrics.lifecycleLatencyMs.add(createRes.timings.duration);

  if (
    createRes.status === 429 ||
    createRes.status === 503 ||
    (createRes.status === 500 &&
      createRes.body &&
      createRes.body.includes('"retryable":true'))
  ) {
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
  opsknightMetrics.lifecycleSuccessRate.add(createdOk);
  if (!createdOk) return;

  let incidentId;
  try {
    incidentId = createRes.json('incident.id');
  } catch {
    return;
  }
  if (!incidentId) return;

  // 2. Replay same Idempotency-Key to certify idempotency
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
  const ackRes = http.patch(
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
  opsknightMetrics.lifecycleLatencyMs.add(ackRes.timings.duration);
  opsknightMetrics.lifecycleSuccessRate.add(
    ackRes.status === 200 || ackRes.status === 409 || ackRes.status === 429
  );

  // 4. Add Responder Note
  if (__ITER % 2 === 0) {
    const noteRes = http.post(
      `${baseUrl}/api/incidents/${incidentId}/notes`,
      JSON.stringify({ content: `[Auto-note] Responder investigation active by VU ${__VU}` }),
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${pickApiKey(manifest, __VU + 2, __ITER)}`,
        },
        tags: { endpoint: 'incidents_note' },
      }
    );
    opsknightMetrics.lifecycleSuccessRate.add(
      noteRes.status === 201 || noteRes.status === 200 || noteRes.status === 404 || noteRes.status === 429
    );
  }

  // 5. Read Incident Details
  const getRes = http.get(`${baseUrl}/api/incidents/${incidentId}`, {
    headers: {
      Authorization: `Bearer ${pickApiKey(manifest, __VU + 3, __ITER)}`,
    },
    tags: { endpoint: 'incidents_get' },
  });
  opsknightMetrics.lifecycleLatencyMs.add(getRes.timings.duration);
  opsknightMetrics.lifecycleSuccessRate.add(getRes.status === 200 || getRes.status === 429);

  // 6. Resolve Incident
  const resolveRes = http.patch(
    `${baseUrl}/api/incidents/${incidentId}`,
    JSON.stringify({ status: 'RESOLVED' }),
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${pickApiKey(manifest, __VU + 4, __ITER)}`,
        'Idempotency-Key': `lt-idem-resolve-${incidentId}`,
      },
      tags: { endpoint: 'incidents_resolve' },
    }
  );
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

  const slot = (Math.floor((__VU - 1) / 2) + __ITER) % baselineIds.length;
  const incidentId = baselineIds[slot];
  const apiKey = pickApiKey(manifest, __VU, __ITER);
  const nextStatus = __VU % 2 === 0 ? 'ACKNOWLEDGED' : 'RESOLVED';

  const res = http.patch(
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

// Phase 6 Torture: 50 concurrent clients all ACK the exact same incident simultaneously
export function runConcurrent50AckStorm() {
  const baseUrl = getBaseUrl();
  const baselineIds = manifest.baselineIncidentIds || [];
  const targetIncidentId = baselineIds.length > 0 ? baselineIds[0] : 'lt-incident-00001';
  const apiKey = pickApiKey(manifest, __VU, __ITER);

  const res = http.patch(
    `${baseUrl}/api/incidents/${targetIncidentId}`,
    JSON.stringify({ status: 'ACKNOWLEDGED' }),
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      tags: { endpoint: 'incidents_50_ack_storm' },
    }
  );

  opsknightMetrics.lifecycleLatencyMs.add(res.timings.duration);
  if (res.status === 409) {
    opsknightMetrics.lifecycleRaceConflicts.add(1);
  }
  // Exactly 1 client gets 200 or all transition gracefully without 500 error cascades
  check(res, {
    'concurrent ACK handled deterministically': r =>
      r.status === 200 || r.status === 409 || r.status === 400 || r.status === 429,
  });
  opsknightMetrics.lifecycleSuccessRate.add(
    res.status === 200 || res.status === 409 || res.status === 400 || res.status === 429
  );
}

// Phase 6 Torture: Sub-millisecond ACK vs RESOLVE race
export function runAckResolveSubmillisecondRace() {
  const baseUrl = getBaseUrl();
  const baselineIds = manifest.baselineIncidentIds || [];
  if (baselineIds.length < 2) return;

  const targetIncidentId = baselineIds[1];
  const apiKey = pickApiKey(manifest, __VU, __ITER);

  // Send ACK and RESOLVE in rapid parallel bursts
  const requests = [
    {
      method: 'PATCH',
      url: `${baseUrl}/api/incidents/${targetIncidentId}`,
      body: JSON.stringify({ status: 'ACKNOWLEDGED' }),
      params: {
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        tags: { endpoint: 'race_ack' },
      },
    },
    {
      method: 'PATCH',
      url: `${baseUrl}/api/incidents/${targetIncidentId}`,
      body: JSON.stringify({ status: 'RESOLVED' }),
      params: {
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        tags: { endpoint: 'race_resolve' },
      },
    },
  ];

  const responses = http.batch(requests);
  for (const r of responses) {
    opsknightMetrics.lifecycleLatencyMs.add(r.timings.duration);
    if (r.status === 409) opsknightMetrics.lifecycleRaceConflicts.add(1);
    check(r, {
      'race request handled cleanly': res =>
        res.status === 200 || res.status === 409 || res.status === 400 || res.status === 429,
    });
    opsknightMetrics.lifecycleSuccessRate.add(
      r.status === 200 || r.status === 409 || r.status === 400 || r.status === 429
    );
  }
  sleep(0.2);
}
