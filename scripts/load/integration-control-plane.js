import http from 'k6/http';
import { check, sleep } from 'k6';

const baseUrl = (__ENV.BASE_URL || 'http://host.docker.internal:3300').replace(/\/$/, '');
export const options = {
  scenarios: {
    steady: {
      executor: 'constant-arrival-rate',
      rate: Number(__ENV.RATE || 100),
      timeUnit: '1s',
      duration: __ENV.DURATION || '2m',
      preAllocatedVUs: 50,
      maxVUs: 300,
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<500', 'p(99)<1500'],
    checks: ['rate>0.99'],
  },
};
export default function () {
  const response = http.get(`${baseUrl}/api/health?mode=readiness`, {
    tags: { plane: 'integration' },
  });
  check(response, {
    'ready or explicitly degraded': value => value.status === 200 || value.status === 503,
  });
  sleep(0.01);
}
