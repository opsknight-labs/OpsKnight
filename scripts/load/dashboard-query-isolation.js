import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const baseUrl = (__ENV.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const cookie = __ENV.SESSION_COOKIE || '';
const cookies = __ENV.SESSION_COOKIES_JSON ? JSON.parse(__ENV.SESSION_COOKIES_JSON) : [cookie];
if (
  !Array.isArray(cookies) ||
  cookies.length === 0 ||
  cookies.some(value => typeof value !== 'string' || !value)
) {
  throw new Error('Set SESSION_COOKIE or a non-empty SESSION_COOKIES_JSON array.');
}
const analyticsAdmissionFailures = new Rate('dashboard_analytics_admission_failures');

export const options = {
  scenarios: {
    cold_single: { executor: 'shared-iterations', vus: 1, iterations: 1, startTime: '0s' },
    dashboard_10: { executor: 'shared-iterations', vus: 10, iterations: 20, startTime: '10s' },
    dashboard_50: { executor: 'shared-iterations', vus: 50, iterations: 100, startTime: '30s' },
    dashboard_100: { executor: 'shared-iterations', vus: 100, iterations: 200, startTime: '1m' },
  },
  thresholds: {
    'http_req_duration{endpoint:shell}': ['p(95)<2000'],
    'http_req_duration{endpoint:analytics}': ['p(95)<5000'],
    'http_req_duration{endpoint:health}': ['p(95)<1000'],
    http_req_failed: ['rate<0.02'],
    dashboard_analytics_admission_failures: ['rate<0.02'],
  },
};

export default function () {
  const identity = (__VU - 1) % cookies.length;
  const params = {
    headers: { Cookie: cookies[identity], 'x-load-test': 'dashboard-query-isolation' },
    tags: { identity: String(identity) },
  };
  const shell = http.get(`${baseUrl}/`, { ...params, tags: { endpoint: 'shell' } });
  check(shell, { 'dashboard shell responds': response => response.status === 200 });
  const analytics = http.get(`${baseUrl}/api/dashboard/analytics?range=30`, {
    ...params,
    tags: { endpoint: 'analytics' },
  });
  analyticsAdmissionFailures.add(analytics.status === 503);
  check(analytics, { 'analytics responds successfully': response => response.status === 200 });
  const health = http.get(`${baseUrl}/api/health?mode=readiness`, {
    ...params,
    tags: { endpoint: 'health' },
  });
  check(health, { 'health remains responsive': response => response.status === 200 });
  sleep(0.2);
}
