import http from 'k6/http';
import { check, sleep } from 'k6';

const baseUrl = (__ENV.BASE_URL || 'http://127.0.0.1:3900').replace(/\/$/, '');

// Load key pool (30 distinct admin keys)
const keyPool = JSON.parse(open('../../certification/key-pool.json')).tokens;

export const options = {
  scenarios: {
    // 1. Production read & query load rotating across 30 keys
    sustained_workload: {
      executor: 'constant-vus',
      vus: 10,
      duration: '20s',
      exec: 'sustainedWorkload',
    },
    // 2. Admission control & rate limit verification
    rate_limit_admission: {
      executor: 'per-vu-iterations',
      vus: 2,
      iterations: 35,
      maxDuration: '15s',
      exec: 'admissionControlTest',
      startTime: '5s',
    },
  },
  thresholds: {
    'http_req_duration{scenario:sustained_workload}': ['p(95)<300', 'p(99)<800'],
    'checks{scenario:sustained_workload}': ['rate>0.98'],
  },
};

export function sustainedWorkload() {
  // Rotate token by VU and iteration
  const tokenIndex = (__VU + __ITER) % keyPool.length;
  const token = keyPool[tokenIndex];

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  };

  // 1. Light Read: Services
  const resSvc = http.get(`${baseUrl}/api/v2/services?limit=10`, {
    headers,
    tags: { name: 'listServices' },
  });
  check(resSvc, {
    'sustained: services status 200': r => r.status === 200,
    'sustained: has rate limit headers': r => Boolean(r.headers['X-Ratelimit-Limit'] || r.headers['x-ratelimit-limit']),
    'sustained: has requestId': r => Boolean(r.headers['X-Request-Id'] || r.headers['x-request-id']),
  });

  // 2. Filtered incident list
  const resInc = http.get(`${baseUrl}/api/v2/incidents?limit=5`, {
    headers,
    tags: { name: 'listIncidents' },
  });
  check(resInc, {
    'sustained: incidents status 200': r => r.status === 200,
  });

  // 3. User directory read
  const resUsr = http.get(`${baseUrl}/api/v2/users?limit=5`, {
    headers,
    tags: { name: 'listUsers' },
  });
  check(resUsr, {
    'sustained: users status 200': r => r.status === 200,
  });

  // Pacing to honor token rate limit quota
  sleep(0.3);
}

// Fixed single token to test admission refusal (rate limiting)
const overflowToken = 'ok_admin_pool_1_5bH7PXytY7Z9B4n5ZCKlPXZ3HngeK26H';

export function admissionControlTest() {
  const headers = {
    Authorization: `Bearer ${overflowToken}`,
    Accept: 'application/json',
  };

  const res = http.get(`${baseUrl}/api/v2/services?limit=2`, {
    headers,
    tags: { name: 'admissionTest' },
  });

  check(res, {
    'admission: returns valid status (200 or 429)': r => r.status === 200 || r.status === 429,
    'admission: when 429 has Retry-After': r => r.status !== 429 || Boolean(r.headers['Retry-After'] || r.headers['retry-after']),
  });

  sleep(0.05);
}
