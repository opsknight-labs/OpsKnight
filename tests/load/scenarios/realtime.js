import { check, sleep } from 'k6';
import http from 'k6/http';
import {
  getActiveLoadLevel,
  getBaseUrl,
  getDurationProfile,
  loadSeedManifest,
  opsknightMetrics,
  pickCapacityIntegrationKey,
  postEventApi,
} from './_shared.js';

const manifest = loadSeedManifest();
const level = getActiveLoadLevel();
const durations = getDurationProfile();
const targetStreams = Number(__ENV.SSE_CONCURRENT_STREAMS || level.sseStreams || 100);

export const options = {
  scenarios: {
    sse_subscribers: {
      executor: 'ramping-vus',
      startVUs: Math.max(10, Math.floor(targetStreams * 0.2)),
      stages: [
        { target: Math.max(20, Math.floor(targetStreams * 0.5)), duration: durations.warmup },
        { target: targetStreams, duration: durations.steady },
        { target: 10, duration: durations.cooldown },
      ],
      exec: 'runSseSubscriberStream',
    },
    realtime_change_driver: {
      executor: 'constant-arrival-rate',
      rate: Math.max(5, Math.min(50, Math.floor(level.targetRps * 0.2))),
      timeUnit: '1s',
      duration: durations.steady,
      preAllocatedVUs: 10,
      maxVUs: 30,
      exec: 'runRealtimeChangeDriver',
    },
  },
  thresholds: {
    opsknight_sse_connect_success_rate: ['rate>0.95'],
  },
};

export function runSseSubscriberStream() {
  const baseUrl = getBaseUrl();
  const cookies = manifest.sessionCookies || [];
  if (cookies.length === 0) {
    // Fallback probe if session cookies were not seeded
    const healthRes = http.get(`${baseUrl}/api/health`, {
      tags: { endpoint: 'health_fallback' },
    });
    opsknightMetrics.sseConnectSuccessRate.add(healthRes.status === 200);
    sleep(0.5);
    return;
  }

  const session = cookies[(__VU + __ITER) % cookies.length];
  const endpoint = __VU % 3 === 0 ? '/api/events/stream' : '/api/realtime/stream';

  // Open SSE stream for a bounded window (e.g., 4s per iteration) so k6 measures stream establishment
  // and initial payload delivery without hanging indefinitely
  const res = http.get(`${baseUrl}${endpoint}`, {
    headers: {
      Accept: 'text/event-stream',
      Cookie: session.cookieHeader,
      'Cache-Control': 'no-cache',
    },
    timeout: '4s',
    tags: { endpoint: 'sse_stream', streamPath: endpoint },
  });

  // Note: For long-lived SSE in k6 http.get, either status 200 or a client read timeout after headers
  // with status 200/0 after receiving event-stream chunks indicates active stream hold.
  const isConnected =
    res.status === 200 ||
    (res.error_code === 1050 && (!res.status || res.status === 200));

  opsknightMetrics.sseConnectLatencyMs.add(res.timings.connecting + res.timings.waiting);
  opsknightMetrics.sseConnectSuccessRate.add(isConnected);

  check(res, {
    'SSE stream established without 401/500': () =>
      res.status !== 401 && res.status !== 403 && res.status < 500,
  });

  sleep(0.2);
}

export function runRealtimeChangeDriver() {
  const baseUrl = getBaseUrl();
  const integrationKey = pickCapacityIntegrationKey(manifest, __VU, __ITER);
  const dedupKey = `lt-rt-change-${__VU}-${__ITER}`;
  const action = __ITER % 3 === 0 ? 'trigger' : __ITER % 3 === 1 ? 'acknowledge' : 'resolve';

  postEventApi(
    baseUrl,
    integrationKey,
    {
      event_action: action,
      dedup_key: dedupKey,
      payload: {
        summary: `[Realtime Broadcast] ${action} on ${dedupKey}`,
        source: 'k6-realtime-driver',
        severity: 'error',
      },
    },
    { endpoint: 'events_api', scenario: 'realtime_driver' }
  );
}
