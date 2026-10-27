import http from 'k6/http';
import { Counter, Rate } from 'k6/metrics';
import { check, sleep } from 'k6';
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
const eventCount = Number(__ENV.INGESTION_BURST_EVENTS || 1000);
if (![1000, 5000].includes(eventCount)) throw new Error('Burst must contain1000or5000events');
const retryableStatuses = new Set([0, 429, 500, 502, 503, 504]);
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
// Storm profile proves eventual safe retry/reconciliation, not steady-state
// acknowledgment latency. Keep the normal durable-ingestion profile unchanged.
export const options = {
  scenarios: {
    storm: { executor: 'shared-iterations', vus: 100, iterations: eventCount, maxDuration: '5m' },
  },
  thresholds: {
    ingestion_acceptance_success: ['rate==1'],
    ingestion_durable_accepted: [`count==${eventCount}`],
    dropped_iterations: ['count==0'],
  },
};

export default function () {
  const id = `${__ENV.INGESTION_RUN_ID}:${__VU}:${__ITER}`;
  const key = __ENV.INGESTION_WORKLOAD === 'hot-key' ? `${__ENV.INGESTION_RUN_ID}:hot-key` : id;
  for (let attempt = 0; attempt < 12; attempt++) {
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
    let receiptId;
    try {
      const body = response.json();
      receiptId = body.data?.result?.receiptId;
      receipt =
        typeof body.data.result.receiptId === 'string' && body.data.result.action === 'accepted';
    } catch {
      /* recorded as failed admission */
    }
    const valid = response.status === 202 && receipt;

    if (valid) {
      console.log(
        JSON.stringify({
          kind: 'opsknight-ack',
          receiptId,
          deliveryId: id,
          status: response.status,
          observedAt: Date.now(),
          durationMs: Number.isFinite(response.timings.duration) ? response.timings.duration : null,
        })
      );
      accepted.add(1);
    } else {
      console.log(
        JSON.stringify({
          kind: 'opsknight-rejection',
          deliveryId: id,
          status: response.status,
          observedAt: Date.now(),
          durationMs: Number.isFinite(response.timings.duration) ? response.timings.duration : null,
        })
      );
    }
    if (response.status === 429) rejectedQuota.add(1);
    if (response.status === 503) rejectedCapacity.add(1);
    if (!valid) (rejectedStatuses.get(response.status) || rejectedOther).add(1);
    if (valid) {
      success.add(true);
      check(response, { 'event eventually durably accepted': () => true });
      return;
    }
    if (!retryableStatuses.has(response.status) || attempt === 11) break;
    const headerDelay = Number(response.headers['Retry-After']);
    const delay =
      Number.isFinite(headerDelay) && headerDelay > 0
        ? Math.min(30, headerDelay)
        : Math.min(5, 0.1 * 2 ** attempt);
    sleep(delay * (1 + Math.random() * 0.25));
  }
  success.add(false);
  check(null, { 'event eventually durably accepted': () => false });
}
