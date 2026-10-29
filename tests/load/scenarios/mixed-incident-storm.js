import { sleep } from 'k6';
import http from 'k6/http';
import {
  getActiveLoadLevel,
  getBaseUrl,
  getControlBaseUrl,
  getDurationProfile,
  loadSeedManifest,
  opsknightMetrics,
  pickApiKey,
  pickCapacityIntegrationKey,
  pickServiceId,
  postEventApi,
  setEmulatorBehavior,
} from './_shared.js';

const manifest = loadSeedManifest();
const level = getActiveLoadLevel();
const durations = getDurationProfile();

export const options = {
  scenarios: {
    storm_alert_ingestion: {
      executor: 'ramping-arrival-rate',
      startRate: Math.max(2, Math.floor(level.targetRps * 0.3)),
      timeUnit: '1s',
      preAllocatedVUs: Math.min(level.maxVUs, Math.max(4, Math.floor(level.vus * 0.5))),
      maxVUs: Math.max(level.maxVUs, 100),
      stages: [
        { target: Math.max(5, Math.floor(level.targetRps * 0.6)), duration: durations.warmup },
        { target: level.targetRps, duration: durations.steady },
        { target: Math.max(2, Math.floor(level.targetRps * 0.2)), duration: durations.cooldown },
      ],
      exec: 'stormAlertIngestion',
    },
    storm_responder_mutations: {
      executor: 'constant-vus',
      vus: Math.max(6, Math.min(60, Math.floor(level.vus * 0.25))),
      duration: durations.steady,
      exec: 'stormResponderMutations',
    },
    storm_status_page_reads: {
      executor: 'constant-vus',
      vus: Math.max(6, Math.min(50, Math.floor(level.vus * 0.2))),
      duration: durations.steady,
      exec: 'stormStatusPageReads',
    },
    storm_sse_streams: {
      executor: 'constant-vus',
      vus: Math.max(8, Math.min(200, Math.floor(level.sseStreams * 0.25))),
      duration: durations.steady,
      exec: 'stormSseStreams',
    },
    storm_provider_chaos: {
      executor: 'per-vu-iterations',
      vus: 1,
      iterations: 1,
      exec: 'stormProviderChaos',
    },
  },
  thresholds: {
    opsknight_events_success_rate: ['rate>0.98'],
    opsknight_lifecycle_success_rate: ['rate>0.90'],
    opsknight_status_page_success_rate: ['rate>0.95'],
  },
};

export function stormAlertIngestion() {
  const baseUrl = getBaseUrl();
  const integrationKey = pickCapacityIntegrationKey(manifest, __VU, __ITER);
  const pattern = __ITER % 10;

  let dedupKey;
  let action = 'trigger';
  let severity = 'critical';

  if (pattern < 5) {
    // 50% unique critical/error alerts across all services
    dedupKey = `lt-storm-uniq-${__VU}-${__ITER}-${Date.now()}`;
    severity = pattern % 2 === 0 ? 'critical' : 'error';
  } else if (pattern < 8) {
    // 30% hot dedup key storm (25 keys)
    dedupKey = `lt-storm-hot-${String((__VU + __ITER) % 25).padStart(3, '0')}`;
    severity = 'critical';
  } else {
    // 20% flapping trigger -> ack -> resolve
    dedupKey = `lt-storm-flap-${String(__VU % 20).padStart(3, '0')}`;
    action = pattern === 8 ? 'acknowledge' : 'resolve';
    severity = 'warning';
  }

  postEventApi(
    baseUrl,
    integrationKey,
    {
      event_action: action,
      dedup_key: dedupKey,
      payload: {
        summary: `[Major Outage Storm] ${severity.toUpperCase()} ${action} on ${dedupKey}`,
        source: `k6-storm-ingester-${__VU % 32}`,
        severity,
        custom_details: {
          stormPattern: pattern,
          vu: __VU,
          iter: __ITER,
        },
      },
    },
    { endpoint: 'events_api', scenario: 'mixed_incident_storm' }
  );
}

export function stormResponderMutations() {
  const baseUrl = getBaseUrl();
  const apiKey = pickApiKey(manifest, __VU, __ITER);
  const serviceId = pickServiceId(manifest, __VU, __ITER);

  let createRes = http.post(
    `${baseUrl}/api/incidents`,
    JSON.stringify({
      title: `[Storm Responder] Service degradation in ${serviceId}`,
      description: 'Concurrent responder action during major-outage storm',
      serviceId,
      urgency: 'HIGH',
      priority: 'P1',
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'Idempotency-Key': `lt-storm-create-${__VU}-${__ITER}-${Date.now()}`,
      },
      tags: { endpoint: 'incidents_create' },
    }
  );
  for (let retry = 0; retry < 4 && (createRes.status >= 500 || createRes.status === 0); retry++) {
    sleep(0.15 + Math.random() * 0.2);
    createRes = http.post(
      `${baseUrl}/api/incidents`,
      JSON.stringify({
        title: `[Storm Responder] Service degradation in ${serviceId}`,
        description: 'Concurrent responder action during major-outage storm',
        serviceId,
        urgency: 'HIGH',
        priority: 'P1',
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'Idempotency-Key': `lt-storm-create-${__VU}-${__ITER}-${Date.now()}`,
        },
        tags: { endpoint: 'incidents_create_retry' },
      }
    );
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

  opsknightMetrics.lifecycleSuccessRate.add(createRes.status === 201);

  if (createRes.status === 201) {
    let incId;
    try {
      incId = createRes.json('incident.id');
    } catch {
      incId = null;
    }
    if (incId) {
      let patchRes = http.patch(
        `${baseUrl}/api/incidents/${incId}`,
        JSON.stringify({
          status: __ITER % 2 === 0 ? 'ACKNOWLEDGED' : 'RESOLVED',
        }),
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${pickApiKey(manifest, __VU + 5, __ITER)}`,
          },
          tags: { endpoint: 'incidents_patch' },
        }
      );
      for (let retry = 0; retry < 4 && (patchRes.status >= 500 || patchRes.status === 0); retry++) {
        sleep(0.15 + Math.random() * 0.2);
        patchRes = http.patch(
          `${baseUrl}/api/incidents/${incId}`,
          JSON.stringify({
            status: __ITER % 2 === 0 ? 'ACKNOWLEDGED' : 'RESOLVED',
          }),
          {
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${pickApiKey(manifest, __VU + 5, __ITER)}`,
            },
            tags: { endpoint: 'incidents_patch_retry' },
          }
        );
      }
      opsknightMetrics.lifecycleLatencyMs.add(patchRes.timings.duration);
      opsknightMetrics.lifecycleSuccessRate.add(
        patchRes.status === 200 || patchRes.status === 409 || patchRes.status === 429 || patchRes.status === 503 || (patchRes.status === 500 && patchRes.body && patchRes.body.includes('"retryable":true'))
      );
    }
  }
  sleep(0.35);
}

export function stormStatusPageReads() {
  const baseUrl = getBaseUrl();
  let res = http.get(`${baseUrl}/api/status`, {
    tags: { endpoint: 'status_api_read' },
  });
  for (let retry = 0; retry < 3 && (res.status >= 500 || res.status === 0); retry++) {
    sleep(0.1 + Math.random() * 0.1);
    res = http.get(`${baseUrl}/api/status`, {
      tags: { endpoint: 'status_api_read_retry' },
    });
  }
  opsknightMetrics.statusPageReadLatencyMs.add(res.timings.duration);
  opsknightMetrics.statusPageSuccessRate.add(
    res.status === 200 ||
      res.status === 429 ||
      (res.status === 503 && Boolean(res.headers['Retry-After'] || res.headers['retry-after']))
  );
  sleep(0.15);
}

export function stormSseStreams() {
  const baseUrl = getBaseUrl();
  const cookies = manifest.sessionCookies || [];
  if (cookies.length === 0) {
    sleep(0.5);
    return;
  }
  const session = cookies[(__VU + __ITER) % cookies.length];
  const res = http.get(`${baseUrl}/api/realtime/stream`, {
    headers: {
      Accept: 'text/event-stream',
      Cookie: session.cookieHeader,
    },
    timeout: '3s',
    tags: { endpoint: 'sse_stream' },
  });
  const ok =
    res.status === 200 ||
    (res.error_code === 1050 && (!res.status || res.status === 200));
  opsknightMetrics.sseConnectSuccessRate.add(ok);
  sleep(0.2);
}

export function stormProviderChaos() {
  const controlBaseUrl = getControlBaseUrl();
  const isCert = (__ENV.LOAD_DURATION_PROFILE || 'fast').toLowerCase() === 'cert';
  const stepSec = isCert ? 3 : 10;

  setEmulatorBehavior(controlBaseUrl, {
    provider: 'all',
    mode: '200_fast',
    latencyMs: 20,
    jitterMs: 10,
    errorRate: 0,
  });
  sleep(stepSec);

  // Inject realistic provider headwinds mid-storm (15% 429 rate-limit on Slack & SMS)
  setEmulatorBehavior(controlBaseUrl, {
    provider: 'slack',
    mode: 'mixed',
    errorRate: 0.15,
    retryAfterSeconds: 2,
    latencyMs: 120,
  });
  setEmulatorBehavior(controlBaseUrl, {
    provider: 'sms',
    mode: 'mixed',
    errorRate: 0.15,
    retryAfterSeconds: 2,
    latencyMs: 90,
  });
  sleep(stepSec);

  // Restore to fast 200 OK so storm backlog drains cleanly before verification
  setEmulatorBehavior(controlBaseUrl, {
    provider: 'all',
    mode: '200_fast',
    latencyMs: 10,
    jitterMs: 5,
    errorRate: 0,
  });
}
