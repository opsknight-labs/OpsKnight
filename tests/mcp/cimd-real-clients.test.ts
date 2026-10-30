import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const warn = vi.hoisted(() => vi.fn());
vi.mock('@/lib/logger', () => ({ logger: { warn } }));
import { parseCimdDocument, resolveCimdClient } from '@/lib/mcp/auth/cimd';
import { McpBoundaryError } from '@/lib/mcp/core/errors';

// Published by Claude at https://claude.ai/oauth/mcp-oauth-client-metadata (fetched 2026-10-30).
const CLAUDE_ID = 'https://claude.ai/oauth/mcp-oauth-client-metadata';
const CLAUDE_DOCUMENT = JSON.stringify({
  client_id: CLAUDE_ID,
  client_name: 'Claude',
  client_uri: 'https://claude.ai',
  redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
  grant_types: [
    'authorization_code',
    'refresh_token',
    'urn:ietf:params:oauth:grant-type:jwt-bearer',
  ],
  response_types: ['code'],
  token_endpoint_auth_method: 'none',
});
const json = (body: string) => ({ status: 200, contentType: 'application/json', body });

beforeEach(() => warn.mockClear());

describe('client metadata documents from real assistants', () => {
  it("accepts Claude's published document", () => {
    const parsed = parseCimdDocument(CLAUDE_ID, json(CLAUDE_DOCUMENT));
    expect(parsed.redirect_uris).toEqual(['https://claude.ai/api/mcp/auth_callback']);
    expect(parsed.token_endpoint_auth_method).toBe('none');
    expect(warn).not.toHaveBeenCalled();
  });

  it('still rejects grant types this server would never issue', () => {
    for (const grant of ['client_credentials', 'password', 'implicit']) {
      const body = JSON.stringify({
        ...JSON.parse(CLAUDE_DOCUMENT),
        grant_types: ['authorization_code', grant],
      });
      expect(() => parseCimdDocument(CLAUDE_ID, json(body))).toThrow('invalid_client');
    }
    // A client that cannot do the authorization-code flow is not usable either.
    const onlyJwt = JSON.stringify({
      ...JSON.parse(CLAUDE_DOCUMENT),
      grant_types: ['urn:ietf:params:oauth:grant-type:jwt-bearer'],
    });
    expect(() => parseCimdDocument(CLAUDE_ID, json(onlyJwt))).toThrow('invalid_client');
  });

  it('logs why a document was rejected, without echoing its contents', () => {
    const secret = 'do-not-log-this-value';
    const body = JSON.stringify({
      ...JSON.parse(CLAUDE_DOCUMENT),
      grant_types: ['authorization_code', secret],
    });
    expect(() => parseCimdDocument(CLAUDE_ID, json(body))).toThrow('invalid_client');
    expect(warn).toHaveBeenCalledWith('mcp.cimd.document_rejected', {
      clientId: CLAUDE_ID,
      reason: expect.stringMatching(/^schema:grant_types\.1\//),
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain(secret);
  });

  it('reports other failure kinds distinctly', () => {
    const reasons = (response: Parameters<typeof parseCimdDocument>[1]) => {
      warn.mockClear();
      expect(() => parseCimdDocument(CLAUDE_ID, response)).toThrow('invalid_client');
      return warn.mock.calls[0][1].reason;
    };
    expect(reasons({ status: 404, contentType: 'text/html', body: '' })).toBe('http_status_404');
    expect(reasons({ status: 200, contentType: 'text/html', body: CLAUDE_DOCUMENT })).toBe(
      'content_type_not_json'
    );
    expect(reasons(json('not json'))).toBe('invalid_json');
    expect(
      reasons(
        json(JSON.stringify({ ...JSON.parse(CLAUDE_DOCUMENT), client_id: 'https://x.test/a' }))
      )
    ).toBe('client_id_mismatch');
  });
});

describe('fetch failures before a document exists', () => {
  const policy = { cimdEnabled: true, cimdAllowedHosts: [], cimdScopes: ['incidents:read'] };
  const db = {
    mcpClient: { findUnique: async () => null, upsert: async () => ({}) },
  } as unknown as Parameters<typeof resolveCimdClient>[0];
  const attempt = (fetchDocument: () => Promise<never>) =>
    resolveCimdClient(
      db,
      policy as never,
      CLAUDE_ID,
      'https://claude.ai/api/mcp/auth_callback',
      fetchDocument
    );

  it.each([
    ['MCP_CLIENT_METADATA_UNAVAILABLE', 502],
    ['MCP_CLIENT_METADATA_TIMEOUT', 504],
    ['MCP_CLIENT_METADATA_TOO_LARGE', 413],
  ])('logs %s and keeps the same error', async (code, status) => {
    await expect(
      attempt(() => Promise.reject(new McpBoundaryError(code, status)))
    ).rejects.toMatchObject({ code, status });
    expect(warn).toHaveBeenCalledWith('mcp.cimd.fetch_failed', {
      clientId: CLAUDE_ID,
      reason: code,
    });
  });

  it('logs an unexpected error without its message', async () => {
    const error = new Error('internal detail do-not-log');
    await expect(attempt(() => Promise.reject(error))).rejects.toBe(error);
    expect(warn).toHaveBeenCalledWith('mcp.cimd.fetch_failed', {
      clientId: CLAUDE_ID,
      reason: 'unexpected_error',
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('do-not-log');
  });
});

describe('denials say which check failed', () => {
  const base = { cimdEnabled: true, cimdAllowedHosts: [], cimdScopes: ['incidents:read'] };
  const dbWith = (row: unknown) =>
    ({
      mcpClient: { findUnique: async () => row, upsert: async () => ({}) },
    }) as unknown as Parameters<typeof resolveCimdClient>[0];
  const serve = async () => json(CLAUDE_DOCUMENT);
  const run = (
    policy: Record<string, unknown>,
    row: unknown = null,
    redirect = 'https://claude.ai/api/mcp/auth_callback'
  ) => resolveCimdClient(dbWith(row), policy as never, CLAUDE_ID, redirect, serve);
  const reasonLogged = () => warn.mock.calls.map(call => call[1]?.reason);

  it.each([
    ['automatic_connections_off', { ...base, cimdEnabled: false }, null],
    ['host_not_in_allowlist', { ...base, cimdAllowedHosts: ['other.example'] }, null],
    ['no_scopes_allowed_for_automatic_connections', { ...base, cimdScopes: [] }, null],
    ['client_revoked', base, { metadataUrl: CLAUDE_ID, revokedAt: new Date() }],
    ['client_id_taken_by_other_registration', base, { metadataUrl: null, revokedAt: null }],
  ])('logs %s', async (reason, policy, row) => {
    await expect(run(policy, row)).rejects.toMatchObject({ code: 'invalid_client' });
    expect(reasonLogged()).toEqual([reason]);
  });

  it('logs both redirect URIs when the assistant uses one its document does not list', async () => {
    await expect(run(base, null, 'https://claude.com/api/mcp/auth_callback')).rejects.toMatchObject(
      { code: 'invalid_client' }
    );
    expect(warn).toHaveBeenCalledWith('mcp.cimd.client_denied', {
      clientId: CLAUDE_ID,
      reason: 'redirect_uri_not_in_document',
      requestedRedirectUri: 'https://claude.com/api/mcp/auth_callback',
      documentRedirectUris: ['https://claude.ai/api/mcp/auth_callback'],
    });
  });

  it('never logs the query string of a rejected redirect URI or client id', async () => {
    await expect(
      run(base, null, 'https://claude.ai/api/mcp/auth_callback?api_key=do-not-log')
    ).rejects.toMatchObject({ code: 'invalid_client' });
    await expect(
      resolveCimdClient(
        dbWith(null),
        base as never,
        'https://claude.ai/meta?token=do-not-log',
        'https://a.example/cb',
        serve
      )
    ).rejects.toMatchObject({ code: 'invalid_client' });
    expect(reasonLogged()).toEqual(['redirect_uri_not_in_document', 'not_canonical_https_url']);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('do-not-log');
  });

  it('logs a client id that is not a canonical HTTPS URL', async () => {
    await expect(
      resolveCimdClient(
        dbWith(null),
        base as never,
        'https://claude.ai:8443/x',
        'https://a.example/cb',
        serve
      )
    ).rejects.toMatchObject({ code: 'invalid_client' });
    expect(reasonLogged()).toEqual(['not_canonical_https_url']);
  });
});
