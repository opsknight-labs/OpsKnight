import { describe, expect, it } from 'vitest';
import { transformGrafanaToEvents, type GrafanaAlert } from '@/lib/integrations/grafana';
import { transformWebhookToEvent } from '@/lib/integrations/webhook';

type GrafanaAlertEntry = NonNullable<GrafanaAlert['alerts']>[number];

const alert = (status: string, labels: Record<string, string>): GrafanaAlertEntry => ({
  status,
  labels,
  startsAt: '2026-01-01T00:00:00Z',
});
const keyOf = (a: GrafanaAlertEntry) =>
  transformGrafanaToEvents({ status: a.status, alerts: [a] })[0].dedup_key;

describe('Grafana alerts without a fingerprint', () => {
  const api = { alertname: 'HighCPU', instance: 'db-1', job: 'api' };
  const worker = { alertname: 'HighCPU', instance: 'db-1', job: 'worker' };

  it('keeps series that share alertname and instance apart', () => {
    expect(keyOf(alert('firing', api))).not.toBe(keyOf(alert('firing', worker)));
  });

  it('keeps one key for the same alert across firing and resolved', () => {
    expect(keyOf(alert('firing', api))).toBe(keyOf(alert('resolved', api)));
    expect(keyOf(alert('firing', api))).toBe(
      keyOf(alert('firing', { job: 'api', instance: 'db-1', alertname: 'HighCPU' }))
    );
  });

  it('still reads like the old key and a rule UID label changes the identity', () => {
    expect(keyOf(alert('firing', api))).toMatch(/^grafana-HighCPU-db-1-[0-9a-f]{16}$/);
    expect(keyOf(alert('firing', { ...api, __alert_rule_uid__: 'rule-a' }))).not.toBe(
      keyOf(alert('firing', { ...api, __alert_rule_uid__: 'rule-b' }))
    );
  });

  it('keeps using the fingerprint when Grafana sends one', () => {
    const [event] = transformGrafanaToEvents({
      status: 'firing',
      alerts: [{ ...alert('firing', api), fingerprint: 'fp123' }],
    });
    expect(event.dedup_key).toBe('grafana-fp123');
  });
});

describe('generic webhook without an id or dedup key', () => {
  const cpu = (host: string, status = 'triggered') => ({
    summary: 'High CPU',
    status,
    host,
  });

  it('does not merge the same summary from different hosts', () => {
    expect(transformWebhookToEvent(cpu('web-1')).dedup_key).not.toBe(
      transformWebhookToEvent(cpu('web-2')).dedup_key
    );
  });

  it('keeps one key for a host across trigger and resolve', () => {
    expect(transformWebhookToEvent(cpu('web-1')).dedup_key).toBe(
      transformWebhookToEvent(cpu('web-1', 'resolved')).dedup_key
    );
  });

  it('separates payloads that identify the series with a labels object, in any key order', () => {
    const a = transformWebhookToEvent({ summary: 'Disk full', labels: { mount: '/', node: 'a' } });
    const b = transformWebhookToEvent({ summary: 'Disk full', labels: { node: 'b', mount: '/' } });
    const aReordered = transformWebhookToEvent({
      summary: 'Disk full',
      labels: { node: 'a', mount: '/' },
    });
    expect(a.dedup_key).not.toBe(b.dedup_key);
    expect(a.dedup_key).toBe(aReordered.dedup_key);
  });

  it('keeps the plain summary key when the payload carries no identity', () => {
    expect(transformWebhookToEvent({ summary: 'High CPU' }).dedup_key).toBe('webhook-high-cpu');
  });

  it('still prefers an explicit id or dedup_key', () => {
    expect(transformWebhookToEvent({ summary: 'High CPU', host: 'web-1', id: 'A-1' }).dedup_key).toBe(
      'A-1'
    );
    expect(
      transformWebhookToEvent({ summary: 'High CPU', host: 'web-1', dedup_key: 'mine' }).dedup_key
    ).toBe('mine');
  });
});
