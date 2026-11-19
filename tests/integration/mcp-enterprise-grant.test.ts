// @vitest-environment node
import { randomBytes, randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SignJWT, exportJWK, generateKeyPair, type KeyLike } from 'jose';
import { createTestUser, resetDatabase, testPrisma as db } from '../helpers/test-db';
import { POST as tokenEndpoint } from '@/app/oauth/mcp/token/route';
import { GET as authorizationMetadata } from '@/app/.well-known/oauth-authorization-server/oauth/mcp/route';
import { POST as mcpRequest } from '@/app/mcp/route';
import { mcpIssuer, mcpResource, resetMcpRuntimeForTests } from '@/lib/mcp/auth/config';
import { clearDiscoveryPolicyCache } from '@/lib/mcp/auth/discovery-policy';
import { resetMcpAdmissionForTests } from '@/lib/mcp/auth/admission';
import { mcpScopesUsableByRole } from '@/lib/mcp/auth/role-scopes';
import {
  MCP_ID_JAG_PROFILE,
  MCP_JWT_BEARER_GRANT,
  resetMcpEnterpriseJwksCacheForTests,
} from '@/lib/mcp/auth/enterprise-grant';
import { encrypt } from '@/lib/encryption';
import { resetOidcConfigCache } from '@/lib/oidc-config';
import { logger } from '@/lib/logger';

const ISSUER = 'https://idp.example.test';
const jwks = vi.hoisted(() => ({ body: '{"keys":[]}', fetches: 0 }));

vi.mock('@/lib/oidc-validation', () => ({
  getValidatedOidcRuntimeMetadata: vi.fn(async (issuer: string) => ({
    isValid: true,
    metadata: {
      issuer,
      authorizationEndpoint: `${issuer}/authorize`,
      tokenEndpoint: `${issuer}/token`,
      jwksUri: `${issuer}/jwks`,
    },
  })),
}));
// The IdP's key set is served through the same outbound-fetch seam SSO uses.
vi.mock('@/lib/network-security', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/network-security')>()),
  safeOutboundFetch: vi.fn(async (url: string) => {
    if (url !== 'https://idp.example.test/jwks') throw new Error(`unexpected fetch ${url}`);
    jwks.fetches += 1;
    return new Response(jwks.body, { headers: { 'content-type': 'application/json' } });
  }),
}));

const origin = 'http://localhost:3000';
const CLIENT_SCOPES = ['incidents:read', 'incidents:write', 'services:read', 'audit:read'];
let signingKey: KeyLike;
let strangerKey: KeyLike;

beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (!url.pathname.endsWith('_test') || !['localhost', '127.0.0.1'].includes(url.hostname))
    throw new Error('Owned local PostgreSQL required');
  process.env.MCP_PUBLIC_ORIGIN = origin;
  process.env.MCP_DATABASE_URL = process.env.DATABASE_URL;
  process.env.ENCRYPTION_KEY = randomBytes(32).toString('hex');
  delete process.env.ENCRYPTION_KEYS;
  await resetDatabase();
  const pair = await generateKeyPair('RS256');
  signingKey = pair.privateKey;
  strangerKey = (await generateKeyPair('RS256')).privateKey;
  const publicJwk = {
    ...(await exportJWK(pair.publicKey)),
    kid: 'idp-1',
    use: 'sig',
    alg: 'RS256',
  };
  jwks.body = JSON.stringify({ keys: [publicJwk] });
}, 60000);

async function setPolicy(data: Record<string, unknown> = {}) {
  const policy = {
    enabled: true,
    writesEnabled: true,
    requestsPerMinute: 600,
    enterpriseManagedAuthEnabled: true,
    ...data,
  };
  await db.mcpPolicy.upsert({ where: { id: 'default' }, create: policy, update: policy });
  clearDiscoveryPolicyCache();
}

async function setSso(enabled = true) {
  const data = {
    issuer: ISSUER,
    clientId: 'opsknight',
    clientSecret: await encrypt('s3cret'),
    enabled,
    // The table requires who configured it.
    updatedBy: (await createTestUser({ role: 'ADMIN' })).id,
  };
  await db.oidcConfig.upsert({ where: { id: 'default' }, create: data, update: data });
  resetOidcConfigCache();
}

beforeEach(async () => {
  resetMcpRuntimeForTests();
  resetMcpAdmissionForTests();
  resetMcpEnterpriseJwksCacheForTests();
  await db.rateLimit.deleteMany({ where: { key: { startsWith: 'mcp:' } } });
  await db.mcpGrant.deleteMany();
  await db.mcpClient.deleteMany();
  await db.oidcIdentity.deleteMany();
  await db.oidcConfig.deleteMany();
  await setPolicy();
  await setSso();
});

const assistant = () =>
  db.mcpClient.create({
    data: {
      name: 'Corp assistant',
      scopes: CLIENT_SCOPES,
      redirectUris: ['http://127.0.0.1:8765/cb'],
    },
  });

async function person(role: 'ADMIN' | 'RESPONDER' | 'USER' = 'RESPONDER', status = 'ACTIVE') {
  const user = await createTestUser({ role, status: status as 'ACTIVE' });
  const subject = `sub-${randomUUID()}`;
  await db.oidcIdentity.create({ data: { issuer: ISSUER, subject, userId: user.id } });
  return { user, subject };
}

type Claims = Record<string, unknown>;
async function idJag(
  claims: Claims,
  options: { key?: KeyLike; typ?: string; kid?: string; iat?: number } = {}
) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ jti: randomUUID(), ...claims })
    .setProtectedHeader({
      alg: 'RS256',
      typ: options.typ ?? 'oauth-id-jag+jwt',
      kid: options.kid ?? 'idp-1',
    })
    .setIssuedAt(options.iat ?? now)
    .setExpirationTime((options.iat ?? now) + 300)
    .sign(options.key ?? signingKey);
}

const baseClaims = (clientId: string, subject: string): Claims => ({
  iss: ISSUER,
  sub: subject,
  aud: mcpIssuer(),
  client_id: clientId,
  resource: mcpResource(),
  scope: 'incidents:read incidents:write audit:read runbooks:execute',
});

async function exchange(assertion: string, clientId: string, extra: Record<string, string> = {}) {
  const response = await tokenEndpoint(
    new Request(`${origin}/oauth/mcp/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: MCP_JWT_BEARER_GRANT,
        assertion,
        client_id: clientId,
        ...extra,
      }),
    })
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

function whoami(bearer: string) {
  return mcpRequest(
    new Request(mcpResource(), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${bearer}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2026-07-28',
        'mcp-method': 'tools/call',
        'mcp-name': 'whoami',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'whoami',
          arguments: {},
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2026-07-28',
            'io.modelcontextprotocol/clientCapabilities': {},
            'io.modelcontextprotocol/clientInfo': { name: 'ema-test', version: '1' },
          },
        },
      }),
    })
  );
}

describe('ID-JAG exchange (JWT bearer grant)', () => {
  it('issues an access token with clamped scopes, marks the grant and audits it', async () => {
    const client = await assistant();
    const { user, subject } = await person('RESPONDER');
    const issued = await exchange(await idJag(baseClaims(client.id, subject)), client.id);
    expect(issued.status).toBe(200);
    // IdP grant ∩ assistant ceiling ∩ role: runbooks:execute is outside the ceiling.
    const expected = ['incidents:read', 'incidents:write', 'audit:read'].filter(scope =>
      mcpScopesUsableByRole('RESPONDER').has(scope)
    );
    expect(String(issued.body.scope).split(' ').sort()).toEqual(expected.sort());
    expect(issued.body).toMatchObject({ token_type: 'Bearer', expires_in: 300 });
    // draft-ietf-oauth-identity-assertion-authz-grant-06 §4.4.4: no refresh token.
    expect(issued.body).not.toHaveProperty('refresh_token');
    const grant = await db.mcpGrant.findFirstOrThrow({ where: { clientId: client.id } });
    expect(grant).toMatchObject({ kind: 'IDP', userId: user.id, resource: mcpResource() });
    const me = await whoami(String(issued.body.access_token));
    expect(me.status).toBe(200);
    expect(await me.text()).toContain(`"userId":"${user.id}"`);
    expect(
      await db.auditLog.count({ where: { action: 'mcp.grant.idp_granted', entityId: grant.id } })
    ).toBe(1);
  });

  it('the scope parameter narrows further; a role that can use none is refused', async () => {
    const client = await assistant();
    const { subject } = await person('RESPONDER');
    const narrowed = await exchange(await idJag(baseClaims(client.id, subject)), client.id, {
      scope: 'incidents:read',
    });
    expect(narrowed.body.scope).toBe('incidents:read');
    const none = await exchange(
      await idJag({ ...baseClaims(client.id, subject), scope: 'runbooks:execute' }),
      client.id
    );
    expect(none).toEqual({ status: 400, body: { error: 'invalid_scope' } });
  });

  it('renewal: a fresh ID-JAG renews access on the same connection with the IdP current scopes', async () => {
    const client = await assistant();
    const { subject } = await person('ADMIN');
    const first = await exchange(await idJag(baseClaims(client.id, subject)), client.id);
    expect(first.status).toBe(200);
    const second = await exchange(
      await idJag({ ...baseClaims(client.id, subject), scope: 'incidents:read' }),
      client.id
    );
    expect(second).toMatchObject({ status: 200, body: { scope: 'incidents:read' } });
    expect(await db.mcpGrant.count()).toBe(1);
    expect((await db.mcpGrant.findFirstOrThrow()).scopes).toEqual(['incidents:read']);
    expect(await db.mcpToken.count()).toBe(2);
    expect((await whoami(String(second.body.access_token))).status).toBe(200);
  });
});

describe('refusals: the right OAuth error and no grant', () => {
  type Case = [
    string,
    (ctx: { clientId: string; subject: string }) => Promise<[string, string?]>,
    number,
    string,
  ];
  const cases: Case[] = [
    [
      'wrong signature',
      async c => [await idJag(baseClaims(c.clientId, c.subject), { key: strangerKey })],
      400,
      'invalid_grant',
    ],
    [
      'alg none',
      async c => {
        const enc = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
        const now = Math.floor(Date.now() / 1000);
        return [
          `${enc({ alg: 'none', typ: 'oauth-id-jag+jwt' })}.${enc({ ...baseClaims(c.clientId, c.subject), jti: randomUUID(), iat: now, exp: now + 300 })}.`,
        ];
      },
      400,
      'invalid_grant',
    ],
    [
      'wrong typ',
      async c => [await idJag(baseClaims(c.clientId, c.subject), { typ: 'JWT' })],
      400,
      'invalid_grant',
    ],
    [
      'wrong iss',
      async c => [
        await idJag({ ...baseClaims(c.clientId, c.subject), iss: 'https://evil.example.test' }),
      ],
      400,
      'invalid_grant',
    ],
    [
      'wrong aud',
      async c => [
        await idJag({ ...baseClaims(c.clientId, c.subject), aud: 'https://other.example.test' }),
      ],
      400,
      'invalid_grant',
    ],
    [
      'aud array with extra entries',
      async c => [
        await idJag({
          ...baseClaims(c.clientId, c.subject),
          aud: [mcpIssuer(), 'https://other.example.test'],
        }),
      ],
      400,
      'invalid_grant',
    ],
    [
      'wrong resource',
      async c => [
        await idJag({
          ...baseClaims(c.clientId, c.subject),
          resource: 'https://other.example.test/mcp',
        }),
      ],
      400,
      'invalid_grant',
    ],
    [
      'expired',
      async c => [
        await idJag(baseClaims(c.clientId, c.subject), {
          iat: Math.floor(Date.now() / 1000) - 400,
        }),
      ],
      400,
      'invalid_grant',
    ],
    [
      'not yet valid',
      async c => [
        await idJag({
          ...baseClaims(c.clientId, c.subject),
          nbf: Math.floor(Date.now() / 1000) + 600,
        }),
      ],
      400,
      'invalid_grant',
    ],
    [
      'missing jti',
      async c => [await idJag({ ...baseClaims(c.clientId, c.subject), jti: undefined })],
      400,
      'invalid_grant',
    ],
    [
      'proof-of-possession binding',
      async c => [await idJag({ ...baseClaims(c.clientId, c.subject), cnf: { jkt: 'x' } })],
      400,
      'invalid_grant',
    ],
    [
      'unknown subject',
      async c => [await idJag({ ...baseClaims(c.clientId, c.subject), sub: 'nobody' })],
      400,
      'invalid_grant',
    ],
    [
      'client mismatch',
      async c => [
        await idJag({ ...baseClaims(c.clientId, c.subject), client_id: 'another-client' }),
      ],
      400,
      'invalid_grant',
    ],
    [
      'unknown client',
      async c => [await idJag({ ...baseClaims('not-registered', c.subject) }), 'not-registered'],
      401,
      'invalid_client',
    ],
  ];
  // The client sees only the code; the log says which check refused it.
  const reasons = new Map(
    Object.entries({
      'aud array with extra entries': 'claims_malformed',
      'wrong resource': 'resource_mismatch',
      'proof-of-possession binding': 'cnf_unsupported',
      'unknown subject': 'subject_not_active',
      'client mismatch': 'client_mismatch',
      'unknown client': 'client_unknown',
    })
  );
  for (const [name, build, status, error] of cases)
    it(name, async () => {
      const client = await assistant();
      const { subject } = await person();
      const [assertion, clientId] = await build({ clientId: client.id, subject });
      const warn = vi.spyOn(logger, 'warn');
      expect(await exchange(assertion, clientId ?? client.id)).toEqual({ status, body: { error } });
      expect(warn).toHaveBeenCalledWith(
        'mcp.token.id_jag_refused',
        expect.objectContaining({ reason: reasons.get(name) ?? 'verification_failed', error })
      );
      warn.mockRestore();
      expect(await db.mcpGrant.count()).toBe(0);
    });

  it('inactive person', async () => {
    const client = await assistant();
    const { subject } = await person('RESPONDER', 'DISABLED');
    expect(await exchange(await idJag(baseClaims(client.id, subject)), client.id)).toEqual({
      status: 400,
      body: { error: 'invalid_grant' },
    });
    expect(await db.mcpGrant.count()).toBe(0);
  });

  it('replayed jti: the second exchange of the same assertion is refused', async () => {
    const client = await assistant();
    const { subject } = await person();
    const assertion = await idJag(baseClaims(client.id, subject));
    expect((await exchange(assertion, client.id)).status).toBe(200);
    expect(await exchange(assertion, client.id)).toEqual({
      status: 400,
      body: { error: 'invalid_grant' },
    });
    expect(await db.mcpToken.count()).toBe(1);
  });

  it('two exchanges of one assertion at once: exactly one token', async () => {
    const client = await assistant();
    const { subject } = await person();
    const assertion = await idJag(baseClaims(client.id, subject));
    const results = await Promise.all([
      exchange(assertion, client.id),
      exchange(assertion, client.id),
    ]);
    expect(results.filter(result => result.status === 200)).toHaveLength(1);
    expect(await db.mcpToken.count()).toBe(1);
  });

  it('switch off or SSO off: unsupported_grant_type, no grant, not advertised', async () => {
    const client = await assistant();
    const { subject } = await person();
    let metadata = (await (await authorizationMetadata()).json()) as Record<string, unknown>;
    expect(metadata.grant_types_supported).toContain(MCP_JWT_BEARER_GRANT);
    expect(metadata.authorization_grant_profiles_supported).toEqual([MCP_ID_JAG_PROFILE]);

    await setPolicy({ enterpriseManagedAuthEnabled: false });
    expect(await exchange(await idJag(baseClaims(client.id, subject)), client.id)).toMatchObject({
      status: 400,
      body: { error: 'unsupported_grant_type' },
    });
    metadata = (await (await authorizationMetadata()).json()) as Record<string, unknown>;
    expect(metadata.grant_types_supported).toEqual(['authorization_code', 'refresh_token']);
    expect(metadata).not.toHaveProperty('authorization_grant_profiles_supported');

    await setPolicy({ enterpriseManagedAuthEnabled: true });
    await setSso(false);
    expect(await exchange(await idJag(baseClaims(client.id, subject)), client.id)).toMatchObject({
      status: 400,
      body: { error: 'unsupported_grant_type' },
    });
    metadata = (await (await authorizationMetadata()).json()) as Record<string, unknown>;
    expect(metadata.grant_types_supported).toEqual(['authorization_code', 'refresh_token']);

    await db.oidcConfig.deleteMany();
    expect(
      (await exchange(await idJag(baseClaims(client.id, subject)), client.id)).body.error
    ).toBe('unsupported_grant_type');
    expect(await db.mcpGrant.count()).toBe(0);
  });
});

describe('IdP key set', () => {
  it('is cached; an unknown key id refetches at most once in the window', async () => {
    const client = await assistant();
    const { subject } = await person();
    const before = jwks.fetches;
    expect((await exchange(await idJag(baseClaims(client.id, subject)), client.id)).status).toBe(
      200
    );
    expect((await exchange(await idJag(baseClaims(client.id, subject)), client.id)).status).toBe(
      200
    );
    expect(jwks.fetches - before).toBe(1);
    expect(
      (await exchange(await idJag(baseClaims(client.id, subject), { kid: 'rotated' }), client.id))
        .body.error
    ).toBe('invalid_grant');
    expect(jwks.fetches - before).toBe(1);
  });
});
