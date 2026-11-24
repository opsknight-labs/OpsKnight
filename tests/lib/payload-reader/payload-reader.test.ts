import { describe, expect, it } from 'vitest';
import { parseAny } from '@/lib/payload-reader/formats';
import { readPayload } from '@/lib/payload-reader';

describe('format layer', () => {
  it('reads every supported input format', () => {
    expect(parseAny('{"a":1}')).toEqual({ format: 'json', data: { a: 1 } });
    expect(parseAny("{'A':5400,'B':1}")).toEqual({ format: 'literal', data: { A: 5400, B: 1 } });
    expect(parseAny('<alert><host>db-1</host><value>98</value></alert>')).toEqual({
      format: 'xml',
      data: { alert: { host: 'db-1', value: '98' } },
    });
    expect(parseAny('level=error host="db 1" msg=timeout')).toEqual({
      format: 'logfmt',
      data: { level: 'error', host: 'db 1', msg: 'timeout' },
    });
    expect(parseAny('host=db1&state=down&value=3')).toEqual({
      format: 'form',
      data: { host: 'db1', state: 'down', value: '3' },
    });
    expect(parseAny('Host: db-1\nState: CRITICAL\nDetails:\n  disk: 98%')).toEqual({
      format: 'kv',
      data: { Host: 'db-1', State: 'CRITICAL', Details: { disk: '98%' } },
    });
    expect(parseAny('## Disk full\n- host **db-1**').format).toBe('markdown');
    expect(parseAny('the disk is full').format).toBe('text');
  });

  it('keeps free text in "Key: value" payloads', () => {
    expect(
      parseAny(
        'Problem: Disk full\nHost: db-1\nAdditional Info:\nDISK CRITICAL - 98% used\nProblem started at 10:02'
      ).data
    ).toEqual({
      Problem: 'Disk full',
      Host: 'db-1',
      'Additional Info': 'DISK CRITICAL - 98% used\nProblem started at 10:02',
    });
    expect(parseAny('[PROBLEM] db-1 is CRITICAL\nHost: db-1\nState: CRITICAL').data).toEqual({
      Host: 'db-1',
      State: 'CRITICAL',
      text: '[PROBLEM] db-1 is CRITICAL',
    });
  });

  it('expands structure hidden inside string values', () => {
    const { data } = parseAny({ annotations: { values: "{'A':5400}", inner: '{"x":[1,2]}' } });
    expect(data).toEqual({ annotations: { values: { A: 5400 }, inner: { x: [1, 2] } } });
  });

  it('stays bounded on hostile input', () => {
    let deep = '1';
    for (let i = 0; i < 2000; i++) deep = `[${deep}]`;
    expect(() => parseAny(deep)).not.toThrow();
    expect(() => readPayload('x'.repeat(1_000_000))).not.toThrow();
  });
});

describe('generic reader', () => {
  it('classifies an unknown tool by key names and value shapes', () => {
    const view = readPayload({
      alert_title: 'Queue backlog high',
      state: 'triggered',
      severity: 'High',
      details: { host: 'worker-3', environment: 'prod', region: 'eu-west-1' },
      metric: { value: 1820, threshold: 1000 },
      started_at: 1763900000,
      dashboard_url: 'https://grafana.example.com/d/abc',
      runbook: 'https://wiki.example.com/rb/queue',
      evil: 'javascript:alert(1)',
      tags: ['team:payments', 'tier:1'],
      extra: { owner: 'ivy' },
    });
    expect(view.source).toBeNull();
    expect(view).toMatchObject({
      title: 'Queue backlog high',
      status: 'firing',
      severity: 'high',
      measured: { value: '1820', threshold: '1000' },
    });
    expect(view.where).toEqual([
      { label: 'Host', value: 'worker-3' },
      { label: 'Env', value: 'prod' },
      { label: 'Region', value: 'eu-west-1' },
    ]);
    expect(view.links.map(l => l.label)).toEqual(['Dashboard', 'Runbook']);
    expect(view.links.some(l => l.url.startsWith('javascript'))).toBe(false);
    expect(view.tags).toEqual(['team:payments', 'tier:1']);
    expect(view.when[0]).toEqual({
      label: 'Started',
      at: new Date(1763900000 * 1000).toISOString(),
    });
    expect(view.fields).toContainEqual({ label: 'Extra › Owner', value: 'ivy' });
  });

  it('masks credentials before reading', () => {
    const view = readPayload({
      title: 'x',
      api_key: 'sk-live-123',
      nested: { password: 'hunter2' },
    });
    const text = JSON.stringify(view);
    expect(text).not.toContain('sk-live-123');
    expect(text).not.toContain('hunter2');
  });

  it('treats free text as the message', () => {
    expect(readPayload('Disk is 98% full on db-1')).toMatchObject({
      format: 'text',
      message: 'Disk is 98% full on db-1',
    });
  });
});

describe('source readers', () => {
  it('reads a Datadog monitor webhook', () => {
    const view = readPayload({
      id: '7349216650104451208',
      source: 'datadog',
      alert_type: 'error',
      title: '[Triggered] checkout 5xx rate above 5% on POST /v1/checkout',
      alert_transition: 'Triggered',
      monitor: { id: 8841213, name: 'checkout 5xx rate', priority: 'P1' },
      query: 'sum(last_5m):sum:trace.http.request.errors{service:checkout-api}.as_rate() > 0.05',
      value: 0.184,
      threshold: 0.05,
      tags: 'env:prod,service:checkout-api',
      link: 'https://app.datadoghq.com/monitors/8841213',
    });
    expect(view.source?.id).toBe('datadog');
    expect(view).toMatchObject({
      status: 'firing',
      severity: 'p1',
      measured: { value: '0.184', threshold: '0.05' },
      query: { language: 'Datadog' },
      condition: 'checkout 5xx rate',
    });
    expect(view.tags).toEqual(['env:prod', 'service:checkout-api']);
    expect(view.links[0]).toEqual({
      label: 'Open in Datadog',
      url: 'https://app.datadoghq.com/monitors/8841213',
    });
  });

  it('reads an Alertmanager webhook', () => {
    const view = readPayload({
      receiver: 'opsknight',
      status: 'firing',
      alerts: [
        {
          status: 'firing',
          labels: {
            alertname: 'HighLatency',
            severity: 'critical',
            instance: 'api-1:9090',
            team: 'payments',
          },
          annotations: { summary: 'p99 above 2s', runbook_url: 'https://wiki/rb' },
          startsAt: '2026-11-22T15:27:00Z',
          endsAt: '0001-01-01T00:00:00Z',
          generatorURL: 'https://prom.example.com/graph?g0.expr=x',
        },
      ],
      groupLabels: { alertname: 'HighLatency' },
      commonLabels: { alertname: 'HighLatency', severity: 'critical' },
      commonAnnotations: { summary: 'p99 above 2s' },
      externalURL: 'https://am.example.com',
    });
    expect(view.source?.id).toBe('alertmanager');
    expect(view).toMatchObject({ title: 'p99 above 2s', status: 'firing', severity: 'critical' });
    expect(view.links.map(l => l.label)).toEqual(['Open in Prometheus', 'Alertmanager', 'Runbook']);
    expect(view.when).toEqual([{ label: 'Started', at: '2026-11-22T15:27:00.000Z' }]);
  });

  it('keeps a real Alertmanager v4 webhook (with fingerprint) on the Alertmanager reader', () => {
    const view = readPayload({
      version: '4',
      receiver: 'opsknight',
      status: 'resolved',
      groupKey: '{}:{alertname="DiskFull"}',
      alerts: [
        {
          status: 'resolved',
          labels: { alertname: 'DiskFull', instance: 'db-1:9100' },
          annotations: {},
          startsAt: '2026-11-22T10:00:00Z',
          endsAt: '2026-11-22T10:20:00Z',
          fingerprint: '3c9b1f0d',
          generatorURL: 'https://prom.example.com/graph',
        },
      ],
      groupLabels: { alertname: 'DiskFull' },
      commonLabels: { alertname: 'DiskFull' },
      externalURL: 'https://am.example.com',
    });
    expect(view.source?.id).toBe('alertmanager');
    expect(view.status).toBe('resolved');
    expect(view.when.map(t => t.label)).toEqual(['Started', 'Resolved']);
  });

  it('reads RFC 2822 dates as times', () => {
    const view = readPayload({ title: 'x', startTime: 'Fri, 27 Jan 2023 06:02:51 GMT' });
    expect(view.when[0]?.at).toBe('2023-01-27T06:02:51.000Z');
  });

  it('reads a Grafana alert from a ClickHouse datasource, literals included', () => {
    const view = readPayload({
      orgId: 1,
      status: 'firing',
      title: '[FIRING:1] Slow queries',
      alerts: [
        {
          labels: { alertname: 'Slow queries', grafana_folder: 'db' },
          annotations: { description: 'host: db-1\nquery_duration_ms: 5400' },
          values: "{'A':5400,'B':1}",
          dashboardURL: 'https://g.example.com/d/1',
          fingerprint: 'abc',
        },
      ],
    });
    expect(view.source?.id).toBe('grafana');
    expect(view.measured?.value).toBe('A = 5400, B = 1');
    expect(view.links[0]).toEqual({ label: 'Dashboard', url: 'https://g.example.com/d/1' });
  });
});
