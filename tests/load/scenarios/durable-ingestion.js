import http from 'k6/http';
import { Counter, Rate } from 'k6/metrics';
import { check } from 'k6';

const accepted = new Counter('ingestion_durable_accepted');
const rejectedQuota = new Counter('ingestion_quota_rejected');
const rejectedCapacity = new Counter('ingestion_capacity_rejected');
const success = new Rate('ingestion_acceptance_success');
const rate = Number(__ENV.INGESTION_TARGET_RPS || 1000);
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
        custom_details: { body: 'x'.repeat(Number(__ENV.INGESTION_PAYLOAD_BYTES || 10000)) },
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
  check(response, { 'durably accepted with receipt': () => valid });
}
