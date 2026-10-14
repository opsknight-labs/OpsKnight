// REST v2 load matrix. Run against a certified topology (see ../README-api-v2.md).
//
//   K6_BASE=http://127.0.0.1:3300 API_TOKEN=ok_... API_TEAM_ID=... k6 run api-v2-load-matrix.js
//
// Scenarios (select with K6_SCENARIO=<name>, default all):
//   valid_reads      authenticated GET traffic and cursor pagination
//   invalid_flood    invalid-token flood from one address, valid traffic from another must stay healthy
//   unknown_ip       invalid-token flood with no address headers (direct deployment), bounded not locked out
//   idempotent_writes the same Idempotency-Key sent concurrently: exactly one resource may be created
//   mixed_mutations  concurrent creates and ETag-conditional updates
//
// Pass/fail is expressed as k6 thresholds so the run can gate a release.
import http from 'k6/http';
import { check } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import { uuidv4 } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

const BASE = __ENV.K6_BASE || 'http://127.0.0.1:3300';
const TOKEN = __ENV.API_TOKEN;
const FLOOD_IP = '203.0.113.50';
const CLIENT_IP = '198.51.100.20';

const serverErrors = new Rate('server_errors');
const validClientRejected = new Rate('valid_client_rejected');
const duplicateCreates = new Counter('duplicate_creates');
const unexpectedStatus = new Counter('unexpected_status');
const readLatency = new Trend('read_latency_ms', true);

const all = {
  valid_reads: { executor: 'constant-arrival-rate', rate: 100, timeUnit: '1s', duration: '60s', preAllocatedVUs: 50, maxVUs: 200, exec: 'validReads' },
  invalid_flood: { executor: 'constant-arrival-rate', rate: 300, timeUnit: '1s', duration: '60s', preAllocatedVUs: 50, maxVUs: 200, exec: 'invalidFlood' },
  unknown_ip: { executor: 'constant-arrival-rate', rate: 200, timeUnit: '1s', duration: '60s', preAllocatedVUs: 50, maxVUs: 200, exec: 'unknownIp' },
  idempotent_writes: { executor: 'per-vu-iterations', vus: 20, iterations: 5, exec: 'idempotentWrites' },
  mixed_mutations: { executor: 'constant-arrival-rate', rate: 20, timeUnit: '1s', duration: '60s', preAllocatedVUs: 20, maxVUs: 60, exec: 'mixedMutations' },
};
const selected = __ENV.K6_SCENARIO;

export const options = {
  scenarios: selected ? { [selected]: all[selected] } : all,
  thresholds: {
    // An overloaded or attacked API must shed load with 4xx, never fail.
    server_errors: ['rate<0.001'],
    // Valid clients must stay usable while another address floods invalid tokens.
    valid_client_rejected: ['rate<0.01'],
    read_latency_ms: ['p(95)<400', 'p(99)<1000'],
    duplicate_creates: ['count==0'],
    unexpected_status: ['count==0'],
  },
};

const auth = { Authorization: `Bearer ${TOKEN}` };

export function setup() {
  if (!TOKEN) throw new Error('API_TOKEN (a key with read and write scopes) is required');
}

export function validReads() {
  const res = http.get(`${BASE}/api/v2/incidents?limit=20`, {
    headers: { ...auth, 'X-Forwarded-For': CLIENT_IP },
  });
  readLatency.add(res.timings.duration);
  serverErrors.add(res.status >= 500);
  validClientRejected.add(res.status === 401 || res.status === 403);
  // 429 is a legitimate answer to exceeding the per-credential limit; anything else non-2xx is not.
  if (!check(res, { 'read ok or limited': r => r.status === 200 || r.status === 429 })) unexpectedStatus.add(1);

  const page = res.status === 200 ? res.json('pagination.nextCursor') : null;
  if (page) {
    const next = http.get(`${BASE}/api/v2/incidents?limit=20&cursor=${page}`, {
      headers: { ...auth, 'X-Forwarded-For': CLIENT_IP },
    });
    serverErrors.add(next.status >= 500);
  }
}

export function invalidFlood() {
  const bad = http.get(`${BASE}/api/v2/incidents`, {
    headers: { Authorization: `Bearer ok_live_${uuidv4().replace(/-/g, '')}xxxxxxxxxxxx`, 'X-Forwarded-For': FLOOD_IP },
  });
  serverErrors.add(bad.status >= 500);
  if (!check(bad, { 'flood answered 401 or 429': r => r.status === 401 || r.status === 429 })) unexpectedStatus.add(1);

  // A different, legitimate address must be unaffected by the flood above.
  const good = http.get(`${BASE}/api/v2/services?limit=1`, { headers: { ...auth, 'X-Forwarded-For': CLIENT_IP } });
  validClientRejected.add(good.status === 401 || good.status === 403);
  serverErrors.add(good.status >= 500);
}

export function unknownIp() {
  // No forwarding headers: on a direct deployment every caller shares one bucket.
  const bad = http.get(`${BASE}/api/v2/incidents`, {
    headers: { Authorization: `Bearer ok_live_${uuidv4().replace(/-/g, '')}xxxxxxxxxxxx` },
  });
  serverErrors.add(bad.status >= 500);
  check(bad, { 'unknown-ip flood is 401 or bounded 429': r => r.status === 401 || r.status === 429 });

  const good = http.get(`${BASE}/api/v2/services?limit=1`, { headers: auth });
  // A bounded verification lane may answer 429 with Retry-After; a lockout (401/403) is the failure.
  validClientRejected.add(good.status === 401 || good.status === 403);
  serverErrors.add(good.status >= 500);
}

export function idempotentWrites() {
  const key = `k6-${__ENV.K6_RUN_ID || 'run'}-${__VU}-${__ITER}`;
  const name = `k6-idem-${key}`;
  const request = () => ({
    method: 'POST',
    url: `${BASE}/api/v2/teams`,
    body: JSON.stringify({ name }),
    params: { headers: { ...auth, 'Content-Type': 'application/json', 'Idempotency-Key': key } },
  });
  // Same key, same body, sent at the same time: at most one team may be created.
  const responses = http.batch([request(), request(), request(), request()]);
  const ids = new Set();
  for (const res of responses) {
    serverErrors.add(res.status >= 500);
    if (res.status === 201) ids.add(res.json('data.id'));
    else if (res.status !== 409 && res.status !== 429) unexpectedStatus.add(1);
  }
  if (ids.size > 1) duplicateCreates.add(ids.size - 1);
}

export function mixedMutations() {
  const created = http.post(`${BASE}/api/v2/teams`, JSON.stringify({ name: `k6-mix-${uuidv4()}` }), {
    headers: { ...auth, 'Content-Type': 'application/json', 'Idempotency-Key': uuidv4() },
  });
  serverErrors.add(created.status >= 500);
  if (created.status !== 201) return;
  const id = created.json('data.id');
  const read = http.get(`${BASE}/api/v2/teams/${id}`, { headers: auth });
  const etag = read.headers.Etag;
  const patch = (description) =>
    http.patch(`${BASE}/api/v2/teams/${id}`, JSON.stringify({ description }), {
      headers: { ...auth, 'Content-Type': 'application/json', 'If-Match': etag },
    });
  const [a, b] = http.batch([
    ['PATCH', `${BASE}/api/v2/teams/${id}`, JSON.stringify({ description: 'a' }), { headers: { ...auth, 'Content-Type': 'application/json', 'If-Match': etag } }],
    ['PATCH', `${BASE}/api/v2/teams/${id}`, JSON.stringify({ description: 'b' }), { headers: { ...auth, 'Content-Type': 'application/json', 'If-Match': etag } }],
  ]);
  serverErrors.add(a.status >= 500 || b.status >= 500);
  // Both writers carry the same ETag: one wins, the other must be refused with 412.
  const statuses = [a.status, b.status].sort();
  if (!(statuses[0] === 200 && statuses[1] === 412) && !statuses.includes(429)) unexpectedStatus.add(1);
  void patch;
  http.del(`${BASE}/api/v2/teams/${id}`, null, { headers: auth });
}
