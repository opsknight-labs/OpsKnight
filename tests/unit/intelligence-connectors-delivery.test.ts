// @vitest-environment node
/* eslint-disable security/detect-object-injection -- keys come from the closed kind union */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const loadConnectionForActor = vi.fn();
vi.mock('@/lib/intelligence/connectors/service', async importOriginal => ({
  ...(await importOriginal<object>()),
  loadConnectionForActor: (...args: unknown[]) => loadConnectionForActor(...args),
}));
vi.mock('@/lib/prisma', () => ({ default: {} }));

import { CONNECTOR_ADAPTERS, parseChangeUrl } from '@/lib/intelligence/connectors/adapters';
import type {
  AdapterContext,
  ResolvedConnection,
} from '@/lib/intelligence/connectors/adapters/types';
import {
  clampWindow,
  clearScoutSessions,
  parseScoutQuery,
} from '@/lib/intelligence/connectors/adapters/base14';
import {
  observabilityConnectionInputSchema,
  type ObservabilityKind,
} from '@/lib/intelligence/connectors/contract';
import { ConnectorError, type ConnectorFetch } from '@/lib/intelligence/connectors/http';
import { buildObservabilityTools } from '@/lib/intelligence/squire/tools-observability';

interface Call {
  url: URL;
  init: RequestInit;
}
function fakeFetch(respond: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetch: ConnectorFetch = async (input, init = {}) => {
    const call = { url: new URL(input), init };
    calls.push(call);
    return respond(call);
  };
  return { fetch, calls };
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const header = (call: Call, name: string) =>
  new Headers(call.init.headers as Record<string, string>).get(name);

const BASE: Partial<Record<ObservabilityKind, string>> = {
  AZURE_DEVOPS: 'https://dev.azure.com/acme',
  ARGOCD: 'https://argocd.example.com',
  BASE14_SCOUT: 'https://api.base14.io',
};
function connection(kind: ObservabilityKind, overrides: Partial<ResolvedConnection> = {}) {
  return {
    id: `c-${kind}`,
    name: kind,
    kind,
    baseUrl: BASE[kind] ?? 'https://x.example.com',
    region: null,
    org: kind === 'BASE14_SCOUT' ? 'acme' : null,
    project: kind === 'AZURE_DEVOPS' ? 'Shop' : null,
    allowPrivateNetwork: false,
    timeoutMs: 1_000,
    credential:
      kind === 'BASE14_SCOUT'
        ? { secret: 'client-secret', secondary: 'client-id' }
        : { secret: 'tok' },
    ...overrides,
  } satisfies ResolvedConnection;
}
const context = (
  kind: ObservabilityKind,
  fetch: ConnectorFetch,
  overrides: Partial<ResolvedConnection> = {}
): AdapterContext => ({ connection: connection(kind, overrides), fetch });

describe('Azure DevOps adapter', () => {
  const azure = CONNECTOR_ADAPTERS.AZURE_DEVOPS;

  it('authenticates with the PAT as Basic auth and keeps an on-prem collection path', async () => {
    const { fetch, calls } = fakeFetch(() => json({ value: [] }));
    await azure.test(
      context('AZURE_DEVOPS', fetch, { baseUrl: 'https://tfs.example.com/tfs/DefaultCollection' })
    );
    expect(calls[0].url.pathname).toBe('/tfs/DefaultCollection/_apis/projects');
    expect(calls[0].url.searchParams.get('api-version')).toBe('6.0');
    expect(header(calls[0], 'authorization')).toBe(
      `Basic ${Buffer.from(':tok').toString('base64')}`
    );
  });

  it('reads recent runs, the newest failure and a truncated log tail', async () => {
    const lines = Array.from(
      { length: 100 },
      (_, i) => `line ${i} ${'x'.repeat(i === 99 ? 500 : 0)}`
    );
    const { fetch, calls } = fakeFetch(({ url }) => {
      if (url.pathname.endsWith('/timeline'))
        return json({
          records: [
            { type: 'Job', name: 'Build', result: 'failed' },
            {
              type: 'Task',
              name: 'npm test',
              result: 'failed',
              log: { id: 7 },
              issues: [{ message: 'exit 1' }],
            },
            { type: 'Task', name: 'checkout', result: 'succeeded', log: { id: 2 } },
          ],
        });
      if (url.pathname.endsWith('/logs/7')) return json({ count: 100, value: lines });
      return json({
        value: [
          {
            id: 12,
            buildNumber: '20261121.3',
            status: 'completed',
            result: 'failed',
            sourceBranch: 'refs/heads/main',
            sourceVersion: 'abcdef1234567890',
            definition: { name: 'ci' },
          },
          { id: 11, status: 'completed', result: 'succeeded' },
        ],
      });
    });
    const summary = await azure.azurePipelines!(context('AZURE_DEVOPS', fetch), {
      project: 'Shop App',
      pipelineId: 4,
      branch: 'main',
    });
    expect(calls[0].url.pathname).toBe('/acme/Shop%20App/_apis/build/builds');
    expect(calls[0].url.searchParams.get('definitions')).toBe('4');
    expect(calls[0].url.searchParams.get('branchName')).toBe('refs/heads/main');
    expect(calls.map(call => call.url.pathname)).toContain(
      '/acme/Shop%20App/_apis/build/builds/12/logs/7'
    );
    const failure = summary.failure as {
      logTail: string[];
      logTruncated: boolean;
      records: unknown[];
    };
    expect(failure.records).toHaveLength(2);
    expect(failure.logTail).toHaveLength(40);
    expect(failure.logTruncated).toBe(true);
    expect(failure.logTail.at(-1)!.length).toBeLessThanOrEqual(240);
    expect((summary.runs as unknown[])[0]).toMatchObject({ id: 12, commit: 'abcdef123456' });
  });

  it('lists recent commits and pull requests for a branch', async () => {
    const { fetch, calls } = fakeFetch(({ url }) =>
      url.pathname.endsWith('/commits')
        ? json({
            value: [
              {
                commitId: 'a'.repeat(40),
                comment: 'Fix checkout',
                committer: { date: '2026-11-21T10:00:00Z' },
              },
            ],
          })
        : json({ value: [{ pullRequestId: 9, title: 'Bump', status: 'completed' }] })
    );
    const summary = await azure.repository!(context('AZURE_DEVOPS', fetch), {
      project: 'Shop',
      repository: 'web',
      branch: 'release/1.2',
    });
    const commits = calls.find(call => call.url.pathname.endsWith('/commits'))!;
    expect(commits.url.searchParams.get('searchCriteria.itemVersion.version')).toBe('release/1.2');
    const pulls = calls.find(call => call.url.pathname.endsWith('/pullrequests'))!;
    expect(pulls.url.searchParams.get('searchCriteria.targetRefName')).toBe(
      'refs/heads/release/1.2'
    );
    expect(summary).toMatchObject({
      commits: [{ message: 'Fix checkout' }],
      pullRequests: [{ id: 9 }],
    });
  });

  it('parses Azure DevOps change URLs and reads their diff', async () => {
    const commit = parseChangeUrl('https://dev.azure.com/acme/Shop%20App/_git/web/commit/abc1234');
    expect(commit).toMatchObject({ provider: 'azure', repository: 'Shop App/web', type: 'commit' });
    expect(
      parseChangeUrl('https://tfs.example.com/tfs/Col/Shop/_git/web/pullrequest/42')
    ).toMatchObject({ provider: 'azure', type: 'pull', id: '42' });
    expect(
      parseChangeUrl('https://dev.azure.com/acme/bad%3Bname/_git/web/commit/abc1234')
    ).toBeNull();
    expect(parseChangeUrl('https://dev.azure.com/acme/Shop/_git/web/commit/not-a-sha')).toBeNull();

    const { fetch, calls } = fakeFetch(() =>
      json({
        commitId: 'abc1234',
        comment: 'Fix\nbody',
        changes: [{ item: { path: '/a.ts' }, changeType: 'edit' }],
      })
    );
    const diff = await azure.diff!(context('AZURE_DEVOPS', fetch), commit!);
    expect(calls[0].url.pathname).toBe(
      '/acme/Shop%20App/_apis/git/repositories/web/commits/abc1234'
    );
    expect(diff).toMatchObject({ provider: 'azure', title: 'Fix' });
  });
});

describe('Argo CD adapter', () => {
  const argo = CONNECTOR_ADAPTERS.ARGOCD;

  it('summarises one application: sync, health, history and unhealthy resources', async () => {
    const { fetch, calls } = fakeFetch(() =>
      json({
        status: {
          sync: { status: 'OutOfSync', revision: 'f00d' },
          health: { status: 'Degraded' },
          operationState: {
            phase: 'Failed',
            finishedAt: '2026-11-21T10:00:00Z',
            message: 'hook failed',
          },
          history: [
            { id: 1, revision: 'aaa', deployedAt: '2026-11-20T10:00:00Z' },
            { id: 2, revision: 'bbb', deployedAt: '2026-11-21T09:00:00Z' },
          ],
          resources: [
            { kind: 'Deployment', name: 'api', status: 'Synced', health: { status: 'Degraded' } },
            { kind: 'Service', name: 'api', status: 'Synced', health: { status: 'Healthy' } },
            { kind: 'ConfigMap', name: 'cfg', status: 'OutOfSync' },
          ],
        },
      })
    );
    const summary = await argo.deployments!(context('ARGOCD', fetch), { app: 'checkout' });
    expect(calls[0].url.pathname).toBe('/api/v1/applications/checkout');
    expect(header(calls[0], 'authorization')).toBe('Bearer tok');
    expect(summary).toMatchObject({
      sync: { status: 'OutOfSync' },
      health: { status: 'Degraded' },
      lastOperation: { phase: 'Failed' },
      history: [{ id: 2 }, { id: 1 }],
      resources: { total: 3, byHealth: { Degraded: 1, Healthy: 1, Unknown: 1 } },
    });
    expect((summary.resources as { unhealthy: unknown[] }).unhealthy).toHaveLength(2);
  });

  it('lists applications with only the needed fields', async () => {
    const { fetch, calls } = fakeFetch(() =>
      json({
        items: [
          {
            metadata: { name: 'a' },
            status: { sync: { status: 'Synced' }, health: { status: 'Healthy' } },
          },
        ],
      })
    );
    const summary = await argo.deployments!(context('ARGOCD', fetch), {});
    expect(calls[0].url.searchParams.get('fields')).toContain('items.metadata.name');
    expect(summary).toMatchObject({ total: 1, applications: [{ name: 'a', sync: 'Synced' }] });
  });
});

describe('base14 Scout adapter', () => {
  const scout = CONNECTOR_ADAPTERS.BASE14_SCOUT;
  beforeEach(() => clearScoutSessions());

  const scoutFetch = (
    api: (call: Call) => Response = () => json({ services: [] }),
    grant: () => Response = () => json({ access_token: 'at-1', expires_in: 300 })
  ) =>
    fakeFetch(call => {
      if (call.url.hostname === 'id.base14.io') return grant();
      if (call.url.pathname.startsWith('/v1/discovery'))
        return json({ scoutApiUrl: 'https://api.use1-scout.base14.io/acme' });
      return api(call);
    });

  it('exchanges client credentials, discovers the API URL and caches both', async () => {
    const { fetch, calls } = scoutFetch();
    await scout.test(context('BASE14_SCOUT', fetch));
    await scout.test(context('BASE14_SCOUT', fetch));
    const [token, discovery, first, second] = calls;
    expect(token.url.toString()).toBe(
      'https://id.base14.io/realms/acme/protocol/openid-connect/token'
    );
    expect(token.init.method).toBe('POST');
    expect(header(token, 'content-type')).toBe('application/x-www-form-urlencoded');
    expect(Object.fromEntries(new URLSearchParams(String(token.init.body)))).toEqual({
      grant_type: 'client_credentials',
      client_id: 'client-id',
      client_secret: 'client-secret',
    });
    expect(discovery.url.toString()).toBe('https://api.base14.io/v1/discovery/services/acme');
    expect(header(discovery, 'authorization')).toBe('Bearer at-1');
    expect(first.url.toString()).toBe('https://api.use1-scout.base14.io/acme/api/v1/services');
    expect(header(second, 'authorization')).toBe('Bearer at-1');
    expect(calls).toHaveLength(4);
  });

  it('refreshes an expiring token, and once on a 401', async () => {
    let n = 0;
    let rejectNext = false;
    const { fetch, calls } = scoutFetch(
      () => {
        if (rejectNext) {
          rejectNext = false;
          return json({}, 401);
        }
        return json({ services: [] });
      },
      // Lifetime inside the refresh skew: never reused.
      () => json({ access_token: `at-${++n}`, expires_in: 10 })
    );
    await scout.test(context('BASE14_SCOUT', fetch));
    await scout.test(context('BASE14_SCOUT', fetch));
    expect(calls.filter(call => call.url.hostname === 'id.base14.io')).toHaveLength(2);
    // Discovery is cached with the session even when the token is refreshed.
    expect(calls.filter(call => call.url.pathname.startsWith('/v1/discovery'))).toHaveLength(1);

    clearScoutSessions();
    calls.length = 0;
    const long = scoutFetch(
      () => {
        if (rejectNext) {
          rejectNext = false;
          return json({}, 401);
        }
        return json({ services: [] });
      },
      () => json({ access_token: `at-${++n}`, expires_in: 300 })
    );
    await scout.test(context('BASE14_SCOUT', long.fetch));
    rejectNext = true;
    await scout.test(context('BASE14_SCOUT', long.fetch));
    expect(long.calls.filter(call => call.url.hostname === 'id.base14.io')).toHaveLength(2);
  });

  it('reports a 403 as a rejection without retrying', async () => {
    const { fetch, calls } = scoutFetch(() => json({ error: 'forbidden' }, 403));
    const error = await scout.test(context('BASE14_SCOUT', fetch)).catch(e => e);
    expect(error).toMatchObject({ code: 'HTTP_ERROR', status: 403 });
    expect(calls.filter(call => call.url.hostname.includes('scout'))).toHaveLength(1);
  });

  it('never sends the secret to a non-base14 override or a non-base14 discovered host', async () => {
    const { fetch, calls } = scoutFetch();
    for (const baseUrl of [
      'https://evil.example.com',
      'http://api.base14.io.evil.com',
      'http://x.base14.io',
    ]) {
      const error = await scout.test(context('BASE14_SCOUT', fetch, { baseUrl })).catch(e => e);
      expect(error, baseUrl).toMatchObject({ code: 'BLOCKED' });
    }
    expect(calls).toHaveLength(0);

    const evil = fakeFetch(call =>
      call.url.hostname === 'id.base14.io'
        ? json({ access_token: 't', expires_in: 300 })
        : json({ scoutApiUrl: 'https://169.254.169.254/acme' })
    );
    const error = await scout.test(context('BASE14_SCOUT', evil.fetch)).catch(e => e);
    expect(error).toMatchObject({ code: 'BLOCKED' });
    expect(evil.calls).toHaveLength(2);
  });

  it('uses a *.base14.io override without discovery', async () => {
    const { fetch, calls } = scoutFetch();
    await scout.test(
      context('BASE14_SCOUT', fetch, { baseUrl: 'https://api.euw1-scout.base14.io/acme' })
    );
    expect(calls.map(call => call.url.toString())).toEqual([
      'https://id.base14.io/realms/acme/protocol/openid-connect/token',
      'https://api.euw1-scout.base14.io/acme/api/v1/services',
    ]);
  });

  it('chunks logs into 15-minute windows, newest first, within one hour', async () => {
    const now = Date.now();
    const window = { start: new Date(now - 6 * 60 * 60_000), end: new Date(now) };
    const { fetch, calls } = scoutFetch(() =>
      json({
        logs: [{ timestamp: new Date(now - 1000).toISOString(), severity: 'ERROR', body: 'boom' }],
      })
    );
    const summary = await scout.logs!(context('BASE14_SCOUT', fetch), {
      query: 'service=checkout severity=ERROR log_attr_user_id[ne]= payment declined',
      window,
      limit: 15,
    });
    const reads = calls.filter(call => call.url.pathname.endsWith('/telemetry/logs'));
    expect(reads).toHaveLength(4);
    for (const read of reads) {
      const span =
        Date.parse(read.url.searchParams.get('end_time')!) -
        Date.parse(read.url.searchParams.get('start_time')!);
      expect(span).toBeLessThanOrEqual(15 * 60_000);
    }
    expect(Date.parse(reads[0].url.searchParams.get('end_time')!)).toBeGreaterThan(
      Date.parse(reads[3].url.searchParams.get('end_time')!)
    );
    expect(reads[0].url.searchParams.get('service_name')).toBe('checkout');
    expect(reads[0].url.searchParams.get('log_attr_user_id[ne]')).toBe('');
    expect(reads[0].url.searchParams.get('body_contains')).toBe('payment declined');
    expect(summary.kind).toBe('logs');
  });

  it('clamps metrics to one hour and maps the series', async () => {
    const now = Date.now();
    const { fetch, calls } = scoutFetch(() =>
      json({
        metric_name: 'http.server.duration',
        series: [
          {
            group: { 'http.route': '/pay' },
            data_points: [
              { bucket: new Date(now - 120_000).toISOString(), avg_value: 1 },
              { bucket: new Date(now - 60_000).toISOString(), avg_value: 9 },
            ],
          },
        ],
      })
    );
    const points = await scout.series!(context('BASE14_SCOUT', fetch), {
      query: 'service=checkout metric=http.server.duration attr_http.method=GET',
      window: { start: new Date(now - 5 * 60 * 60_000), end: new Date(now) },
    });
    const read = calls.at(-1)!;
    expect(
      Date.parse(read.url.searchParams.get('end_time')!) -
        Date.parse(read.url.searchParams.get('start_time')!)
    ).toBeLessThanOrEqual(60 * 60_000);
    expect(read.url.searchParams.get('attr_http.method')).toBe('GET');
    expect(points[0].points).toHaveLength(2);
  });

  it('rejects unknown filters and injection attempts in the query', () => {
    const keys = { service: 'service_name' };
    for (const raw of [
      'service=a&admin=1',
      'service=a evil=1',
      'service=a attr_x&y=1',
      'service=a span_attr_http.method=GET',
      'metric=x',
      'service=../../x',
    ])
      expect(() => parseScoutQuery(raw, keys, ['attr_']), raw).toThrow(ConnectorError);
    expect(parseScoutQuery('service=a attr_k8s.pod.name="pod 1"', keys, ['attr_'])).toEqual({
      service_name: 'a',
      'attr_k8s.pod.name': 'pod 1',
    });
  });

  it('clamps windows to the 30-day lookback', () => {
    const now = Date.parse('2026-11-21T00:00:00Z');
    const old = clampWindow(
      { start: new Date(now - 40 * 86_400_000), end: new Date(now) },
      30 * 86_400_000,
      now
    );
    expect(now - old.start.getTime()).toBeLessThan(30 * 86_400_000);
    expect(() =>
      clampWindow(
        { start: new Date(now - 50 * 86_400_000), end: new Date(now - 40 * 86_400_000) },
        60_000,
        now
      )
    ).toThrow(ConnectorError);
  });

  it('reads APM KPIs and dependencies with bounded edges', async () => {
    const now = Date.now();
    const window = { start: new Date(now - 60_000), end: new Date(now) };
    const edges = Array.from({ length: 80 }, (_, i) => ({ source: 'a', target: `b${i}` }));
    const { fetch, calls } = scoutFetch(({ url }) =>
      url.pathname.endsWith('/apm/kpis')
        ? json({ summary: { error_pct: 2.5, p99_ms: 900 } })
        : json({ dependencies: edges })
    );
    const kpis = await scout.apm!(context('BASE14_SCOUT', fetch), {
      view: 'kpis',
      service: 'a',
      window,
    });
    expect(kpis).toMatchObject({ summary: { error_pct: 2.5, p99_ms: 900 } });
    const deps = await scout.apm!(context('BASE14_SCOUT', fetch), {
      view: 'dependencies',
      service: 'a b',
      window,
    });
    expect(calls.at(-1)!.url.pathname).toBe('/acme/api/v1/services/a%20b/dependencies');
    expect(deps).toMatchObject({ total: 80, truncated: true });
    expect(deps.dependencies as unknown[]).toHaveLength(50);
  });
});

describe('connection input for the new kinds', () => {
  const base = { name: 'x', allowedTeamIds: [], enabled: true };
  it('requires the base14 organization and both client credentials, and refuses private networks', () => {
    expect(
      observabilityConnectionInputSchema.safeParse({ ...base, kind: 'BASE14_SCOUT' }).success
    ).toBe(false);
    expect(
      observabilityConnectionInputSchema.safeParse({
        ...base,
        kind: 'BASE14_SCOUT',
        org: 'acme',
        secret: 's',
      }).success
    ).toBe(false);
    expect(
      observabilityConnectionInputSchema.safeParse({
        ...base,
        kind: 'BASE14_SCOUT',
        org: 'acme',
        secret: 's',
        secondary: 'id',
        allowPrivateNetwork: true,
      }).success
    ).toBe(false);
    expect(
      observabilityConnectionInputSchema.safeParse({
        ...base,
        kind: 'BASE14_SCOUT',
        org: 'acme',
        secret: 's',
        secondary: 'id',
      }).success
    ).toBe(true);
  });
  it('requires a base URL for Azure DevOps and Argo CD', () => {
    for (const kind of ['AZURE_DEVOPS', 'ARGOCD'])
      expect(observabilityConnectionInputSchema.safeParse({ ...base, kind }).success, kind).toBe(
        false
      );
  });
});

describe('Squire delivery tools', () => {
  const actor = { userId: 'u1', role: 'USER' } as never;
  const eligible = (kind: ObservabilityKind) => ({
    id: `c-${kind}`,
    name: kind,
    kind,
    baseUrl: BASE[kind]!,
  });
  beforeEach(() => loadConnectionForActor.mockReset());

  it('offers each tool only with a connection that can answer it', () => {
    const names = (kinds: ObservabilityKind[]) =>
      buildObservabilityTools(actor, kinds.map(eligible) as never).map(tool => tool.name);
    expect(names(['ARGOCD'])).toEqual(['get_deployment_status']);
    expect(names(['AZURE_DEVOPS'])).toEqual(
      expect.arrayContaining(['get_change_diff', 'get_repo_activity', 'get_azure_pipeline_runs'])
    );
    expect(names(['BASE14_SCOUT'])).toEqual(
      expect.arrayContaining([
        'query_metrics',
        'search_logs',
        'get_traces',
        'get_apm_kpis',
        'get_service_topology',
      ])
    );
    expect(names(['ARGOCD'])).not.toContain('get_apm_kpis');
  });

  it('denies a connection that is no longer in scope', async () => {
    loadConnectionForActor.mockResolvedValue(null);
    const tool = buildObservabilityTools(actor, [eligible('ARGOCD')] as never).find(
      candidate => candidate.name === 'get_deployment_status'
    )!;
    expect(await tool.execute!({ app: 'checkout' })).toEqual({
      error: 'Not found, or you do not have access to it.',
    });
    expect(loadConnectionForActor).toHaveBeenCalledWith(actor, 'c-ARGOCD');
  });

  it('rejects invalid names before any request and redacts secrets in log tails', async () => {
    const { fetch, calls } = fakeFetch(({ url }) => {
      if (url.pathname.endsWith('/timeline'))
        return json({ records: [{ type: 'Task', name: 't', result: 'failed', log: { id: 1 } }] });
      if (url.pathname.endsWith('/logs/1'))
        return json({ value: ['token ghp_abcdefghijklmnopqrstuvwxyz0123456789 leaked'] });
      return json({ value: [{ id: 3, result: 'failed' }] });
    });
    loadConnectionForActor.mockResolvedValue(connection('AZURE_DEVOPS'));
    const tools = buildObservabilityTools(actor, [eligible('AZURE_DEVOPS')] as never, { fetch });
    const runs = tools.find(tool => tool.name === 'get_azure_pipeline_runs')!;
    expect(await runs.execute!({ branch: '../etc' })).toEqual({ error: 'Invalid input' });
    expect(calls).toHaveLength(0);
    const result = JSON.stringify(await runs.execute!({}));
    expect(calls[0].url.pathname).toBe('/acme/Shop/_apis/build/builds');
    expect(result).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123456789');
  });
});
