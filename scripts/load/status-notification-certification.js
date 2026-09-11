import http from 'k6/http';
import { check, sleep } from 'k6';
import crypto from 'k6/crypto';
import { Counter, Rate, Trend } from 'k6/metrics';

const baseUrl = (__ENV.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const duration = __ENV.DURATION || '10m';
const publicRps = Number(__ENV.PUBLIC_RPS || 1000);
const internalVus = Number(__ENV.INTERNAL_VUS || 50);
const feedbackRps = Number(__ENV.FEEDBACK_RPS || 0);
const authCookie = __ENV.AUTH_COOKIE || '';
const feedbackSecret = __ENV.NOTIFICATION_PROVIDER_FEEDBACK_SECRET || '';

const publicLatency = new Trend('opsknight_cert_public_status_latency', true);
const internalLatency = new Trend('opsknight_cert_internal_latency', true);
const feedbackLatency = new Trend('opsknight_cert_feedback_latency', true);
const failures = new Rate('opsknight_cert_request_failures');
const acceptedFeedback = new Counter('opsknight_cert_feedback_accepted_total');

const scenarios = {
  public_status: {
    executor: 'constant-arrival-rate',
    rate: publicRps,
    timeUnit: '1s',
    duration,
    preAllocatedVUs: Math.max(100, Math.ceil(publicRps / 5)),
    maxVUs: Math.max(2_000, publicRps * 3),
    exec: 'publicStatus',
  },
  internal_reads: {
    executor: 'constant-vus',
    vus: internalVus,
    duration,
    exec: 'internalRead',
  },
};

// Provider feedback is deliberately opt-in: the generic endpoint rejects unsigned payloads and
// a benchmark must never send a fake signature to a real environment.
if (feedbackRps > 0) {
  if (!feedbackSecret) {
    throw new Error('Set NOTIFICATION_PROVIDER_FEEDBACK_SECRET when FEEDBACK_RPS is greater than zero.');
  }
  scenarios.provider_feedback = {
    executor: 'constant-arrival-rate',
    rate: feedbackRps,
    timeUnit: '1s',
    duration,
    preAllocatedVUs: Math.max(10, Math.ceil(feedbackRps / 5)),
    maxVUs: Math.max(100, feedbackRps * 2),
    exec: 'providerFeedback',
  };
}

export const options = {
  scenarios,
  thresholds: {
    opsknight_cert_request_failures: ['rate<0.01'],
    opsknight_cert_public_status_latency: ['p(95)<250', 'p(99)<1000'],
    opsknight_cert_internal_latency: ['p(95)<750'],
    opsknight_cert_feedback_latency: ['p(95)<1000'],
    checks: ['rate>0.99'],
  },
};

export function publicStatus() {
  const response = http.get(`${baseUrl}/api/status`, { tags: { surface: 'public-status' } });
  publicLatency.add(response.timings.duration);
  const success = check(response, { 'public snapshot serves': value => value.status === 200 });
  failures.add(!success);
}

export function internalRead() {
  const response = http.get(`${baseUrl}/api/incidents`, {
    headers: authCookie ? { Cookie: authCookie } : {},
    tags: { surface: 'internal-read' },
  });
  internalLatency.add(response.timings.duration);
  const success = check(response, { 'internal read serves': value => value.status === 200 });
  failures.add(!success);
  sleep(0.05);
}

export function providerFeedback() {
  const occurredAt = new Date().toISOString();
  const body = JSON.stringify({
    provider: 'certification',
    providerEventId: `k6-${__VU}-${__ITER}-${Date.now()}`,
    providerMessageId: `certification-message-${__VU}-${__ITER}`,
    type: 'DELIVERED',
    occurredAt,
  });
  const signature = crypto.hmac('sha256', feedbackSecret, body, 'hex');
  const response = http.post(`${baseUrl}/api/webhooks/notifications/provider-feedback`, body, {
    headers: { 'Content-Type': 'application/json', 'X-OpsKnight-Signature': `sha256=${signature}` },
    tags: { surface: 'provider-feedback' },
  });
  feedbackLatency.add(response.timings.duration);
  const success = check(response, { 'provider feedback accepted': value => value.status === 202 });
  if (success) acceptedFeedback.add(1);
  failures.add(!success);
}
