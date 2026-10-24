import http from 'k6/http';
import { Counter, Rate } from 'k6/metrics';
import { check } from 'k6';
import crypto from 'k6/crypto';
import encoding from 'k6/encoding';

const accepted = new Counter('ingestion_durable_accepted');
const rejectedQuota = new Counter('ingestion_quota_rejected');
const rejectedCapacity = new Counter('ingestion_capacity_rejected');
// Fixed counters retain rejection status in the summary without response bodies,
// identities, unbounded labels or extra requests during the measured interval.
const rejectedStatuses = new Map(
  [0, 202, 400, 401, 403, 409, 413, 429, 500, 502, 503, 504].map(status => [
    status,
    new Counter(`ingestion_rejected_http_${status}`),
  ])
);
const rejectedOther = new Counter('ingestion_rejected_http_other');
const success = new Rate('ingestion_acceptance_success');
const rate = Number(__ENV.INGESTION_TARGET_RPS || 1000);
const payloadBytes = Number(__ENV.INGESTION_PAYLOAD_BYTES || 10000);
const payloadPattern = __ENV.INGESTION_PAYLOAD_PATTERN || 'random';
if (!Number.isInteger(payloadBytes) || payloadBytes < 0 || payloadBytes > 900000)
  throw new Error('INGESTION_PAYLOAD_BYTES must be an integer between 0 and 900000');
if (!['random', 'repeated'].includes(payloadPattern))
  throw new Error('INGESTION_PAYLOAD_PATTERN must be random or repeated');
// Construct once per VU, outside timed requests. Random content prevents TOAST
// compression from turning a 10 KB storage workload into a tiny repeated string.
const payloadBody =
  payloadPattern === 'repeated'
    ? 'x'.repeat(payloadBytes)
    : payloadBytes === 0
      ? ''
      : encoding
          .b64encode(crypto.randomBytes(Math.ceil((payloadBytes * 3) / 4)))
          .slice(0, payloadBytes);
export const options = {
  scenarios: {
    ingress: {
      executor: 'constant-arrival-rate',
      rate,
      timeUnit: '1s',
      duration: __ENV.INGESTION_DURATION || '60s',
      preAllocatedVUs: Number(__ENV.INGESTION_VUS || 50),
      maxVUs: Number(__ENV.INGESTION_MAX_VUS || 200),
    },
  },
  thresholds: {
    ingestion_acceptance_success: ['rate>=0.999'],
    http_req_duration: ['p(95)<100'],
    dropped_iterations: ['count==0'],
  },
};

export default function () {
  const id = `${__ENV.INGESTION_RUN_ID}:${__VU}:${__ITER}`;
  const key = __ENV.INGESTION_WORKLOAD === 'hot-key' ? `${__ENV.INGESTION_RUN_ID}:hot-key` : id;
  const response = http.post(
    `${__ENV.INGESTION_BASE_URL}/api/events`,
    JSON.stringify({
      event_action: 'trigger',
      dedup_key: key,
      payload: {
        summary: 'Durable ingestion capacity fixture',
        source: 'k6-ingestion',
        severity: 'critical',
        custom_details: { body: payloadBody },
      },
    }),
    {
      headers: {
        Authorization: `Token token=${__ENV.INGESTION_ROUTING_KEY}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': id,
      },
      timeout: '10s',
      tags: { name: 'durable-ingestion' },
    }
  );
  let receipt = false;
  try {
    const body = response.json();
    receipt =
      typeof body.data.result.receiptId === 'string' && body.data.result.action === 'accepted';
  } catch {
    /* recorded as failed admission */
  }
  const valid = response.status === 202 && receipt;
  success.add(valid);
  if (valid) accepted.add(1);
  if (response.status === 429) rejectedQuota.add(1);
  if (response.status === 503) rejectedCapacity.add(1);
  if (!valid) (rejectedStatuses.get(response.status) || rejectedOther).add(1);
  check(response, { 'durably accepted with receipt': () => valid });
}
