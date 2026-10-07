import { check, sleep } from 'k6';
import {
  loadSeedManifest,
  getBaseUrl,
  pickCapacityIntegrationKey,
  postEventApi,
} from './_shared.js';
const manifest = loadSeedManifest();
export const options = {
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(50)', 'p(95)', 'p(99)'],
  scenarios: {
    automation_ingestion: {
      executor: 'constant-arrival-rate',
      rate: Number(__ENV.AUTOMATION_RPS || 20),
      timeUnit: '1s',
      duration: __ENV.AUTOMATION_DURATION || '30s',
      preAllocatedVUs: 20,
      maxVUs: 100,
    },
  },
  thresholds: {
    checks: ['rate==1'],
    http_req_failed: [__ENV.AUTOMATION_RECOVERY_DRILL === 'true' ? 'rate<0.25' : 'rate<0.01'],
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
  let response = postEventApi(
    getBaseUrl(),
    pickCapacityIntegrationKey(manifest, __VU, __ITER),
    event,
    { profile: __ENV.AUTOMATION_LOAD_PROFILE || 'disabled' }
  );
  for (
    let retry = 0;
    retry < 8 && (response.status === 0 || response.status === 429 || response.status >= 500);
    retry++
  ) {
    sleep(Math.min(0.2 * (retry + 1), 1));
    response = postEventApi(
      getBaseUrl(),
      pickCapacityIntegrationKey(manifest, __VU, __ITER),
      event,
      { profile: __ENV.AUTOMATION_LOAD_PROFILE || 'disabled' }
    );
  }
  check(response, {
    'accepted automation event': result => result.status === 202 || result.status === 200,
  });
}
