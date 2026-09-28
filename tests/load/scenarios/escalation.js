import { check, sleep } from 'k6';
import http from 'k6/http';
import {
  getActiveLoadLevel,
  getBaseUrl,
  getDurationProfile,
  loadSeedManifest,
  pickApiKey,
  pickCapacityIntegrationKey,
  postEventApi,
} from './_shared.js';

const manifest = loadSeedManifest();
const level = getActiveLoadLevel();
const durations = getDurationProfile();

export const options = {
  scenarios: {
    escalation_wave: {
      executor: 'ramping-arrival-rate',
      startRate: Math.max(4, Math.floor(level.targetRps * 0.15)),
      timeUnit: '1s',
      preAllocatedVUs: Math.max(10, Math.floor(level.vus * 0.5)),
      maxVUs: level.maxVUs,
      stages: [
        { target: Math.max(8, Math.floor(level.targetRps * 0.3)), duration: durations.warmup },
        { target: Math.max(15, Math.floor(level.targetRps * 0.5)), duration: durations.steady },
        { target: 4, duration: durations.cooldown },
      ],
      exec: 'runEscalationWave',
    },
    ack_during_escalation_race: {
      executor: 'constant-vus',
      vus: Math.max(4, Math.min(20, Math.floor(level.vus * 0.2))),
      duration: durations.steady,
      exec: 'runAckEscalationRace',
    },
  },
  thresholds: {
    opsknight_events_success_rate: ['rate>0.99'],
  },
};

export function runEscalationWave() {
  const baseUrl = getBaseUrl();
  const integrationKey = pickCapacityIntegrationKey(manifest, __VU, __ITER);
  const dedupKey = `lt-esc-wave-${__VU}-${__ITER}-${Date.now()}`;

  // Leave incident unacknowledged so step 0 (immediate) and subsequent steps execute via worker
  const res = postEventApi(
    baseUrl,
    integrationKey,
    {
      event_action: 'trigger',
      dedup_key: dedupKey,
      payload: {
        summary: `[Escalation Wave] Unacknowledged P1 incident ${dedupKey}`,
        source: `k6-escalation-driver-${__VU}`,
        severity: 'critical',
        custom_details: {
          scenario: 'escalation_wave',
          dedupKey,
        },
      },
    },
    { endpoint: 'events_api', scenario: 'escalation_wave' }
  );

  check(res, {
    'escalation incident triggered (202 or 429)': r => r.status === 202 || r.status === 429,
  });
}

export function runAckEscalationRace() {
  const baseUrl = getBaseUrl();
  const integrationKey = pickCapacityIntegrationKey(manifest, __VU + 100, __ITER);
  const dedupKey = `lt-esc-race-${__VU}-${__ITER}-${Date.now()}`;

  const triggerRes = postEventApi(
    baseUrl,
    integrationKey,
    {
      event_action: 'trigger',
      dedup_key: dedupKey,
      payload: {
        summary: `[Escalation Race] Trigger then rapid ACK/RESOLVE ${dedupKey}`,
        source: `k6-escalation-race-${__VU}`,
        severity: 'critical',
      },
    },
    { endpoint: 'events_api', scenario: 'ack_escalation_race' }
  );

  if (triggerRes.status !== 202) {
    sleep(0.1);
    return;
  }

  let incidentId;
  try {
    incidentId = triggerRes.json('result.incident.id');
  } catch {
    incidentId = null;
  }

  // Sleep briefly (50-250ms) so immediate step-0 escalation job is in-flight when ACK/RESOLVE lands
  sleep(0.05 + (__ITER % 5) * 0.04);

  if (incidentId) {
    const apiKey = pickApiKey(manifest, __VU, __ITER);
    const nextStatus = __ITER % 2 === 0 ? 'ACKNOWLEDGED' : 'RESOLVED';
    http.patch(
      `${baseUrl}/api/incidents/${incidentId}`,
      JSON.stringify({ status: nextStatus }),
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        tags: { endpoint: 'incidents_race_ack' },
      }
    );
  } else {
    postEventApi(
      baseUrl,
      integrationKey,
      {
        event_action: __ITER % 2 === 0 ? 'acknowledge' : 'resolve',
        dedup_key: dedupKey,
        payload: {
          summary: `[Escalation Race] Event ACK/RESOLVE ${dedupKey}`,
          source: `k6-escalation-race-${__VU}`,
          severity: 'critical',
        },
      },
      { endpoint: 'events_api', scenario: 'ack_escalation_race' }
    );
  }
}
