import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import execution from 'k6/execution';
import { runInteractiveUserSession } from './user-workload.js';
import { runResponderLifecycle } from './incident-lifecycle.js';
export { runInteractiveUserSession, runResponderLifecycle };
const acceptedEvents = new Counter('automation_accepted_events');
const ingestionLatency = new Trend('automation_ingestion_latency_ms');
import { loadSeedManifest, getBaseUrl, postEventApi } from './_shared.js';
const manifest = loadSeedManifest();
export const options = {
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(50)', 'p(95)', 'p(99)'],
  scenarios: {
    interactive_users: {
      executor: 'constant-vus',
      vus: 2,
      duration: __ENV.AUTOMATION_DURATION || '30s',
      exec: 'runInteractiveUserSession',
    },
    responder_lifecycle: {
      executor: 'constant-vus',
      vus: 2,
      duration: __ENV.AUTOMATION_DURATION || '30s',
      exec: 'runResponderLifecycle',
    },
    automation_ingestion: {
      executor: 'constant-arrival-rate',
      rate: Number(__ENV.AUTOMATION_RPS || 20),
      timeUnit: '1s',
      duration: __ENV.AUTOMATION_DURATION || '30s',
      // Allocate the existing maximum up front so cold VU initialization cannot
      // drop arrivals during sustained certification. The offered rate is unchanged.
      preAllocatedVUs: 100,
      maxVUs: 100,
    },
  },
  thresholds: {
    'checks{scenario:automation_ingestion}': ['rate==1'],
    opsknight_user_workload_success_rate: ['rate>0.95'],
    opsknight_lifecycle_success_rate: ['rate>0.90'],
    http_req_failed: [
      __ENV.AUTOMATION_RECOVERY_DRILL === 'true' && __ENV.AUTOMATION_LOAD_PROFILE === 'live-small'
        ? 'rate<0.25'
        : 'rate<0.01',
    ],
    dropped_iterations: ['count==0'],
  },
};
export default function () {
  const event = {
    event_action: 'trigger',
    dedup_key: `automation-${__ENV.AUTOMATION_RUN_ID || 'run'}-${__ENV.AUTOMATION_LOAD_PROFILE}-${__VU}-${__ITER}`,
    payload: {
      summary: 'Automation capacity certification',
      source: 'load-certification',
      severity: 'error',
      custom_details: { value: 1, environment: 'production' },
    },
  };
  const keys = manifest.capacityIntegrationKeys;
  const integrationKey = keys[execution.scenario.iterationInTest % keys.length];
  let response = postEventApi(getBaseUrl(), integrationKey, event, {
    profile: __ENV.AUTOMATION_LOAD_PROFILE || 'disabled',
  });
  for (
    let retry = 0;
    retry < 8 && (response.status === 0 || response.status === 429 || response.status >= 500);
    retry++
  ) {
    sleep(Math.min(0.2 * (retry + 1), 1));
    response = postEventApi(getBaseUrl(), integrationKey, event, {
      profile: __ENV.AUTOMATION_LOAD_PROFILE || 'disabled',
    });
  }
  ingestionLatency.add(response.timings.duration);
  if (response.status === 202 || response.status === 200) acceptedEvents.add(1);
  check(response, {
    'accepted automation event': result => result.status === 202 || result.status === 200,
  });
}
