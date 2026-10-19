import { check, sleep } from 'k6';
import http from 'k6/http';
import {
  getActiveLoadLevel,
  getBaseUrl,
  getDurationProfile,
  loadSeedManifest,
  opsknightMetrics,
  pickApiKey,
} from './_shared.js';

const manifest = loadSeedManifest();
const level = getActiveLoadLevel();
const durations = getDurationProfile();

export const options = {
  scenarios: {
    interactive_users: {
      executor: 'ramping-vus',
      startVUs: Math.max(5, Math.floor(level.vus * 0.2)),
      stages: [
        { target: Math.max(10, Math.floor(level.vus * 0.5)), duration: durations.warmup },
        { target: level.vus, duration: durations.steady },
        { target: 5, duration: durations.cooldown },
      ],
      exec: 'runInteractiveUserSession',
    },
  },
  thresholds: {
    opsknight_user_workload_success_rate: ['rate>0.95'],
  },
};

export function runInteractiveUserSession() {
  const baseUrl = getBaseUrl();
  const apiKey = pickApiKey(manifest, __VU, __ITER);
  const baselineIds = manifest.baselineIncidentIds || [];
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  // Step 1: Browse Incident List with pagination and filter
  const listStart = Date.now();
  const listRes = http.get(`${baseUrl}/api/incidents?limit=25&status=OPEN,ACKNOWLEDGED`, {
    headers,
    tags: { endpoint: 'user_incident_list' },
  });
  opsknightMetrics.userWorkloadLatencyMs.add(Date.now() - listStart, { action: 'list' });
  const listOk = check(listRes, {
    'incident list returned 200': r => r.status === 200 || r.status === 429,
  });
  opsknightMetrics.userWorkloadSuccessRate.add(listOk);
  sleep(0.1 + Math.random() * 0.2);

  // Step 2: Open Incident Detail
  let targetIncidentId = baselineIds.length > 0 ? baselineIds[__VU % baselineIds.length] : null;
  try {
    const incidents = listRes.json('incidents');
    if (Array.isArray(incidents) && incidents.length > 0) {
      targetIncidentId = incidents[0].id;
    }
  } catch {}

  if (targetIncidentId) {
    const detailStart = Date.now();
    const detailRes = http.get(`${baseUrl}/api/incidents/${targetIncidentId}`, {
      headers,
      tags: { endpoint: 'user_incident_detail' },
    });
    opsknightMetrics.userWorkloadLatencyMs.add(Date.now() - detailStart, { action: 'detail' });
    const detailOk = check(detailRes, {
      'incident detail returned 200': r => r.status === 200 || r.status === 429,
    });
    opsknightMetrics.userWorkloadSuccessRate.add(detailOk);
    sleep(0.1 + Math.random() * 0.15);

    // Step 3: Update urgency through the supported incident API
    if (__ITER % 3 === 0) {
      const mutateStart = Date.now();
      const urgencyRes = http.patch(
        `${baseUrl}/api/incidents/${targetIncidentId}`,
        JSON.stringify({ urgency: __ITER % 2 === 0 ? 'HIGH' : 'MEDIUM' }),
        {
          headers,
          tags: { endpoint: 'user_update_urgency' },
        }
      );
      opsknightMetrics.userWorkloadLatencyMs.add(Date.now() - mutateStart, { action: 'urgency' });
      opsknightMetrics.userWorkloadSuccessRate.add(
        urgencyRes.status === 200 || urgencyRes.status === 409 || urgencyRes.status === 429
      );
    }
  }

  // Step 4: Access System Health / Analytics Overview
  const analyticsRes = http.get(`${baseUrl}/api/health`, {
    headers,
    tags: { endpoint: 'user_dashboard_overview' },
  });
  opsknightMetrics.userWorkloadSuccessRate.add(
    analyticsRes.status === 200 || analyticsRes.status === 429
  );

  sleep(0.25 + Math.random() * 0.25);
}
