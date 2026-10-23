import { metrics } from '@opentelemetry/api';
const meter = metrics.getMeter('opsknight.scim', '1.0');
const requests = meter.createCounter('scim.requests', {
  description: 'SCIM responses by method, resource and HTTP status',
});
const latency = meter.createHistogram('scim.request.duration', { unit: 'ms' });
const authFailures = meter.createCounter('scim.authentication.failures');
export function recordRequest(method: string, resource: string, status: number, duration: number) {
  const attributes = { method, resource, status };
  requests.add(1, attributes);
  latency.record(duration, attributes);
}
export function recordAuthFailure(connectorId: string, reason: string) {
  authFailures.add(1, { connectorId, reason });
}
