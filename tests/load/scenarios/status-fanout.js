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

export const options = {
  scenarios: {
    status_page_readers: {
      executor: 'ramping-vus',
      startVUs: Math.max(5, Math.floor(level.vus * 0.2)),
      stages: [
        { target: Math.max(15, Math.floor(level.vus * 0.6)), duration: durations.warmup },
        { target: Math.max(25, Math.floor(level.vus * 0.8)), duration: durations.steady },
        { target: 5, duration: durations.cooldown },
      ],
      exec: 'runStatusPageReads',
    },
    critical_under_bulk_fanout: {
      executor: 'constant-arrival-rate',
      rate: Math.max(4, Math.floor(level.targetRps * 0.2)),
      timeUnit: '1s',
      duration: durations.steady,
      preAllocatedVUs: 15,
      maxVUs: 50,
      exec: 'runCriticalIncidentUnderFanout',
    },
  },
  thresholds: {
    opsknight_status_page_success_rate: ['rate>0.85'],
    opsknight_events_success_rate: ['rate>0.95'],
  },
};

export function runStatusPageReads() {
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
  const ok = check(res, {
    'status API responds 200, 429 or 503 fail-closed with Retry-After': r =>
      r.status === 200 ||
      r.status === 429 ||
      (r.status === 503 && Boolean(r.headers['Retry-After'] || r.headers['retry-after'])),
  });
  opsknightMetrics.statusPageSuccessRate.add(ok);
  sleep(0.1);
}

export function runCriticalIncidentUnderFanout() {
  const baseUrl = getBaseUrl();
  // Alternate between status-page-mapped services (driving BULK subscriber fanout)
  // and high-urgency critical responder incidents (driving CRITICAL traffic class)
  const isCriticalProbe = __ITER % 3 !== 0;
  const integrationKey = isCriticalProbe
    ? pickCapacityIntegrationKey(manifest, __VU + 17, __ITER)
    : manifest.capacityIntegrationKeys[1] ||
      manifest.capacityIntegrationKeys[0] ||
      manifest.contractIntegrationKey;

  const dedupKey = `lt-fanout-${isCriticalProbe ? 'crit' : 'bulk'}-${__VU}-${__ITER}-${Date.now()}`;
  const res = postEventApi(
    baseUrl,
    integrationKey,
    {
      event_action: 'trigger',
      dedup_key: dedupKey,
      payload: {
        summary: isCriticalProbe
          ? `[CRITICAL Priority Guard] Responder P1 page ${dedupKey}`
          : `[Status Page Fanout] Major service incident ${dedupKey}`,
        source: isCriticalProbe ? 'k6-critical-priority-probe' : 'k6-status-fanout-driver',
        severity: 'critical',
      },
    },
    {
      endpoint: 'events_api',
      trafficClass: isCriticalProbe ? 'CRITICAL' : 'BULK',
    }
  );

  check(res, {
    'fanout/critical trigger accepted (202 or 429)': r => r.status === 202 || r.status === 429,
  });
}
