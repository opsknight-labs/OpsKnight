import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
const { checkMcpSetup, mcpEndpoint } = createRequire(import.meta.url)(
  '../../scripts/mcp/doctor.cjs'
) as typeof import('../../scripts/mcp/doctor.cjs');

function installation(
  origin: string,
  options: {
    automatic?: boolean;
    authenticated?: boolean;
    resource?: string;
    redirect?: boolean;
    oversized?: boolean;
  } = {}
) {
  return vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    if (path === '/mcp')
      return new Response(null, {
        status: options.authenticated ? 200 : 401,
        headers: {
          'www-authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`,
        },
      });
    if (options.redirect)
      return new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/' } });
    const body = path.includes('oauth-protected-resource')
      ? {
          resource: options.resource ?? `${origin}/mcp`,
          authorization_servers: [`${origin}/oauth/mcp`],
        }
      : {
          issuer: `${origin}/oauth/mcp`,
          authorization_endpoint: `${origin}/oauth/mcp/authorize`,
          token_endpoint: `${origin}/oauth/mcp/token`,
          revocation_endpoint: `${origin}/oauth/mcp/revoke`,
          code_challenge_methods_supported: ['S256'],
          token_endpoint_auth_methods_supported: ['none'],
          response_types_supported: ['code'],
          grant_types_supported: ['authorization_code', 'refresh_token'],
          authorization_response_iss_parameter_supported: true,
          ...(options.automatic === false
            ? {}
            : { registration_endpoint: `${origin}/oauth/mcp/register` }),
          ...(options.oversized ? { padding: 'x'.repeat(17000) } : {}),
        };
    return Response.json(body);
  });
}

describe('portable self-hosted MCP setup checks', () => {
  it.each([
    'https://ops.example.com',
    'https://alerts.company.example:8443',
    'http://localhost:3042',
  ])('checks %s without registering a client or sending credentials', async origin => {
    const fetcher = installation(origin);
    const result = await checkMcpSetup(`${origin}/mcp`, fetcher);
    expect(result.ready).toBe(true);
    expect(result.endpoint).toBe(`${origin}/mcp`);
    expect(fetcher).toHaveBeenCalledTimes(3);
    for (const [url, options] of fetcher.mock.calls) {
      expect(new URL(String(url)).origin).toBe(origin);
      expect(options?.redirect).toBe('manual');
      expect(options?.headers).not.toHaveProperty('authorization');
      expect(options?.headers).not.toHaveProperty('cookie');
      expect(String(url)).not.toMatch(/\/(register|token|revoke)$/);
    }
  });
  it('explains missing automatic registration instead of reporting a ready installation', async () => {
    const origin = 'https://ops.example.com';
    const result = await checkMcpSetup(origin, installation(origin, { automatic: false }));
    expect(result.ready).toBe(false);
    expect(result.checks).toContainEqual(
      expect.objectContaining({ id: 'automatic', status: 'fail' })
    );
  });
  it('fails when the endpoint allows an anonymous request', async () => {
    const origin = 'https://ops.example.com';
    const result = await checkMcpSetup(origin, installation(origin, { authenticated: true }));
    expect(result.ready).toBe(false);
    expect(result.checks).toContainEqual(
      expect.objectContaining({ id: 'authentication', status: 'fail' })
    );
  });
  it('rejects wrong resource binding and never follows redirects or untrusted discovery', async () => {
    const origin = 'https://ops.example.com';
    for (const options of [{ resource: 'https://attacker.example/mcp' }, { redirect: true }]) {
      const fetcher = installation(origin, options);
      expect((await checkMcpSetup(origin, fetcher)).ready).toBe(false);
      expect(fetcher.mock.calls.every(([url]) => new URL(String(url)).origin === origin)).toBe(
        true
      );
    }
  });
  it('bounds metadata response sizes', async () => {
    const origin = 'https://ops.example.com';
    expect((await checkMcpSetup(origin, installation(origin, { oversized: true }))).ready).toBe(
      false
    );
  });
  it('rejects insecure or credential-bearing URLs before making a network request', async () => {
    for (const url of [
      'http://ops.example.com/mcp',
      'https://user:secret@ops.example.com/mcp',
      'https://ops.example.com/mcp?token=secret',
      'https://ops.example.com/mcp#fragment',
      'https://ops.example.com/arbitrary',
      'file:///mcp',
    ])
      expect(() => mcpEndpoint(url)).toThrow();
    expect(mcpEndpoint('https://another.example.com')).toBe('https://another.example.com/mcp');
  });
});
