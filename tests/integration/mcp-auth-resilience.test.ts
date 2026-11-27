// @vitest-environment node
import { createHash } from 'node:crypto';
import OAuth2Server from '@node-oauth/oauth2-server';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestUser, resetDatabase, testPrisma as db } from '../helpers/test-db';
import prisma from '@/lib/prisma';
import { mcpOAuthServer } from '@/lib/mcp/auth/oauth-model';
import { mcpResource } from '@/lib/mcp/auth/config';
import { clearDiscoveryPolicyCache } from '@/lib/mcp/auth/discovery-policy';
import { authenticateMcp, resolveMcpGrant } from '@/lib/mcp/auth/principal';
import { MCP_BAD_TOKEN_LIMIT, resetMcpAdmissionForTests } from '@/lib/mcp/auth/admission';
import { POST as tokenExchange } from '@/app/oauth/mcp/token/route';
import { POST as revokeToken } from '@/app/oauth/mcp/revoke/route';
import { GET as authorizationMetadata } from '@/app/.well-known/oauth-authorization-server/oauth/mcp/route';
import { POST as mcpRequest } from '@/app/mcp/route';
import { callMcpOperation, type ExecutionContext } from '@/lib/mcp/core/execution';
import { CostBudget } from '@/lib/mcp/core/budget';
import { administerUser } from '@/lib/users/administration';
import { bulkUpdateUserSecurityState, updateUserSecurityState } from '@/lib/users/admin-invariants';
import { setTeamMembership } from '@/lib/teams/administration';
import { revokeUserSessions } from '@/lib/auth';

// Injected token-endpoint failures: a database error raised at commit (bare) or inside the
// OAuth model (wrapped by the library as a server_error with the original as `inner`).
const failures = vi.hoisted(() => ({ remaining: 0, code: 'P2034', wrapped: false, calls: 0 }));
vi.mock('@/lib/mcp/auth/oauth-model', async original => {
  const real = await original<typeof import('@/lib/mcp/auth/oauth-model')>();
  const { Prisma: P } = await import('@prisma/client');
  const { default: OAuth } = await import('@node-oauth/oauth2-server');
  return {
    ...real,
    mcpOAuthServer: (...args: Parameters<typeof real.mcpOAuthServer>) => {
      const server = real.mcpOAuthServer(...args);
      const token = server.token.bind(server);
      server.token = (async (...tokenArgs: Parameters<typeof token>) => {
        failures.calls++;
        if (failures.remaining > 0) {
          failures.remaining--;
          const error = new P.PrismaClientKnownRequestError('transient', {
            code: failures.code,
            clientVersion: 'test',
          });
          throw failures.wrapped ? new OAuth.ServerError(error) : error;
        }
        return token(...tokenArgs);
      }) as typeof server.token;
      return server;
    },
  };
});

const origin = 'http://localhost:3000';
beforeAll(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  process.env.MCP_PUBLIC_ORIGIN = origin;
  await resetDatabase();
}, 60000);
beforeEach(async () => {
  resetMcpAdmissionForTests();
  const policy = {
    enabled: true,
    writesEnabled: true,
    sensitiveReadsEnabled: true,
    maxInFlight: 4,
    maxOperations: 8,
    requestsPerMinute: 600,
    refreshReuseGraceSeconds: 30,
  };
  await db.mcpPolicy.upsert({ where: { id: 'default' }, create: policy, update: policy });
  await db.rateLimit.deleteMany({ where: { key: { startsWith: 'mcp:' } } });
}, 30000);
afterEach(() => {
  vi.restoreAllMocks();
});

async function fixture(
  role: 'ADMIN' | 'USER' | 'AUDITOR' | 'RESPONDER' = 'ADMIN',
  scopes = ['incidents:read', 'incidents:write']
) {
  const user = await createTestUser({ role });
  const client = await db.mcpClient.create({
    data: { name: 'MCP resilience', scopes, redirectUris: ['http://127.0.0.1:9999/callback'] },
  });
  const grant = await db.mcpGrant.create({
    data: {
      userId: user.id,
      userTokenVersion: user.tokenVersion,
      userRevocationVersion: user.mcpRevocationVersion,
      clientId: client.id,
      scopes,
      resource: mcpResource(),
      expiresAt: new Date(Date.now() + 3600000),
    },
  });
  const verifier = 'b'.repeat(43);
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  let code = '';
  await db.$transaction(async tx => {
    const authorized = await mcpOAuthServer(tx, () => {}).authorize(
      new OAuth2Server.Request({
        method: 'GET',
        headers: {},
        body: {},
        query: {
          client_id: client.id,
          response_type: 'code',
          redirect_uri: client.redirectUris[0],
          state: 'state-for-test-at-least-16',
          scope: scopes.join(' '),
          code_challenge: challenge,
          code_challenge_method: 'S256',
        },
      }),
      new OAuth2Server.Response(),
      {
        authenticateHandler: { handle: async () => ({ id: user.id, grantId: grant.id }) },
        requirePKCE: true,
      }
    );
    code = authorized.authorizationCode;
  });
  return { user, client, grant, verifier, code };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
type Tokens = { access_token: string; refresh_token: string };

function exchange(input: Record<string, string>) {
  return tokenExchange(
    new Request(`${origin}/oauth/mcp/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ resource: mcpResource(), ...input }).toString(),
    })
  );
}
async function access(f: Fixture): Promise<Tokens> {
  const response = await exchange({
    client_id: f.client.id,
    grant_type: 'authorization_code',
    code: f.code,
    code_verifier: f.verifier,
    redirect_uri: f.client.redirectUris[0],
  });
  expect(response.status).toBe(200);
  return response.json();
}
const refresh = (f: Fixture, refreshToken: string) =>
  exchange({ client_id: f.client.id, grant_type: 'refresh_token', refresh_token: refreshToken });
const bearer = (token: string, peer?: string) =>
  new Request(mcpResource(), {
    headers: { authorization: `Bearer ${token}`, ...(peer ? { 'x-forwarded-for': peer } : {}) },
  });
const grantRevoked = async (f: Fixture) =>
  Boolean((await db.mcpGrant.findUniqueOrThrow({ where: { id: f.grant.id } })).revokedAt);
async function context(f: Fixture, tokens?: Tokens): Promise<ExecutionContext> {
  const principal = await authenticateMcp(bearer((tokens ?? (await access(f))).access_token), 1);
  return {
    grantId: principal.grantId,
    credentialId: principal.credentialId,
    tokenScopes: principal.tokenScopes,
    requestId: 'auth-resilience',
    budget: new CostBudget(),
  };
}
const admin = async () => createTestUser({ role: 'ADMIN' });

describe('B1: only security events sign assistants out', () => {
  it('keeps the connection through a team membership change, which still bumps tokenVersion', async () => {
    const f = await fixture('RESPONDER', ['incidents:read']);
    const tokens = await access(f);
    const owner = await admin();
    const team = await db.team.create({ data: { name: `B1 team ${f.user.id}` } });
    await setTeamMembership(team.id, f.user.id, { role: 'MEMBER' }, { id: owner.id });
    const after = await db.user.findUniqueOrThrow({ where: { id: f.user.id } });
    expect(after.tokenVersion).toBeGreaterThan(f.user.tokenVersion);
    const principal = await authenticateMcp(bearer(tokens.access_token), null);
    expect(principal.auth.actor.teamIds).toEqual([team.id]);
    expect((await refresh(f, tokens.refresh_token)).status).toBe(200);
  });

  it('keeps the connection on a non-admin role change, and access narrows live', async () => {
    const f = await fixture('RESPONDER', ['incidents:read']);
    const tokens = await access(f);
    const owner = await admin();
    await administerUser(f.user.id, { operation: 'set-role', role: 'USER' }, { id: owner.id });
    const principal = await authenticateMcp(bearer(tokens.access_token), null);
    expect(principal.auth.actor.role).toBe('USER');
    expect((await refresh(f, tokens.refresh_token)).status).toBe(200);
  });

  it('signs out on demotion from ADMIN with MCP_ACCESS_CHANGED, and refresh is refused', async () => {
    const f = await fixture('ADMIN', ['incidents:read']);
    const tokens = await access(f);
    const owner = await admin();
    await administerUser(f.user.id, { operation: 'set-role', role: 'RESPONDER' }, { id: owner.id });
    await expect(resolveMcpGrant(f.grant.id)).rejects.toThrow('MCP_ACCESS_CHANGED');
    const response = await mcpRequest(
      new Request(mcpResource(), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${tokens.access_token}`,
          'content-type': 'application/json',
        },
        body: '{}',
      })
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: 'MCP_ACCESS_CHANGED' });
    expect(response.headers.get('www-authenticate')).toContain('error="invalid_token"');
    const refused = await refresh(f, tokens.refresh_token);
    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({ error: 'invalid_grant' });
  });

  it('bumps only the demoted administrators in a bulk role change', async () => {
    const demoted = await fixture('ADMIN', ['incidents:read']);
    const responder = await fixture('RESPONDER', ['incidents:read']);
    await admin();
    await bulkUpdateUserSecurityState([demoted.user.id, responder.user.id], {
      role: 'USER',
      roleSource: 'MANUAL',
    });
    await expect(resolveMcpGrant(demoted.grant.id)).rejects.toThrow('MCP_ACCESS_CHANGED');
    await expect(resolveMcpGrant(responder.grant.id)).resolves.toBeTruthy();
  });

  it('signs out on sign-out everywhere and on deactivation, even after reactivation', async () => {
    const signedOut = await fixture('USER', ['incidents:read']);
    await revokeUserSessions(signedOut.user.id);
    await expect(resolveMcpGrant(signedOut.grant.id)).rejects.toThrow('MCP_ACCESS_CHANGED');

    const deactivated = await fixture('USER', ['incidents:read']);
    const owner = await admin();
    await administerUser(deactivated.user.id, { operation: 'deactivate' }, { id: owner.id });
    await administerUser(deactivated.user.id, { operation: 'reactivate' }, { id: owner.id });
    await expect(resolveMcpGrant(deactivated.grant.id)).rejects.toThrow('MCP_ACCESS_CHANGED');

    // Any departure from ACTIVE signs out, not only DISABLED.
    const invited = await fixture('USER', ['incidents:read']);
    await updateUserSecurityState(invited.user.id, { status: 'INVITED' });
    await updateUserSecurityState(invited.user.id, { status: 'ACTIVE' });
    await expect(resolveMcpGrant(invited.grant.id)).rejects.toThrow('MCP_ACCESS_CHANGED');

    const adminSignOut = await fixture('USER', ['incidents:read']);
    await administerUser(adminSignOut.user.id, { operation: 'revoke-sessions' }, { id: owner.id });
    await expect(resolveMcpGrant(adminSignOut.grant.id)).rejects.toThrow('MCP_ACCESS_CHANGED');
  });
});

describe('B2: transient token-endpoint failures are retryable, never invalid_grant', () => {
  beforeEach(() => {
    Object.assign(failures, { remaining: 0, code: 'P2034', wrapped: false, calls: 0 });
  });

  it.each([false, true])(
    'retries one serialization conflict and succeeds (wrapped by the library: %s)',
    async wrapped => {
      const f = await fixture();
      const tokens = await access(f);
      Object.assign(failures, { remaining: 1, code: 'P2034', wrapped, calls: 0 });
      const response = await refresh(f, tokens.refresh_token);
      expect(response.status).toBe(200);
      expect(failures.calls).toBe(2);
      expect(await grantRevoked(f)).toBe(false);
    }
  );

  it.each([
    ['P2034', false],
    ['P2024', true],
    ['P1001', false],
  ] as const)(
    'answers a persistent %s with 503 temporarily_unavailable and Retry-After',
    async (code, wrapped) => {
      const f = await fixture();
      const tokens = await access(f);
      Object.assign(failures, { remaining: 5, code, wrapped, calls: 0 });
      const response = await refresh(f, tokens.refresh_token);
      expect(response.status).toBe(503);
      expect(response.headers.get('retry-after')).toBeTruthy();
      expect(await response.json()).toMatchObject({ error: 'temporarily_unavailable' });
      // Only a conflict is retried, and only once.
      expect(failures.calls).toBe(code === 'P2034' ? 2 : 1);
      failures.remaining = 0;
      expect(await grantRevoked(f)).toBe(false);
      // The refresh token is still good once the database recovers.
      expect((await refresh(f, tokens.refresh_token)).status).toBe(200);
    }
  );

  it('keeps invalid_scope from the model and reports a bad request as invalid_request', async () => {
    const f = await fixture('ADMIN', ['incidents:read']);
    const tokens = await access(f);
    await db.mcpClient.update({ where: { id: f.client.id }, data: { scopes: [] } });
    const narrowed = await refresh(f, tokens.refresh_token);
    expect(await narrowed.json()).toEqual({ error: 'invalid_scope' });
    const malformed = await exchange({ grant_type: 'password', client_id: f.client.id });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ error: 'invalid_request' });
  });
});

describe('B3: refresh reuse grace window', () => {
  it('reissues on a replay within the window while the successor is unused', async () => {
    const f = await fixture();
    const first = await access(f);
    const lost = await refresh(f, first.refresh_token);
    expect(lost.status).toBe(200);
    const lostTokens: Tokens = await lost.json();
    // The client never saw that response and retries with the same refresh token.
    const retried = await refresh(f, first.refresh_token);
    expect(retried.status).toBe(200);
    const retriedTokens: Tokens = await retried.json();
    expect(await grantRevoked(f)).toBe(false);
    // The response the client never received is withdrawn; the retry's pair works.
    await expect(authenticateMcp(bearer(lostTokens.access_token), null)).rejects.toThrow(
      'MCP_INVALID_TOKEN'
    );
    await expect(authenticateMcp(bearer(retriedTokens.access_token), null)).resolves.toBeTruthy();
    expect((await refresh(f, retriedTokens.refresh_token)).status).toBe(200);
    expect(await grantRevoked(f)).toBe(false);
  });

  it('revokes the grant when the successor was already used', async () => {
    const f = await fixture();
    const first = await access(f);
    const next: Tokens = await (await refresh(f, first.refresh_token)).json();
    await authenticateMcp(bearer(next.access_token), null);
    const replay = await refresh(f, first.refresh_token);
    expect(replay.status).toBe(400);
    expect(await grantRevoked(f)).toBe(true);
  });

  it('revokes the grant on a replay after the window or with the window off', async () => {
    const late = await fixture();
    const lateFirst = await access(late);
    expect((await refresh(late, lateFirst.refresh_token)).status).toBe(200);
    await db.mcpToken.updateMany({
      where: { grantId: late.grant.id, rotatedAt: { not: null } },
      data: { rotatedAt: new Date(Date.now() - 31000) },
    });
    expect((await refresh(late, lateFirst.refresh_token)).status).toBe(400);
    expect(await grantRevoked(late)).toBe(true);

    await db.mcpPolicy.update({
      where: { id: 'default' },
      data: { refreshReuseGraceSeconds: 0 },
    });
    const off = await fixture();
    const offFirst = await access(off);
    expect((await refresh(off, offFirst.refresh_token)).status).toBe(200);
    expect((await refresh(off, offFirst.refresh_token)).status).toBe(400);
    expect(await grantRevoked(off)).toBe(true);
  });
});

describe('B5: a missing consent is told apart from a missing role', () => {
  it('names the missing scope when the role allows the operation', async () => {
    const f = await fixture('USER', ['incidents:read']);
    const ctx = await context(f);
    const error = await callMcpOperation(ctx, 'listServices', {}).catch(caught => caught);
    expect(error).toMatchObject({ code: 'MCP_SCOPE_NOT_GRANTED', status: 403 });
    expect(error.hint).toContain('services:read');
  });

  it('still answers MCP_OPERATION_FORBIDDEN when the role itself forbids it', async () => {
    const f = await fixture('AUDITOR', ['incidents:read', 'incidents:write']);
    const ctx = await context(f);
    await expect(
      callMcpOperation(ctx, 'createIncident', {
        body: { title: 'Auditor cannot', serviceId: 'svc', urgency: 'HIGH' },
        idempotencyKey: 'auditor-forbidden-1',
      })
    ).rejects.toThrow('MCP_OPERATION_FORBIDDEN');
  });

  it('lists role-allowed operations that need more consent in search_capabilities', async () => {
    const f = await fixture('USER', ['incidents:read']);
    const tokens = await access(f);
    const response = await mcpRequest(
      new Request(mcpResource(), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${tokens.access_token}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'mcp-protocol-version': '2026-07-28',
          'mcp-method': 'tools/call',
          'mcp-name': 'search_capabilities',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'search_capabilities',
            arguments: { query: 'list services' },
            _meta: {
              'io.modelcontextprotocol/protocolVersion': '2026-07-28',
              'io.modelcontextprotocol/clientInfo': { name: 'auth-resilience', version: '1' },
              'io.modelcontextprotocol/clientCapabilities': {},
            },
          },
        }),
      })
    );
    expect(response.status).toBe(200);
    const text = await response.text();
    const json = JSON.parse(
      text.startsWith('{')
        ? text
        : text
            .split('\n')
            .find(line => line.startsWith('data:'))!
            .slice(5)
    );
    const operations = json.result.structuredContent.operations as {
      operationId: string;
      requiresAdditionalConsent?: string[];
    }[];
    expect(operations.find(item => item.operationId === 'listServices')).toMatchObject({
      requiresAdditionalConsent: ['services:read'],
    });
  });
});

describe('B6: OAuth revocation compatibility', () => {
  it('accepts unknown parameters and hints, and advertises its auth method', async () => {
    const f = await fixture();
    const tokens = await access(f);
    const response = await revokeToken(
      new Request(`${origin}/oauth/mcp/revoke`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: f.client.id,
          token: tokens.refresh_token,
          token_type_hint: 'urn:example:unknown',
          vendor_extension: 'x',
        }).toString(),
      })
    );
    expect(response.status).toBe(200);
    expect(await grantRevoked(f)).toBe(true);
    const metadata = await (await authorizationMetadata()).json();
    expect(metadata.revocation_endpoint_auth_methods_supported).toEqual(['none']);
  });
});

describe('B7: bad-token limiter on /mcp', () => {
  it('refuses a peer after repeated bad tokens without a database lookup, and fails open', async () => {
    const peer = '203.0.113.77';
    const junk = 'x'.repeat(43);
    for (let i = 0; i < MCP_BAD_TOKEN_LIMIT; i++)
      await expect(authenticateMcp(bearer(junk, peer), null)).rejects.toThrow('MCP_INVALID_TOKEN');
    // The bearer, its grant and the policy are read in one raw statement (E4).
    const lookups = vi.spyOn(prisma, '$queryRaw');
    await expect(authenticateMcp(bearer(junk, peer), null)).rejects.toThrow('MCP_RATE_LIMITED');
    expect(lookups).not.toHaveBeenCalled();
    // Another peer, and a caller whose address is unknown, are unaffected.
    await expect(authenticateMcp(bearer(junk, '203.0.113.78'), null)).rejects.toThrow(
      'MCP_INVALID_TOKEN'
    );
    await expect(authenticateMcp(bearer(junk), null)).rejects.toThrow('MCP_INVALID_TOKEN');
  });

  it('never counts an expired or revoked token OpsKnight issued, so a shared address keeps working', async () => {
    const peer = '203.0.113.90';
    const f = await fixture('USER', ['incidents:read']);
    const stale = await access(f);
    await db.mcpToken.updateMany({
      where: { grantId: f.grant.id },
      data: { accessExpiresAt: new Date(Date.now() - 1000) },
    });
    for (let i = 0; i <= MCP_BAD_TOKEN_LIMIT; i++)
      await expect(authenticateMcp(bearer(stale.access_token, peer), null)).rejects.toThrow(
        'MCP_INVALID_TOKEN'
      );
    // A revoked connection retried from the same address is not junk either.
    const revoked = await fixture('USER', ['incidents:read']);
    const revokedTokens = await access(revoked);
    await revokeUserSessions(revoked.user.id);
    for (let i = 0; i <= MCP_BAD_TOKEN_LIMIT; i++)
      await expect(authenticateMcp(bearer(revokedTokens.access_token, peer), null)).rejects.toThrow(
        'MCP_ACCESS_CHANGED'
      );
    // Someone else behind the same address still connects.
    const live = await fixture('USER', ['incidents:read']);
    const liveTokens = await access(live);
    await expect(
      authenticateMcp(bearer(liveTokens.access_token, peer), null)
    ).resolves.toBeTruthy();
  });
});

describe('SEC-9 / OBS-3: token lifecycle is attributed, logged and counted', () => {
  const auditFor = (grantId: string, action: string) =>
    db.auditLog.findFirstOrThrow({ where: { action, entityId: grantId } });
  const metadataOf = (row: { details: unknown }) =>
    (row.details as { metadata: Record<string, unknown> }).metadata;

  it('names the user and client on a reuse revocation, and logs it', async () => {
    const { logger } = await import('@/lib/logger');
    const warn = vi.spyOn(logger, 'warn');
    const f = await fixture();
    const first = await access(f);
    const next: Tokens = await (await refresh(f, first.refresh_token)).json();
    await authenticateMcp(bearer(next.access_token), null);
    expect((await refresh(f, first.refresh_token)).status).toBe(400);
    const row = await auditFor(f.grant.id, 'mcp.grant.reuse_detected');
    expect(row.actorId).toBe(f.user.id);
    expect(metadataOf(row)).toMatchObject({
      clientId: f.client.id,
      clientName: 'MCP resilience',
      reason: 'refresh_token_reuse',
    });
    expect(warn).toHaveBeenCalledWith('mcp.token.refresh_reuse_revoked', { grantId: f.grant.id });
  });

  it('names the user and client on an RFC 7009 revocation', async () => {
    const f = await fixture();
    const tokens = await access(f);
    const response = await revokeToken(
      new Request(`${origin}/oauth/mcp/revoke`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-request-id': 'rv-1' },
        body: new URLSearchParams({
          client_id: f.client.id,
          token: tokens.access_token,
        }).toString(),
      })
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('X-Request-Id')).toBe('rv-1');
    const row = await auditFor(f.grant.id, 'mcp.grant.revoked');
    expect(row.actorId).toBe(f.user.id);
    expect(metadataOf(row)).toMatchObject({ clientId: f.client.id, via: 'rfc7009' });
  });

  it('logs a grace reissue without an audit row', async () => {
    const { logger } = await import('@/lib/logger');
    const warn = vi.spyOn(logger, 'warn');
    const f = await fixture();
    const first = await access(f);
    expect((await refresh(f, first.refresh_token)).status).toBe(200);
    const auditsBefore = await db.auditLog.count({ where: { entityId: f.grant.id } });
    expect((await refresh(f, first.refresh_token)).status).toBe(200);
    expect(warn).toHaveBeenCalledWith(
      'mcp.token.grace_reissued',
      expect.objectContaining({ grantId: f.grant.id })
    );
    expect(await db.auditLog.count({ where: { entityId: f.grant.id } })).toBe(auditsBefore);
  });

  it('counts token responses by the outcome actually sent', async () => {
    const { clearRuntimeOperationalMetrics, runtimeOperationalMetrics } =
      await import('@/lib/metrics/operational/registry');
    clearRuntimeOperationalMetrics();
    const f = await fixture();
    await access(f);
    expect((await refresh(f, 'x'.repeat(43))).status).toBe(400);
    const rows = runtimeOperationalMetrics().get('opsknight_mcp_oauth_requests_total') ?? [];
    const value = (outcome: string) =>
      rows.find(row => row.labels.endpoint === 'token' && row.labels.outcome === outcome)?.value;
    expect(value('issued')).toBe(1);
    expect(value('invalid_grant')).toBe(1);
  });
});

describe('OBS-11: MCP_FORCE_DISABLED overrides an enabled policy', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('refuses token refresh and bearer use, and hides registration from discovery', async () => {
    const f = await fixture();
    const tokens = await access(f);
    await db.mcpPolicy.update({
      where: { id: 'default' },
      data: { dcrEnabled: true, dcrScopes: ['incidents:read'] },
    });
    // Discovery reads a short-lived policy memo (W1 SEC-12); a direct write must clear it.
    clearDiscoveryPolicyCache();
    expect((await (await authorizationMetadata()).json()).registration_endpoint).toBeDefined();
    vi.stubEnv('MCP_FORCE_DISABLED', 'true');
    const refused = await refresh(f, tokens.refresh_token);
    expect(refused.status).toBe(503);
    expect((await refused.json()).error).toBe('MCP_DISABLED');
    await expect(authenticateMcp(bearer(tokens.access_token), null)).rejects.toThrow(
      'MCP_DISABLED'
    );
    const metadata = await (await authorizationMetadata()).json();
    expect(metadata.registration_endpoint).toBeUndefined();
    expect(metadata.scopes_supported).toBeUndefined();
    vi.unstubAllEnvs();
    await expect(authenticateMcp(bearer(tokens.access_token), null)).resolves.toBeTruthy();
  });
});
