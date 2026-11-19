import { describe, expect, it } from 'vitest';
import { normalizeEventAction } from '@/lib/integrations/normalization';
import { transformDynatraceToEvent } from '@/lib/integrations/dynatrace';
import { transformAppDynamicsToEvent } from '@/lib/integrations/appdynamics';
import { transformSplunkObservabilityToEvent } from '@/lib/integrations/splunk-observability';
import { transformElasticToEvent } from '@/lib/integrations/elastic';
import { transformHoneycombToEvent } from '@/lib/integrations/honeycomb';
import { transformSentryToEvent } from '@/lib/integrations/sentry';
import { transformNewRelicToEvent, type NewRelicEvent } from '@/lib/integrations/newrelic';
import {
  AzureAlertSchema,
  GoogleCloudMonitoringSchema,
  NewRelicEventSchema,
  SentryEventSchema,
  validatePayload,
} from '@/lib/integrations/schemas';
import { transformGrafanaToEvents } from '@/lib/integrations/grafana';
import { transformDatadogToEvent } from '@/lib/integrations/datadog';
import { transformCloudWatchToEvent } from '@/lib/integrations/cloudwatch';
import { ingestionDeliveryKey } from '@/lib/ingestion/admission';
import { isIntegrationAuthorized } from '@/lib/integrations/auth';
import { encrypt } from '@/lib/encryption';
import { NextRequest } from 'next/server';

function parseSentry(body: unknown) {
  const result = validatePayload(SentryEventSchema, body);
  expect(result.success).toBe(true);
  if (!result.success) throw new Error('invalid');
  return transformSentryToEvent(result.data);
}

function parseNewRelic(body: unknown) {
  const result = validatePayload(NewRelicEventSchema, body);
  expect(result.success).toBe(true);
  if (!result.success) throw new Error('invalid');
  return transformNewRelicToEvent(result.data as NewRelicEvent);
}

describe('normalizeEventAction negation', () => {
  it('does not resolve or acknowledge negated statuses', () => {
    expect(normalizeEventAction('unresolved')).toBe('trigger');
    expect(normalizeEventAction('Not Recovered')).toBe('trigger');
    expect(normalizeEventAction('unacknowledged')).toBe('trigger');
    expect(normalizeEventAction('Recovered')).toBe('resolve');
    expect(normalizeEventAction('incident.resolved')).toBe('resolve');
  });
});

describe('gen-2 provider lifecycle', () => {
  it('Dynatrace maps ProblemSeverity and resolves MERGED problems', () => {
    expect(
      transformDynatraceToEvent({ ProblemID: '1', State: 'OPEN', ProblemSeverity: 'AVAILABILITY' })
        .payload.severity
    ).toBe('critical');
    expect(transformDynatraceToEvent({ ProblemID: '1', State: 'MERGED' }).event_action).toBe(
      'resolve'
    );
  });

  it('AppDynamics POLICY_CANCELED resolves', () => {
    expect(
      transformAppDynamicsToEvent({ incidentId: 7, eventType: 'POLICY_CANCELED_CRITICAL' })
        .event_action
    ).toBe('resolve');
  });

  it('Splunk stopped resolves and Major/Minor map to error/warning', () => {
    expect(
      transformSplunkObservabilityToEvent({ incidentId: 'a', status: 'stopped' }).event_action
    ).toBe('resolve');
    expect(
      transformSplunkObservabilityToEvent({ incidentId: 'a', severity: 'Major' }).payload.severity
    ).toBe('error');
    expect(
      transformSplunkObservabilityToEvent({ incidentId: 'a', severity: 'Minor' }).payload.severity
    ).toBe('warning');
  });

  it('Elastic dedup key is scoped to the rule', () => {
    const cpu = transformElasticToEvent({ rule: { id: 'cpu' }, alert: { id: 'host-1' } });
    const disk = transformElasticToEvent({ rule: { id: 'disk' }, alert: { id: 'host-1' } });
    expect(cpu.dedup_key).not.toBe(disk.dedup_key);
  });

  it('Honeycomb default payload keys by trigger id and name', () => {
    const a = transformHoneycombToEvent({ id: 'trig-a', name: 'Latency', status: 'TRIGGERED' });
    const b = transformHoneycombToEvent({ id: 'trig-b', name: 'Errors', status: 'TRIGGERED' });
    expect(a.dedup_key).toBe('trig-a');
    expect(a.payload.summary).toBe('Latency');
    expect(b.dedup_key).not.toBe(a.dedup_key);
    expect(transformHoneycombToEvent({ id: 'trig-a', status: 'OK' }).event_action).toBe('resolve');
  });
});

describe('Sentry payload shapes', () => {
  it('handles integration-platform issue payloads', () => {
    const event = parseSentry({
      action: 'created',
      data: { issue: { id: '42', title: 'TypeError', level: 'error', status: 'unresolved' } },
    });
    expect(event).toMatchObject({ event_action: 'trigger', dedup_key: 'sentry-42' });
    expect(parseSentry({ action: 'resolved', data: { issue: { id: '42' } } }).event_action).toBe(
      'resolve'
    );
  });

  it('handles metric alerts', () => {
    const event = parseSentry({
      action: 'critical',
      data: { metric_alert: { id: '9' }, description_title: 'High error rate' },
    });
    expect(event).toMatchObject({
      event_action: 'trigger',
      dedup_key: 'sentry-metric-9',
      payload: { severity: 'critical', summary: 'High error rate' },
    });
    expect(
      parseSentry({ action: 'resolved', data: { metric_alert: { id: '9' } } }).event_action
    ).toBe('resolve');
  });

  it('groups issue-alert events by issue id', () => {
    const one = parseSentry({
      action: 'triggered',
      data: { event: { event_id: 'e1', issue_id: '5' } },
    });
    const two = parseSentry({ event: { event_id: 'e2', issue_id: '5', message: 'boom' } });
    expect(one.dedup_key).toBe('sentry-5');
    expect(two.dedup_key).toBe('sentry-5');
  });

  it('accepts the legacy plugin payload', () => {
    const event = parseSentry({
      id: '123',
      project: 'backend',
      message: 'boom',
      level: 'error',
      event: { event_id: 'e1', tags: [['env', 'prod']] },
    });
    expect(event).toMatchObject({ event_action: 'trigger', dedup_key: 'sentry-123' });
    expect(event.payload.source).toBe('Sentry - backend');
  });

  it('issue without title still has a summary; unassigned does not acknowledge; ignored resolves', () => {
    expect(parseSentry({ issue: { id: '1' } }).payload.summary).toBeTruthy();
    expect(parseSentry({ action: 'unassigned', issue: { id: '1' } }).event_action).toBe('trigger');
    expect(parseSentry({ action: 'ignored', issue: { id: '1' } }).event_action).toBe('resolve');
  });

  it('tolerates non-string fields inside the unvalidated data wrapper', () => {
    const fromEvent = parseSentry({
      action: 'triggered',
      data: { event: { issue_id: 7, title: { x: 1 }, level: 3 } },
    });
    expect(fromEvent).toMatchObject({ dedup_key: 'sentry-7', payload: { summary: 'Sentry Error' } });
    expect(parseSentry({ data: { issue: { id: '2', level: 5 } } }).payload.severity).toBe('error');
  });
});

describe('New Relic payload shapes', () => {
  it('handles Workflow payloads', () => {
    const body = { issueId: 'abc', state: 'ACTIVATED', title: 'CPU high', priority: 'CRITICAL' };
    expect(parseNewRelic(body)).toMatchObject({
      event_action: 'trigger',
      dedup_key: 'newrelic-abc',
      payload: { summary: 'CPU high', severity: 'critical' },
    });
    expect(parseNewRelic({ ...body, state: 'CLOSED' }).event_action).toBe('resolve');
    expect(parseNewRelic({ ...body, state: 'ACKNOWLEDGED' }).event_action).toBe('acknowledge');
  });

  it('handles legacy channel payloads', () => {
    const event = parseNewRelic({
      incident_id: 77,
      current_state: 'closed',
      condition_name: 'Errors',
      severity: 'CRITICAL',
    });
    expect(event).toMatchObject({ event_action: 'resolve', dedup_key: 'newrelic-77' });
  });
});

describe('gen-1 provider parsing', () => {
  it('Grafana unified payload uses per-alert keys even with top-level state', () => {
    const base = { title: '[FIRING:2] KubePodCrashLooping', state: 'alerting' as const };
    const alert = (status: string, pod: string) => ({
      status,
      labels: { alertname: 'KubePodCrashLooping', pod },
      startsAt: '2026-01-01T00:00:00Z',
      fingerprint: `fp-${pod}`,
    });
    const firing = transformGrafanaToEvents({
      ...base,
      status: 'firing',
      alerts: [alert('firing', 'a'), alert('firing', 'b')],
    });
    expect(firing.map(e => e.dedup_key)).toEqual(['grafana-fp-a', 'grafana-fp-b']);
    const resolved = transformGrafanaToEvents({
      title: '[RESOLVED] KubePodCrashLooping',
      state: 'ok',
      status: 'resolved',
      alerts: [alert('resolved', 'a')],
    });
    expect(resolved[0]).toMatchObject({ event_action: 'resolve', dedup_key: 'grafana-fp-a' });
  });

  it('Datadog $ALERT_TRANSITION Recovered and multi-alert titles resolve the same key', () => {
    const [trigger] = transformDatadogToEvent({ title: '[Triggered on {host:x}] CPU high' });
    const [recover] = transformDatadogToEvent({
      title: '[Recovered on {host:x}] CPU high',
      alert: { status: 'Recovered' },
    });
    const [otherHost] = transformDatadogToEvent({ title: '[Triggered on {host:y}] CPU high' });
    expect(recover.event_action).toBe('resolve');
    expect(recover.dedup_key).toBe(trigger.dedup_key);
    expect(otherHost.dedup_key).not.toBe(trigger.dedup_key);
  });

  it('CloudWatch severity matches whole words only', () => {
    const event = transformCloudWatchToEvent({
      AlarmName: 'api',
      AlarmDescription: 'API responses are slow',
      NewStateValue: 'ALARM',
      StateChangeTime: '2026-01-01T00:00:00Z',
    });
    expect(event.payload.severity).toBe('critical');
  });

  it('GCM and Azure reject empty payloads instead of opening a catch-all incident', () => {
    expect(validatePayload(GoogleCloudMonitoringSchema, {}).success).toBe(false);
    expect(
      validatePayload(GoogleCloudMonitoringSchema, { incident: { incident_id: '1' } }).success
    ).toBe(true);
    expect(validatePayload(AzureAlertSchema, {}).success).toBe(false);
    expect(
      validatePayload(AzureAlertSchema, { data: { essentials: { alertId: '/a/1' } } }).success
    ).toBe(true);
  });

  it('SNS retries share a delivery key', () => {
    const headers = new Headers({ 'x-amz-sns-message-id': 'msg-1' });
    expect(ingestionDeliveryKey(headers, 'CLOUDWATCH')).toBe('msg-1');
  });
});

describe('integration key extraction', () => {
  it('accepts the query key when Authorization carries a provider token', async () => {
    const stored = await encrypt('routing-key');
    const req = new NextRequest(
      'https://example.test/api/integrations/google-cloud-monitoring?integrationKey=routing-key',
      { headers: { authorization: 'Bearer eyJhbGciOiJSUzI1NiJ9.jwt.sig' } }
    );
    expect(await isIntegrationAuthorized(req, stored)).toBe(true);
    const wrong = new NextRequest('https://example.test/api?integrationKey=nope', {
      headers: { authorization: 'Bearer also-wrong' },
    });
    expect(await isIntegrationAuthorized(wrong, stored)).toBe(false);
  });
});
