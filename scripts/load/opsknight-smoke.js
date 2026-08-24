import http from 'k6/http';
import { check, sleep } from 'k6';

const baseUrl = (__ENV.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');

export const options = {
  scenarios: {
    readiness: {
      executor: 'constant-vus',
      vus: Number(__ENV.VUS || 20),
      duration: __ENV.DURATION || '2m',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<750', 'p(99)<1500'],
    checks: ['rate>0.99'],
  },
};

export default function () {
  const response = http.get(`${baseUrl}/api/health?mode=readiness`, {
    headers: { 'x-load-test': 'enterprise-readiness' },
    tags: { endpoint: 'readiness' },
  });
  check(response, {
    'readiness returns 200': result => result.status === 200,
    'request id is present': result => Boolean(result.headers['X-Request-Id']),
  });
  sleep(0.2);
}
