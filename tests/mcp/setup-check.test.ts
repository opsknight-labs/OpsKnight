import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  issues: [] as string[],
  origin: 'https://ops.example.com' as string | null,
  databaseOk: true,
}));
vi.mock('@/lib/mcp/auth/config', () => ({
  getMcpConfigurationStatus: vi.fn(async () => ({ issues: state.issues, origin: state.origin })),
}));
vi.mock('@/lib/prisma', () => ({
  default: {
    mcpPolicy: {
      findFirst: vi.fn(async () => {
        if (!state.databaseOk) throw new Error('column missing');
        return null;
      }),
    },
  },
}));
import { runMcpSetupCheck } from '@/lib/mcp/auth/setup-check';

const origin = 'https://ops.example.com';
const issuer = `${origin}/oauth/mcp`;
const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });

function healthy(overrides: Record<string, () => Response | Promise<Response>> = {}) {
  const routes: Record<string, () => Response | Promise<Response>> = {
    '/.well-known/oauth-protected-resource/mcp': () =>
      json({ resource: `${origin}/mcp`, authorization_servers: [issuer] }),
    '/.well-known/oauth-authorization-server/oauth/mcp': () =>
      json({
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        token_endpoint_auth_methods_supported: ['none'],
        code_challenge_methods_supported: ['S256'],
        registration_endpoint: `${issuer}/register`,
      }),
    '/mcp': () =>
      new Response('{}', {
        status: 401,
        headers: {
          'www-authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`,
        },
      }),
    ...overrides,
  };
  return vi.fn(async (url: string | URL | Request) => {
    const handler = routes[new URL(String(url)).pathname];
    if (!handler) throw new Error(`unexpected ${String(url)}`);
    return handler();
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  state.issues = [];
  state.origin = origin;
  state.databaseOk = true;
});

describe('in-app MCP setup check', () => {
  it('passes when discovery, automatic connections and anonymous refusal all work', async () => {
    const report = await runMcpSetupCheck(healthy());
    expect(report.ready).toBe(true);
    expect(report.endpoint).toBe(`${origin}/mcp`);
    expect(report.checks.map(check => check.status)).not.toContain('fail');
    expect(report.checks.map(check => check.id)).toEqual(
      expect.arrayContaining([
        'configuration',
        'database',
        'resource',
        'oauth',
        'automatic',
        'authentication',
      ])
    );
  });

  it('stops and explains configuration problems without any network calls', async () => {
    state.issues = ['Set the App URL in Settings → System.'];
    state.origin = null;
    const fetcher = healthy();
    const report = await runMcpSetupCheck(fetcher);
    expect(report.ready).toBe(false);
    expect(report.checks[0]).toMatchObject({ id: 'configuration', status: 'fail' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('tells the administrator to migrate when the database is behind', async () => {
    state.databaseOk = false;
    const report = await runMcpSetupCheck(healthy());
    expect(report.checks.find(check => check.id === 'database')).toMatchObject({
      status: 'fail',
      message: expect.stringContaining('migrations'),
    });
    expect(report.ready).toBe(false);
  });

  it('fails when automatic connections are off and when discovery points elsewhere', async () => {
    const off = await runMcpSetupCheck(
      healthy({
        '/.well-known/oauth-authorization-server/oauth/mcp': () =>
          json({
            issuer,
            authorization_endpoint: `${issuer}/authorize`,
            token_endpoint: `${issuer}/token`,
            token_endpoint_auth_methods_supported: ['none'],
            code_challenge_methods_supported: ['S256'],
          }),
      })
    );
    expect(off.checks.find(check => check.id === 'automatic')?.status).toBe('fail');
    const wrong = await runMcpSetupCheck(
      healthy({
        '/.well-known/oauth-protected-resource/mcp': () =>
          json({ resource: 'https://internal:3000/mcp', authorization_servers: [issuer] }),
      })
    );
    expect(wrong.checks.find(check => check.id === 'resource')?.status).toBe('fail');
    expect(wrong.ready).toBe(false);
  });

  it('reports a disabled MCP endpoint and an unprotected one differently', async () => {
    const disabled = await runMcpSetupCheck(
      healthy({ '/mcp': () => new Response('{}', { status: 503 }) })
    );
    expect(disabled.checks.find(check => check.id === 'authentication')?.message).toContain(
      'turned off'
    );
    const open = await runMcpSetupCheck(
      healthy({ '/mcp': () => new Response('{}', { status: 200 }) })
    );
    expect(open.checks.find(check => check.id === 'authentication')?.status).toBe('fail');
  });

  it('treats a server that cannot reach its own public name as a warning, not a failure', async () => {
    const report = await runMcpSetupCheck(
      vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }) as unknown as typeof fetch
    );
    const reach = report.checks.filter(check =>
      ['resource', 'oauth', 'authentication'].includes(check.id)
    );
    expect(reach.map(check => check.status)).toEqual(['warn', 'warn', 'warn']);
    expect(report.ready).toBe(true);
  });

  it('never follows redirects or sends credentials', async () => {
    const fetcher = healthy();
    await runMcpSetupCheck(fetcher);
    for (const [, init] of (fetcher as unknown as { mock: { calls: [unknown, RequestInit][] } })
      .mock.calls) {
      expect(init.redirect).toBe('manual');
      expect(JSON.stringify(init.headers ?? {})).not.toMatch(/authorization|cookie/i);
    }
  });
});
