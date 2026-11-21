// @vitest-environment node
/* eslint-disable security/detect-object-injection -- keys come from the closed kind union */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ default: {} }));

import { CONNECTOR_ADAPTERS } from '@/lib/intelligence/connectors/adapters';
import { logTail, PIPELINE_LIMITS } from '@/lib/intelligence/connectors/adapters/cicd';
import type { AdapterContext, PipelineQuery } from '@/lib/intelligence/connectors/adapters/types';
import { KIND_CAPABILITIES } from '@/lib/intelligence/connectors/contract';
import {
  ConnectorError,
  connectorFetchFor,
  type ConnectorFetch,
} from '@/lib/intelligence/connectors/http';
import { buildDiscoveryTools } from '@/lib/intelligence/squire/tools-discovery';

type Kind = 'GITHUB_ACTIONS' | 'GITLAB_CI';
const BASE: Record<Kind, string> = {
  GITHUB_ACTIONS: 'https://api.github.com',
  GITLAB_CI: 'https://gitlab.com',
};

function setup(kind: Kind, respond: (url: URL) => Response) {
  const calls: Array<{ url: URL; init: RequestInit }> = [];
  const fetch: ConnectorFetch = async (input, init = {}) => {
    const url = new URL(input);
    calls.push({ url, init });
    return respond(url);
  };
  const context: AdapterContext = {
    connection: {
      id: `c-${kind}`,
      name: kind,
      kind,
      baseUrl: BASE[kind],
      region: null,
      org: null,
      project: null,
      allowPrivateNetwork: false,
      timeoutMs: 1_000,
      credential: { secret: 'tok-123' },
    },
    fetch,
  };
  return { calls, context };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const header = (init: RequestInit, name: string) =>
  new Headers(init.headers as Record<string, string>).get(name);

describe('CI/CD connector kinds', () => {
  it('answers only pipelines', () => {
    expect(KIND_CAPABILITIES.GITHUB_ACTIONS).toEqual(['pipelines']);
    expect(KIND_CAPABILITIES.GITLAB_CI).toEqual(['pipelines']);
  });

  it('GitHub Actions: lists recent runs for a branch, read-only with a bearer token', async () => {
    const { calls, context } = setup('GITHUB_ACTIONS', () =>
      json({
        workflow_runs: Array.from({ length: 15 }, (_, i) => ({
          id: 100 + i,
          name: 'ci',
          head_branch: 'main',
          head_sha: 'abcdef1234567890',
          status: 'completed',
          conclusion: i === 0 ? 'failure' : 'success',
          event: 'push',
          created_at: '2026-11-20T10:00:00Z',
          html_url: `https://github.com/acme/api/actions/runs/${100 + i}`,
        })),
      })
    );
    const result = await CONNECTOR_ADAPTERS.GITHUB_ACTIONS.pipelines!(context, {
      repository: 'acme/api',
      branch: 'main',
    });
    expect(calls[0].url.pathname).toBe('/repos/acme/api/actions/runs');
    expect(calls[0].url.searchParams.get('branch')).toBe('main');
    expect(calls[0].init.method).toBe('GET');
    expect(calls[0].init.redirect).toBe('error');
    expect(header(calls[0].init, 'authorization')).toBe('Bearer tok-123');
    expect(result.runs).toHaveLength(PIPELINE_LIMITS.runs);
    expect(result.runs[0]).toMatchObject({ id: '100', conclusion: 'failure', sha: 'abcdef123456' });
  });

  it('GitHub Actions: a run with failed jobs, failed steps and annotation tail', async () => {
    const { calls, context } = setup('GITHUB_ACTIONS', url => {
      if (url.pathname.endsWith('/jobs'))
        return json({
          jobs: [
            { id: 1, name: 'build', conclusion: 'success', steps: [] },
            {
              id: 2,
              name: 'test',
              conclusion: 'failure',
              html_url: 'https://github.com/acme/api/actions/runs/9/job/2',
              steps: [
                { name: 'checkout', conclusion: 'success' },
                { name: 'npm test', conclusion: 'failure' },
              ],
            },
          ],
        });
      if (url.pathname.endsWith('/annotations'))
        return json([{ path: 'src/a.ts', start_line: 4, message: 'expected 1 to be 2' }]);
      return json({ id: 9, name: 'ci', status: 'completed', conclusion: 'failure' });
    });
    const result = await CONNECTOR_ADAPTERS.GITHUB_ACTIONS.pipelines!(context, {
      repository: 'acme/api',
      runId: '9',
    });
    expect(calls.every(call => call.init.method === 'GET')).toBe(true);
    expect(calls.map(call => call.url.pathname)).toContain(
      '/repos/acme/api/check-runs/2/annotations'
    );
    expect(result.failedJobs).toEqual([
      {
        id: '2',
        name: 'test',
        conclusion: 'failure',
        failedSteps: ['npm test'],
        url: 'https://github.com/acme/api/actions/runs/9/job/2',
        logTail: 'src/a.ts:4 expected 1 to be 2',
      },
    ]);
  });

  it('GitLab CI: encodes the nested project, reads failed job traces as a cleaned tail', async () => {
    const trace = [
      '\u001b[0Ksection_start:1700000000:step_script\r\u001b[0K\u001b[32;1mRunning\u001b[0;m',
      ...Array.from({ length: 50 }, (_, i) => `line ${i}`),
      '\u001b[31mERROR: tests failed\u001b[0m',
    ].join('\n');
    const { calls, context } = setup('GITLAB_CI', url => {
      if (url.pathname.endsWith('/trace')) return new Response(trace);
      if (url.pathname.endsWith('/jobs'))
        return json([
          {
            id: 7,
            name: 'unit',
            stage: 'test',
            status: 'failed',
            failure_reason: 'script_failure',
          },
        ]);
      return json({ id: 55, ref: 'main', sha: '0123456789abcdef', status: 'failed' });
    });
    const result = await CONNECTOR_ADAPTERS.GITLAB_CI.pipelines!(context, {
      repository: 'group/sub/api',
      runId: '55',
    });
    expect(calls[0].url.pathname).toBe('/api/v4/projects/group%2Fsub%2Fapi/pipelines/55');
    expect(header(calls[0].init, 'private-token')).toBe('tok-123');
    const tail = result.failedJobs![0].logTail.split('\n');
    expect(tail).toHaveLength(PIPELINE_LIMITS.tailLines);
    expect(tail.at(-1)).toBe('ERROR: tests failed');
    expect(result.failedJobs![0].failedSteps).toEqual(['test', 'script_failure']);
    expect(result.runs[0]).toMatchObject({ id: '55', branch: 'main', status: 'failed' });
  });

  it('a 403 from a token without the Actions scope surfaces as HTTP_ERROR without the vendor message', async () => {
    const { context } = setup('GITHUB_ACTIONS', () =>
      json({ message: 'Resource not accessible by integration' }, 403)
    );
    const error = await CONNECTOR_ADAPTERS.GITHUB_ACTIONS.pipelines!(context, {
      repository: 'acme/api',
    }).catch(e => e);
    expect(error).toBeInstanceOf(ConnectorError);
    expect(error).toMatchObject({ code: 'HTTP_ERROR', status: 403 });
    expect(error.message).not.toContain('Resource');
  });

  it.each(['GITHUB_ACTIONS', 'GITLAB_CI'] as const)(
    '%s: the guarded fetch refuses metadata and private targets',
    async kind => {
      const { context } = setup(kind, () => json({}));
      for (const baseUrl of ['http://169.254.169.254', 'https://10.0.0.5', 'https://127.0.0.1']) {
        const connection = { ...context.connection, baseUrl };
        const error = await CONNECTOR_ADAPTERS[kind].pipelines!(
          { connection, fetch: connectorFetchFor(connection) },
          { repository: 'acme/api' }
        ).catch(e => e);
        expect(error.code, baseUrl).toBe('BLOCKED');
      }
    }
  );

  it('logTail bounds characters', () => {
    expect(logTail('x'.repeat(10_000)).length).toBe(PIPELINE_LIMITS.tailChars);
  });
});

describe('get_pipeline_runs tool input', () => {
  const handlers = new Map<string, (input: unknown) => Promise<unknown>>();
  const queries: PipelineQuery[] = [];
  buildDiscoveryTools(
    { userId: 'u1' } as never,
    [],
    ((name: string, _d: string, _p: unknown, _r: unknown, handler: never) =>
      handlers.set(name, handler)) as never,
    (async (_tool: string, _id: string | undefined, capability: string, call: never) => {
      expect(capability).toBe('pipelines');
      const adapter = {
        pipelines: async (_c: unknown, query: PipelineQuery) => (queries.push(query), query),
      };
      return (call as (a: unknown, c: unknown) => unknown)(adapter, {});
    }) as never
  );
  const tool = handlers.get('get_pipeline_runs')!;

  it('passes a validated query to the adapter', async () => {
    await tool({ repository: 'group/sub/api', branch: 'release/1.2', runId: '42' });
    expect(queries.at(-1)).toEqual({
      repository: 'group/sub/api',
      branch: 'release/1.2',
      runId: '42',
    });
  });

  it.each([
    { repository: '../etc' },
    { repository: 'acme/..' },
    { repository: 'acme' },
    { repository: 'acme/api', branch: '../main' },
    { repository: 'acme/api', runId: '1/../../x' },
    { repository: 'acme/api?x=1' },
    { repository: 'acme/api', extra: true },
  ])('rejects %j', async input => {
    const before = queries.length;
    expect(await tool(input)).toMatchObject({ error: expect.stringContaining('Invalid input') });
    expect(queries).toHaveLength(before);
  });
});
