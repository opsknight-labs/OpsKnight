// @vitest-environment node
/* eslint-disable security/detect-object-injection -- every key below comes from the closed kind union */
import { describe, expect, it } from 'vitest';
import {
  CONNECTOR_ADAPTERS,
  parseChangeUrl,
  webHostOf,
} from '@/lib/intelligence/connectors/adapters';
import type {
  AdapterContext,
  ResolvedConnection,
} from '@/lib/intelligence/connectors/adapters/types';
import { signAwsRequest } from '@/lib/intelligence/connectors/adapters/cloudwatch';
import { otlpSpans } from '@/lib/intelligence/connectors/adapters/grafana-stack';
import {
  OBSERVABILITY_KINDS,
  observabilityConnectionInputSchema,
  type ObservabilityKind,
} from '@/lib/intelligence/connectors/contract';
import {
  ConnectorError,
  connectorFetchFor,
  type ConnectorFetch,
} from '@/lib/intelligence/connectors/http';
import {
  LIMITS,
  countPatchLines,
  summarizeDiff,
  summarizeLogs,
  summarizeSeries,
  summarizeTraces,
} from '@/lib/intelligence/connectors/normalize';

const window = { start: new Date('2026-11-01T10:00:00Z'), end: new Date('2026-11-01T11:00:00Z') };

const BASE: Record<ObservabilityKind, string> = {
  PROMETHEUS: 'https://prom.example.com',
  LOKI: 'https://loki.example.com',
  TEMPO: 'https://tempo.example.com',
  GRAFANA: 'https://grafana.example.com',
  DATADOG: 'https://api.datadoghq.com',
  ELASTIC: 'https://es.example.com',
  CLOUDWATCH: 'https://monitoring.eu-west-1.amazonaws.com',
  SENTRY: 'https://sentry.io',
  GITHUB: 'https://api.github.com',
  GITLAB: 'https://gitlab.com',
};

function connection(
  kind: ObservabilityKind,
  overrides: Partial<ResolvedConnection> = {}
): ResolvedConnection {
  return {
    id: `c-${kind}`,
    name: kind,
    kind,
    baseUrl: BASE[kind],
    region: kind === 'CLOUDWATCH' ? 'eu-west-1' : null,
    org: kind === 'SENTRY' ? 'acme' : kind === 'GRAFANA' ? '2' : null,
    project: kind === 'GRAFANA' ? 'prom-uid' : kind === 'CLOUDWATCH' ? '/aws/lambda/api' : null,
    allowPrivateNetwork: false,
    timeoutMs: 1_000,
    credential:
      kind === 'CLOUDWATCH'
        ? { secret: 'secretsecretsecretsecret', secondary: 'AKIAABCDEFGHIJKLMNOP' }
        : kind === 'DATADOG'
          ? { secret: 'dd-api', secondary: 'dd-app' }
          : { secret: 'tok-123' },
    ...overrides,
  };
}

interface Call {
  url: URL;
  init: RequestInit;
}

function fakeFetch(respond: (call: Call) => Response | Promise<Response>): {
  fetch: ConnectorFetch;
  calls: Call[];
} {
  const calls: Call[] = [];
  return {
    calls,
    fetch: async (input, init = {}) => {
      const call = { url: new URL(input), init };
      calls.push(call);
      return respond(call);
    },
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const context = (
  kind: ObservabilityKind,
  fetch: ConnectorFetch,
  overrides = {}
): AdapterContext => ({
  connection: connection(kind, overrides),
  fetch,
});

const headerOf = (call: Call, name: string) =>
  new Headers(call.init.headers as Record<string, string>).get(name);

describe('connector adapters: success paths, one per kind and capability', () => {
  it('Prometheus: range query with an automatic step, summarised per series', async () => {
    const { fetch, calls } = fakeFetch(() =>
      json({
        status: 'success',
        data: {
          resultType: 'matrix',
          result: [
            {
              metric: { __name__: 'http_errors', job: 'api' },
              values: [
                [1762000000, '1'],
                [1762000060, '2'],
                [1762000120, '40'],
                [1762000180, '41'],
              ],
            },
          ],
        },
      })
    );
    const summary = await CONNECTOR_ADAPTERS.PROMETHEUS.metrics!(context('PROMETHEUS', fetch), {
      query: 'rate(http_errors[5m])',
      window,
    });
    expect(calls[0].url.pathname).toBe('/api/v1/query_range');
    expect(calls[0].url.searchParams.get('step')).toBe('30');
    expect(calls[0].init.method).toBe('GET');
    expect(headerOf(calls[0], 'authorization')).toBe('Bearer tok-123');
    expect(summary.series[0]).toMatchObject({
      labels: { __name__: 'http_errors', job: 'api' },
      points: 4,
      min: 1,
      max: 41,
      last: 41,
      biggestChange: { delta: 38 },
    });
  });

  it('Loki: backward range query, newest lines first with nanosecond timestamps converted', async () => {
    const { fetch, calls } = fakeFetch(() =>
      json({
        data: {
          resultType: 'streams',
          result: [
            {
              stream: { app: 'api', level: 'error' },
              values: [
                ['1762000000000000000', 'older'],
                ['1762000060000000000', 'newer'],
              ],
            },
          ],
        },
      })
    );
    const summary = await CONNECTOR_ADAPTERS.LOKI.logs!(context('LOKI', fetch), {
      query: '{app="api"} |= "error"',
      window,
      limit: 30,
    });
    expect(calls[0].url.pathname).toBe('/loki/api/v1/query_range');
    expect(calls[0].url.searchParams.get('direction')).toBe('backward');
    expect(calls[0].url.searchParams.get('start')).toBe(`${window.start.getTime()}000000`);
    expect(summary.lines.map(line => line.text)).toEqual(['newer', 'older']);
    expect(summary.lines[0].at).toBe(new Date(1762000060000).toISOString());
  });

  it('Tempo: one trace by id becomes a span tree with errors marked', async () => {
    const { fetch, calls } = fakeFetch(() =>
      json({
        batches: [
          {
            resource: { attributes: [{ key: 'service.name', value: { stringValue: 'api' } }] },
            scopeSpans: [
              {
                spans: [
                  {
                    spanId: 'a',
                    name: 'GET /checkout',
                    startTimeUnixNano: '1762000000000000000',
                    endTimeUnixNano: '1762000000500000000',
                  },
                  {
                    spanId: 'b',
                    parentSpanId: 'a',
                    name: 'SELECT orders',
                    startTimeUnixNano: '1762000000100000000',
                    endTimeUnixNano: '1762000000450000000',
                    status: { code: 2 },
                  },
                ],
              },
            ],
          },
        ],
      })
    );
    const summary = await CONNECTOR_ADAPTERS.TEMPO.traces!(context('TEMPO', fetch), {
      traceId: 'abcdef0123456789',
      window,
    });
    expect(calls[0].url.pathname).toBe('/api/traces/abcdef0123456789');
    expect(summary.traces[0]).toMatchObject({
      traceId: 'abcdef0123456789',
      rootService: 'api',
      rootName: 'GET /checkout',
      durationMs: 500,
      spanCount: 2,
      errorCount: 1,
    });
    expect(summary.traces[0].spans.map(span => span.depth)).toEqual([0, 1]);
  });

  it('Tempo: rejects a malformed trace id without making a request', async () => {
    const { fetch, calls } = fakeFetch(() => json({}));
    await expect(
      CONNECTOR_ADAPTERS.TEMPO.traces!(context('TEMPO', fetch), { traceId: '../admin', window })
    ).rejects.toBeInstanceOf(ConnectorError);
    expect(calls).toHaveLength(0);
  });

  it('Grafana: reaches Prometheus and Loki through the data-source proxy with the org header', async () => {
    const { fetch, calls } = fakeFetch(call =>
      call.url.pathname.includes('/loki/')
        ? json({ data: { result: [] } })
        : json({ status: 'success', data: { result: [] } })
    );
    await CONNECTOR_ADAPTERS.GRAFANA.metrics!(context('GRAFANA', fetch), { query: 'up', window });
    await CONNECTOR_ADAPTERS.GRAFANA.logs!(context('GRAFANA', fetch), {
      query: '{app="x"}',
      window,
      limit: 5,
    });
    expect(calls[0].url.pathname).toBe('/api/datasources/proxy/uid/prom-uid/api/v1/query_range');
    expect(calls[1].url.pathname).toBe(
      '/api/datasources/proxy/uid/prom-uid/loki/api/v1/query_range'
    );
    expect(headerOf(calls[0], 'x-grafana-org-id')).toBe('2');
  });

  it('Datadog: metrics, logs and spans with both keys as headers', async () => {
    const { fetch, calls } = fakeFetch(call => {
      if (call.url.pathname === '/api/v1/query')
        return json({
          series: [
            {
              metric: 'trace.http.request.errors',
              scope: 'service:api',
              pointlist: [
                [1762000000000, 1],
                [1762000060000, null],
                [1762000120000, 9],
              ],
            },
          ],
        });
      if (call.url.pathname === '/api/v2/logs/events/search')
        return json({
          data: [
            {
              attributes: {
                timestamp: '2026-11-01T10:30:00Z',
                message: 'payment failed',
                service: 'api',
                status: 'error',
              },
            },
          ],
        });
      return json({
        data: [
          {
            attributes: {
              trace_id: '123',
              span_id: '1',
              parent_id: '0',
              service: 'api',
              resource_name: 'POST /pay',
              start_timestamp: '2026-11-01T10:30:00.000Z',
              end_timestamp: '2026-11-01T10:30:01.000Z',
              status: 'error',
            },
          },
        ],
      });
    });
    const ctx = context('DATADOG', fetch);
    const metrics = await CONNECTOR_ADAPTERS.DATADOG.metrics!(ctx, {
      query: 'sum:errors{*}',
      window,
    });
    const logs = await CONNECTOR_ADAPTERS.DATADOG.logs!(ctx, {
      query: 'status:error',
      window,
      limit: 10,
    });
    const traces = await CONNECTOR_ADAPTERS.DATADOG.traces!(ctx, { window });
    expect(headerOf(calls[0], 'dd-api-key')).toBe('dd-api');
    expect(headerOf(calls[0], 'dd-application-key')).toBe('dd-app');
    expect(metrics.series[0]).toMatchObject({ points: 2, max: 9 });
    expect(calls[1].init.method).toBe('POST');
    expect(JSON.parse(String(calls[1].init.body))).toMatchObject({
      filter: { query: 'status:error' },
      page: { limit: 10 },
    });
    expect(logs.lines[0]).toMatchObject({ text: 'payment failed' });
    expect(calls[2].url.searchParams.get('filter[query]')).toBe('status:error');
    expect(traces.traces[0]).toMatchObject({ traceId: '123', errorCount: 1, durationMs: 1000 });
  });

  it('Elasticsearch: a bounded search over the configured index with an API key', async () => {
    const { fetch, calls } = fakeFetch(() =>
      json({
        hits: {
          total: { value: 120 },
          hits: [
            {
              _source: {
                '@timestamp': '2026-11-01T10:40:00Z',
                message: 'timeout calling db',
                log: { level: 'error' },
                'service.name': 'api',
              },
            },
          ],
        },
      })
    );
    const summary = await CONNECTOR_ADAPTERS.ELASTIC.logs!(
      context('ELASTIC', fetch, { project: 'logs-api-*' }),
      { query: 'timeout', window, limit: 20 }
    );
    expect(calls[0].url.pathname).toBe('/logs-api-*/_search');
    expect(headerOf(calls[0], 'authorization')).toBe('ApiKey tok-123');
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.size).toBe(20);
    expect(body.query.bool.filter[0].range['@timestamp']).toEqual({
      gte: window.start.toISOString(),
      lte: window.end.toISOString(),
    });
    expect(summary.matched).toBe(120);
    expect(summary.truncated).toBe(true);
    expect(summary.lines[0]).toEqual({
      at: '2026-11-01T10:40:00.000Z',
      text: 'timeout calling db',
      labels: { level: 'error', service: 'api' },
    });
  });

  it('CloudWatch: signed GetMetricData and FilterLogEvents on the regional endpoints', async () => {
    const { fetch, calls } = fakeFetch(call =>
      call.url.hostname.startsWith('logs.')
        ? json({
            events: [{ timestamp: 1762000000000, message: 'ERROR boom', logStreamName: 's' }],
          })
        : json({
            MetricDataResults: [
              { Id: 'q1', Label: 'CPU', Timestamps: [1762000000, 1762000060], Values: [10, 90] },
            ],
          })
    );
    const ctx = context('CLOUDWATCH', fetch);
    const metrics = await CONNECTOR_ADAPTERS.CLOUDWATCH.metrics!(ctx, {
      query: 'SELECT AVG(CPUUtilization) FROM SCHEMA("AWS/EC2")',
      window,
    });
    const logs = await CONNECTOR_ADAPTERS.CLOUDWATCH.logs!(ctx, {
      query: 'ERROR',
      window,
      limit: 10,
    });
    expect(calls[0].url.host).toBe('monitoring.eu-west-1.amazonaws.com');
    expect(headerOf(calls[0], 'x-amz-target')).toBe('GraniteServiceVersion20100801.GetMetricData');
    expect(headerOf(calls[0], 'authorization')).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIAABCDEFGHIJKLMNOP\/\d{8}\/eu-west-1\/monitoring\/aws4_request, SignedHeaders=content-type;host;x-amz-date;x-amz-target, Signature=[0-9a-f]{64}$/
    );
    expect(metrics.series[0]).toMatchObject({ min: 10, max: 90 });
    expect(calls[1].url.host).toBe('logs.eu-west-1.amazonaws.com');
    expect(JSON.parse(String(calls[1].init.body))).toMatchObject({
      logGroupName: '/aws/lambda/api',
      filterPattern: 'ERROR',
    });
    expect(logs.lines[0].text).toBe('ERROR boom');
  });

  it('CloudWatch: SigV4 matches the published AWS test vector shape and is deterministic', () => {
    const sign = () =>
      signAwsRequest({
        method: 'POST',
        url: new URL('https://monitoring.us-east-1.amazonaws.com/'),
        headers: { 'content-type': 'application/x-amz-json-1.0', 'x-amz-target': 'X.Y' },
        body: '{}',
        region: 'us-east-1',
        accessKeyId: 'AKIDEXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
        now: new Date('2015-08-30T12:36:00Z'),
      });
    const first = sign();
    expect(first['x-amz-date']).toBe('20150830T123600Z');
    expect(first.authorization).toContain('Credential=AKIDEXAMPLE/20150830/us-east-1/monitoring');
    expect(sign()).toEqual(first);
  });

  it('Sentry: issues for the organization in the window, most frequent first', async () => {
    const { fetch, calls } = fakeFetch(() =>
      json([
        {
          id: '1',
          shortId: 'API-1',
          title: 'TypeError: x is undefined',
          culprit: 'checkout.js',
          level: 'error',
          status: 'unresolved',
          count: '42',
          userCount: 7,
          firstSeen: '2026-11-01T10:05:00Z',
          lastSeen: '2026-11-01T10:55:00Z',
          permalink: 'https://sentry.io/organizations/acme/issues/1/',
        },
      ])
    );
    const summary = await CONNECTOR_ADAPTERS.SENTRY.errors!(context('SENTRY', fetch), { window });
    expect(calls[0].url.pathname).toBe('/api/0/organizations/acme/issues/');
    expect(calls[0].url.searchParams.get('query')).toBe(`lastSeen:>=${window.start.toISOString()}`);
    expect(summary.issues[0]).toMatchObject({ id: 'API-1', events: 42, usersAffected: 7 });
  });

  it('GitHub: a commit diff with stats and a truncated patch', async () => {
    const { fetch, calls } = fakeFetch(() =>
      json({
        sha: 'abcdef1234567890',
        commit: { message: 'Raise pool size\n\nlong body' },
        files: [
          {
            filename: 'config/db.yml',
            status: 'modified',
            additions: 1,
            deletions: 1,
            patch: '@@ -1 +1 @@\n-pool: 5\n+pool: 50',
          },
        ],
      })
    );
    const ref = parseChangeUrl('https://github.com/acme/api/commit/abcdef1234567890')!;
    const summary = await CONNECTOR_ADAPTERS.GITHUB.diff!(context('GITHUB', fetch), ref);
    expect(calls[0].url.pathname).toBe('/repos/acme/api/commits/abcdef1234567890');
    expect(headerOf(calls[0], 'authorization')).toBe('Bearer tok-123');
    expect(summary).toMatchObject({
      title: 'Raise pool size',
      filesChanged: 1,
      additions: 1,
      deletions: 1,
      files: [{ path: 'config/db.yml', status: 'modified' }],
    });
    expect(summary.patch).toContain('+pool: 50');
  });

  it('GitHub: a pull request reads its metadata and files', async () => {
    const { fetch, calls } = fakeFetch(call =>
      call.url.pathname.endsWith('/files')
        ? json([{ filename: 'a.ts', status: 'added', additions: 3, deletions: 0 }])
        : json({ title: 'Feature', changed_files: 1 })
    );
    const ref = parseChangeUrl('https://github.com/acme/api/pull/42/files')!;
    const summary = await CONNECTOR_ADAPTERS.GITHUB.diff!(context('GITHUB', fetch), ref);
    expect(calls.map(call => call.url.pathname).sort()).toEqual([
      '/repos/acme/api/pulls/42',
      '/repos/acme/api/pulls/42/files',
    ]);
    expect(summary).toMatchObject({ ref: '#42', title: 'Feature', additions: 3 });
  });

  it('GitLab: a merge request diff counts lines from the patch', async () => {
    const { fetch, calls } = fakeFetch(call =>
      call.url.pathname.endsWith('/diffs')
        ? json([{ new_path: 'app.rb', diff: '@@\n+one\n+two\n-three', new_file: false }])
        : json({ title: 'Fix login' })
    );
    const ref = parseChangeUrl('https://gitlab.com/group/sub/app/-/merge_requests/7')!;
    const summary = await CONNECTOR_ADAPTERS.GITLAB.diff!(context('GITLAB', fetch), ref);
    expect(calls.map(call => call.url.pathname)).toContain(
      '/api/v4/projects/group%2Fsub%2Fapp/merge_requests/7/diffs'
    );
    expect(headerOf(calls[0], 'private-token')).toBe('tok-123');
    expect(summary).toMatchObject({ ref: '!7', title: 'Fix login', additions: 2, deletions: 1 });
  });
});

describe('connector adapters: failure modes for every kind', () => {
  const kinds = [...OBSERVABILITY_KINDS];

  it.each(kinds)(
    '%s: a harmless test read is a GET (or a read-only POST) that succeeds',
    async kind => {
      const { fetch, calls } = fakeFetch(() => json({ status: 'success' }));
      await CONNECTOR_ADAPTERS[kind].test(context(kind, fetch));
      expect(calls).toHaveLength(1);
      // CloudWatch's JSON protocol is POST-only; its test is ListMetrics, a read.
      expect(calls[0].init.method).toBe(kind === 'CLOUDWATCH' ? 'POST' : 'GET');
      expect(calls[0].init.redirect).toBe('error');
    }
  );

  it.each(kinds)('%s: times out at the connection timeout', async kind => {
    const { fetch } = fakeFetch(
      call =>
        new Promise<Response>((_, reject) =>
          call.init.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        )
    );
    const started = Date.now();
    const error = await CONNECTOR_ADAPTERS[kind]
      .test(context(kind, fetch, { timeoutMs: 50 }))
      .catch(e => e);
    expect(error).toBeInstanceOf(ConnectorError);
    expect(error.code).toBe('TIMEOUT');
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it.each(kinds)('%s: refuses an oversized body', async kind => {
    const big = new Uint8Array(1_000_000).fill(32);
    const { fetch } = fakeFetch(
      () =>
        new Response(
          new ReadableStream({
            pull(controller) {
              controller.enqueue(big);
            },
          }),
          { status: 200 }
        )
    );
    const error = await CONNECTOR_ADAPTERS[kind].test(context(kind, fetch)).catch(e => e);
    expect(error).toBeInstanceOf(ConnectorError);
    expect(error.code).toBe('TOO_LARGE');
  });

  it.each(kinds)('%s: refuses a declared oversized body without reading it', async kind => {
    const { fetch } = fakeFetch(
      () => new Response('{}', { status: 200, headers: { 'content-length': '999999999' } })
    );
    const error = await CONNECTOR_ADAPTERS[kind].test(context(kind, fetch)).catch(e => e);
    expect(error.code).toBe('TOO_LARGE');
  });

  it.each(kinds)('%s: reports a non-2xx answer with its status', async kind => {
    const { fetch } = fakeFetch(() => json({ message: 'nope' }, 503));
    const error = await CONNECTOR_ADAPTERS[kind].test(context(kind, fetch)).catch(e => e);
    expect(error).toBeInstanceOf(ConnectorError);
    expect(error).toMatchObject({ code: 'HTTP_ERROR', status: 503 });
    // The vendor's message is never surfaced.
    expect(error.message).not.toContain('nope');
  });

  it.each(kinds)(
    '%s: the real guarded fetch refuses metadata and private targets without consent',
    async kind => {
      for (const [baseUrl, allowPrivateNetwork] of [
        ['http://169.254.169.254', false],
        ['http://169.254.169.254', true],
        ['https://10.0.0.5', false],
        ['https://127.0.0.1:9090', false],
        ['http://prom.example.com', false],
      ] as const) {
        const resolved = connection(kind, { baseUrl, allowPrivateNetwork });
        const error = await CONNECTOR_ADAPTERS[kind]
          .test({ connection: resolved, fetch: connectorFetchFor(resolved) })
          .catch(e => e);
        expect(error, `${kind} ${baseUrl}`).toBeInstanceOf(ConnectorError);
        expect(error.code, `${kind} ${baseUrl}`).toBe('BLOCKED');
      }
    }
  );

  it('pins a consented private connection to its exact origin', async () => {
    const resolved = connection('PROMETHEUS', {
      baseUrl: 'http://127.0.0.1:1',
      allowPrivateNetwork: true,
    });
    const guarded = connectorFetchFor(resolved);
    await expect(guarded('http://127.0.0.1:2/api')).rejects.toThrow(/outside the approved/);
  });
});

describe('change URLs', () => {
  it('parses GitHub commits, pull requests and compare views', () => {
    expect(parseChangeUrl('https://github.com/acme/api/commit/abc1234')).toMatchObject({
      provider: 'github',
      host: 'github.com',
      repository: 'acme/api',
      type: 'commit',
      id: 'abc1234',
    });
    expect(parseChangeUrl('https://github.com/acme/api/pull/12')).toMatchObject({
      type: 'pull',
      id: '12',
    });
    expect(parseChangeUrl('https://github.com/acme/api/compare/v1.0...v1.1')).toMatchObject({
      type: 'compare',
      id: 'v1.0...v1.1',
    });
  });

  it('parses GitLab commits and merge requests with nested groups', () => {
    expect(parseChangeUrl('https://gitlab.example.com/a/b/c/-/commit/abcdef12')).toMatchObject({
      provider: 'gitlab',
      host: 'gitlab.example.com',
      repository: 'a/b/c',
      type: 'commit',
    });
  });

  it('rejects anything else, including traversal and credentials', () => {
    for (const url of [
      'https://github.com/acme/api',
      'https://github.com/acme/api/issues/1',
      'https://github.com/../api/commit/abcdef1',
      'https://github.com/acme/api/compare/../../x...y',
      'https://user:pass@github.com/acme/api/commit/abcdef1',
      'ftp://github.com/acme/api/commit/abcdef1',
      'https://github.com/acme/api/commit/not-a-sha',
      'not a url',
    ])
      expect(parseChangeUrl(url), url).toBeNull();
  });

  it('maps the public GitHub API to github.com and keeps enterprise hosts', () => {
    expect(webHostOf('GITHUB', 'https://api.github.com')).toBe('github.com');
    expect(webHostOf('GITHUB', 'https://ghe.corp/api/v3')).toBe('ghe.corp');
    expect(webHostOf('GITLAB', 'https://gitlab.com')).toBe('gitlab.com');
  });
});

describe('normalisation bounds', () => {
  it('caps series, samples and labels', () => {
    const raw = Array.from({ length: 30 }, (_, i) => ({
      labels: Object.fromEntries(Array.from({ length: 20 }, (_, j) => [`l${j}`, `v${i}`])),
      points: Array.from({ length: 500 }, (_, k) => [k * 1000, k] as [number, number]),
    }));
    const summary = summarizeSeries('q', window, raw);
    expect(summary.series).toHaveLength(LIMITS.series);
    expect(summary.seriesCount).toBe(30);
    expect(summary.truncated).toBe(true);
    expect(summary.series[0].samples).toHaveLength(LIMITS.samplesPerSeries);
    expect(Object.keys(summary.series[0].labels)).toHaveLength(LIMITS.labelsPerSeries);
    expect(JSON.stringify(summary).length).toBeLessThan(7_000);
  });

  it('caps log lines and their length', () => {
    const summary = summarizeLogs(
      'q',
      window,
      Array.from({ length: 200 }, (_, i) => ({ at: i, text: 'x'.repeat(5_000) }))
    );
    expect(summary.lines).toHaveLength(LIMITS.logLines);
    expect(summary.lines[0].text.length).toBeLessThanOrEqual(LIMITS.logLineLength);
    expect(summary.truncated).toBe(true);
  });

  it('caps traces and spans, and survives cycles in parent links', () => {
    const spans = Array.from({ length: 100 }, (_, i) => ({
      traceId: `t${i % 7}`,
      spanId: `s${i}`,
      parentId: `s${i + 7}`,
      service: 'svc',
      name: 'op',
      startMs: i,
      durationMs: 10,
      error: false,
    }));
    const summary = summarizeTraces(window, spans);
    expect(summary.traces).toHaveLength(LIMITS.traces);
    for (const trace of summary.traces)
      expect(trace.spans.length).toBeLessThanOrEqual(LIMITS.spansPerTrace);
  });

  it('truncates the patch and counts diff lines', () => {
    expect(countPatchLines('--- a\n+++ b\n+x\n-y\n+z')).toEqual({ additions: 2, deletions: 1 });
    const summary = summarizeDiff({
      provider: 'github',
      ref: 'r',
      title: 't',
      url: 'u',
      files: Array.from({ length: 60 }, (_, i) => ({ path: `f${i}`, patch: '+a\n'.repeat(500) })),
    });
    expect(summary.files).toHaveLength(LIMITS.diffFiles);
    expect(summary.filesChanged).toBe(60);
    expect(summary.patch.length).toBeLessThan(LIMITS.patchChars + 100);
    expect(summary.truncated).toBe(true);
  });

  it('reads OTLP v2 envelopes too', () => {
    expect(
      otlpSpans({
        trace: {
          resourceSpans: [{ scopeSpans: [{ spans: [{ spanId: 'x', name: 'n' }] }] }],
        },
      })
    ).toHaveLength(1);
  });
});

describe('connection input', () => {
  const base = { name: 'Prom', kind: 'PROMETHEUS', baseUrl: 'https://prom.example.com' };

  it('defaults to disabled, no private network and a 10 s timeout', () => {
    expect(observabilityConnectionInputSchema.parse(base)).toMatchObject({
      enabled: false,
      allowPrivateNetwork: false,
      timeoutMs: 10_000,
      allowedTeamIds: [],
    });
  });

  it('requires kind-specific fields', () => {
    expect(
      observabilityConnectionInputSchema.safeParse({ ...base, kind: 'CLOUDWATCH', baseUrl: null })
        .success
    ).toBe(false);
    expect(
      observabilityConnectionInputSchema.safeParse({ ...base, kind: 'SENTRY', baseUrl: null })
        .success
    ).toBe(false);
    expect(observabilityConnectionInputSchema.safeParse({ ...base, kind: 'GRAFANA' }).success).toBe(
      false
    );
    expect(
      observabilityConnectionInputSchema.safeParse({ ...base, kind: 'LOKI', baseUrl: '' }).success
    ).toBe(false);
    expect(
      observabilityConnectionInputSchema.safeParse({ ...base, kind: 'GITHUB', baseUrl: '' }).success
    ).toBe(true);
  });

  it('bounds the timeout and rejects unknown fields', () => {
    expect(
      observabilityConnectionInputSchema.safeParse({ ...base, timeoutMs: 60_000 }).success
    ).toBe(false);
    expect(observabilityConnectionInputSchema.safeParse({ ...base, extra: 1 }).success).toBe(false);
  });
});
