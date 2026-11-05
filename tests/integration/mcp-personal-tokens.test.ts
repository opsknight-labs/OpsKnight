import { createHash, randomBytes } from 'node:crypto';
import OAuth2Server from '@node-oauth/oauth2-server';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestUser, resetDatabase, testPrisma as db } from '../helpers/test-db';
import { fixture, scopes as approvalScopes } from '../helpers/mcp-approval';
import { GET as authorize } from '@/app/oauth/mcp/authorize/route';
import { POST as mcpRoute } from '@/app/mcp/route';
import { digestMcpSecret, mcpResource, resetMcpRuntimeForTests } from '@/lib/mcp/auth/config';
import { authenticateMcp } from '@/lib/mcp/auth/principal';
import { createMcpOAuthModel, mcpOAuthServer } from '@/lib/mcp/auth/oauth-model';
import {
  MCP_PAT_CLIENT_ID,
  MCP_PAT_PER_USER_LIMIT,
  MCP_PAT_PREFIX,
  createMcpPersonalToken,
  mcpPatExpiryChoices,
  mcpPatScopeChoices,
} from '@/lib/mcp/auth/personal-tokens';
import { cleanupMcpCredentials, notifyExpiringMcpPersonalTokens } from '@/lib/mcp/auth/retention';
import { loadMcpOperationReview } from '@/lib/mcp/approvals/operation';
import { MCP_CATALOG } from '@/lib/mcp/catalog';
import { inAppNotificationHref } from '@/lib/notification-links';

const actor = vi.hoisted(() => ({
  id: '',
  role: 'ADMIN',
  email: '',
  name: 'Test User',
  status: 'ACTIVE',
  tokenVersion: 0,
  location: '',
  authenticatedAt: 0 as number | undefined,
}));
vi.mock('@/lib/rbac', () => ({
  getCurrentUser: vi.fn(async () => actor),
  getUserPermissions: vi.fn(async () => ({
    ...actor,
    authenticated: true,
    isAdmin: actor.role === 'ADMIN',
    capabilities: actor.role === 'ADMIN' ? ['admin.manage'] : [],
  })),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    actor.location = url;
  }),
}));
vi.mock('next-auth', async original => ({
  ...(await original<typeof import('next-auth')>()),
  getServerSession: vi.fn(async () => ({
    user: { id: actor.id },
    authenticatedAt: actor.authenticatedAt,
  })),
}));

const origin = 'http://localhost:3000';
const READS = ['incidents:read', 'services:read', 'schedules:read'];
const basePolicy = {
  enabled: true,
  writesEnabled: true,
  requestsPerMinute: 600,
  patEnabled: true,
  patMaxDays: 30,
  patAllowedScopes: [...READS, 'incidents:write', 'runbooks:execute', 'runbooks:read'],
  requireReadOnlyConnections: false,
};

beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (!url.pathname.endsWith('_test') || !['localhost', '127.0.0.1'].includes(url.hostname))
    throw new Error('Owned local PostgreSQL required');
  process.env.MCP_PUBLIC_ORIGIN = origin;
  process.env.MCP_DATABASE_URL = process.env.DATABASE_URL;
  process.env.ENCRYPTION_KEY = randomBytes(32).toString('hex');
  delete process.env.ENCRYPTION_KEYS;
  await resetDatabase();
}, 60000);
beforeEach(async () => {
  resetMcpRuntimeForTests();
  await db.rateLimit.deleteMany({ where: { key: { startsWith: 'mcp:' } } });
  await db.mcpOperationApproval.deleteMany();
  await db.inAppNotification.deleteMany();
  await db.mcpConsentRequest.deleteMany();
  await db.mcpGrant.deleteMany();
  await db.mcpClient.deleteMany();
  await db.mcpPolicy.deleteMany();
  await db.mcpPolicy.create({ data: { id: 'default', ...basePolicy } });
});

async function signIn(role: 'ADMIN' | 'RESPONDER' | 'USER' = 'ADMIN') {
  const user = await createTestUser({ role });
  Object.assign(actor, {
    id: user.id,
    role,
    email: user.email,
    tokenVersion: user.tokenVersion,
    location: '',
    authenticatedAt: Date.now(),
  });
  return user;
}

const fresh = (): { id: string; tokenVersion: number; authenticatedAt: number | undefined } => ({
  id: actor.id,
  tokenVersion: actor.tokenVersion,
  authenticatedAt: Date.now(),
});

async function createToken(
  input: Partial<{ label: string; scopes: string[]; expiresInDays: number }> = {},
  who = fresh()
) {
  return db.$transaction(tx =>
    createMcpPersonalToken(
      tx,
      { label: 'CI triage', scopes: ['incidents:read'], expiresInDays: 30, ...input },
      who
    )
  );
}

async function created(input: Parameters<typeof createToken>[0] = {}) {
  const result = await createToken(input);
  if (!result.ok) throw new Error(`token not created: ${result.code}`);
  return result;
}

const bearerRequest = (token: string) =>
  new Request(`${origin}/mcp`, { headers: { authorization: `Bearer ${token}` } });

let rpcId = 0;
async function rpc(token: string, method: string, params: Record<string, unknown> = {}) {
  const response = await mcpRoute(
    new Request(mcpResource(), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2026-07-28',
        'mcp-method': method,
        ...(typeof params.name === 'string' ? { 'mcp-name': params.name } : {}),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: ++rpcId,
        method,
        params: {
          ...params,
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2026-07-28',
            'io.modelcontextprotocol/clientCapabilities': {},
            'io.modelcontextprotocol/clientInfo': { name: 'pat-test', version: '1' },
          },
        },
      }),
    })
  );
  const text = await response.text();
  const body = (response.headers.get('content-type') ?? '').includes('text/event-stream')
    ? text
        .split('\n')
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).trim())
        .at(-1)!
    : text;
  return { status: response.status, body: JSON.parse(body) };
}
async function toolNames(token: string) {
  const { status, body } = await rpc(token, 'tools/list');
  expect(status).toBe(200);
  return (body.result.tools as { name: string }[]).map(tool => tool.name);
}

/** An ordinary OAuth connection with these scopes, and its access token. */
async function oauthConnection(userId: string, scopes: string[]) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  const client = await db.mcpClient.create({
    data: { name: 'Manual client', scopes, redirectUris: ['http://127.0.0.1:9911/callback'] },
  });
  const grant = await db.mcpGrant.create({
    data: {
      clientId: client.id,
      userId,
      userTokenVersion: user.tokenVersion,
      userRevocationVersion: user.mcpRevocationVersion,
      scopes,
      resource: mcpResource(),
      expiresAt: new Date(Date.now() + 3600000),
    },
  });
  const bearer = randomBytes(32).toString('base64url');
  await db.mcpToken.create({
    data: {
      grantId: grant.id,
      scopes,
      accessHash: digestMcpSecret(bearer),
      refreshHash: digestMcpSecret(randomBytes(32).toString('base64url')),
      accessExpiresAt: new Date(Date.now() + 3600000),
      refreshExpiresAt: new Date(Date.now() + 3600000),
    },
  });
  return { client, grant, bearer };
}

async function policyForm(fields: Record<string, string | string[]>) {
  const { updateMcpPolicy } = await import('@/app/(app)/settings/integrations/mcp/actions');
  const form = new FormData();
  const values: Record<string, string | string[]> = {
    enabled: 'on',
    writesEnabled: 'on',
    maxInFlight: '4',
    maxOperations: '8',
    requestsPerMinute: '600',
    sessionIdleDays: '30',
    patControls: '1',
    ...fields,
  };
  for (const [key, value] of Object.entries(values))
    for (const item of [value].flat()) form.append(key, item);
  return updateMcpPolicy(form);
}

describe('personal access token creation', () => {
  it('shows the token once with a scanner prefix and stores only its digest', async () => {
    const user = await signIn('ADMIN');
    const result = await created({ scopes: ['incidents:read', 'services:read'] });
    expect(result.token.startsWith(MCP_PAT_PREFIX)).toBe(true);
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{32,256}$/);
    const grant = await db.mcpGrant.findUniqueOrThrow({
      where: { id: result.grantId },
      include: { tokens: true },
    });
    expect(grant).toMatchObject({
      kind: 'PAT',
      label: 'CI triage',
      userId: user.id,
      clientId: MCP_PAT_CLIENT_ID,
      scopes: ['incidents:read', 'services:read'],
    });
    expect(grant.absoluteExpiresAt).toEqual(grant.expiresAt);
    expect(grant.tokens).toHaveLength(1);
    expect(grant.tokens[0]!.accessHash).toBe(digestMcpSecret(result.token));
    expect(grant.tokens[0]!.accessExpiresAt).toEqual(grant.expiresAt);
    // Nothing anywhere stores the raw token.
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: 'mcp.pat.created' } });
    expect(JSON.stringify(audit)).not.toContain(result.token);
    expect(JSON.stringify(grant)).not.toContain(result.token);
  });

  it('needs a recent sign-in and personal tokens turned on', async () => {
    await signIn('ADMIN');
    expect(
      await createToken({}, { ...fresh(), authenticatedAt: Date.now() - 3 * 3600_000 })
    ).toEqual({ ok: false, code: 'MCP_REAUTHENTICATION_REQUIRED' });
    expect(await createToken({}, { ...fresh(), authenticatedAt: undefined })).toMatchObject({
      ok: false,
      code: 'MCP_REAUTHENTICATION_REQUIRED',
    });
    await db.mcpPolicy.update({ where: { id: 'default' }, data: { patEnabled: false } });
    expect(await createToken()).toMatchObject({ ok: false, code: 'MCP_PAT_DISABLED' });
    await db.mcpPolicy.update({ where: { id: 'default' }, data: { enabled: false } });
    expect(await createToken()).toMatchObject({ ok: false, code: 'MCP_DISABLED' });
    expect(await db.mcpGrant.count()).toBe(0);
  });

  it('limits scopes to policy ∩ role, never runbooks:execute, and expiry to the policy maximum', async () => {
    await signIn('USER');
    const policy = await db.mcpPolicy.findUniqueOrThrow({ where: { id: 'default' } });
    expect(mcpPatScopeChoices(policy, 'USER')).not.toContain('runbooks:execute');
    expect(mcpPatScopeChoices(policy, 'ADMIN')).not.toContain('runbooks:execute');
    expect(mcpPatScopeChoices(policy, 'ADMIN')).toContain('incidents:write');
    expect(await createToken({ scopes: ['runbooks:execute'] })).toMatchObject({
      ok: false,
      code: 'MCP_INVALID_SCOPE',
    });
    // Not in the policy list.
    expect(await createToken({ scopes: ['audit:read'] })).toMatchObject({
      ok: false,
      code: 'MCP_INVALID_SCOPE',
    });
    expect(await createToken({ scopes: [] })).toMatchObject({ code: 'MCP_INVALID_SCOPE' });
    expect(await createToken({ expiresInDays: 31 })).toMatchObject({
      code: 'MCP_PAT_INVALID_EXPIRY',
    });
    expect(await createToken({ expiresInDays: 0 })).toMatchObject({
      code: 'MCP_PAT_INVALID_EXPIRY',
    });
    expect(await createToken({ label: '   ' })).toMatchObject({ code: 'MCP_INVALID_NAME' });
    expect(mcpPatExpiryChoices({ patMaxDays: 30 })).toEqual([7, 30]);
    expect(mcpPatExpiryChoices({ patMaxDays: 90 })).toEqual([7, 30, 60, 90]);
    // A read-only requirement offers reads only.
    expect(
      mcpPatScopeChoices({ ...policy, requireReadOnlyConnections: true }, 'ADMIN').every(scope =>
        scope.endsWith(':read')
      )
    ).toBe(true);
    const ok = await created({ expiresInDays: 30 });
    const days = (ok.expiresAt.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThanOrEqual(30);
  });

  it('caps the number of live tokens per person', async () => {
    await signIn('USER');
    for (let index = 0; index < MCP_PAT_PER_USER_LIMIT; index++) await created();
    expect(await createToken()).toMatchObject({ ok: false, code: 'MCP_PAT_LIMIT_REACHED' });
  });

  it('the settings action takes the sign-in time from the session, never the form', async () => {
    const { createMcpPersonalAccessToken } =
      await import('@/app/(app)/settings/integrations/mcp/actions');
    await signIn('ADMIN');
    const form = new FormData();
    form.set('label', 'n8n');
    form.append('scopes', 'incidents:read');
    form.set('expiresInDays', '7');
    form.set('authenticatedAt', String(Date.now()));
    actor.authenticatedAt = Date.now() - 3 * 3600_000;
    // An unknown field is refused outright.
    await expect(createMcpPersonalAccessToken(form)).resolves.toMatchObject({ ok: false });
    form.delete('authenticatedAt');
    expect(await createMcpPersonalAccessToken(form)).toEqual({
      ok: false,
      code: 'MCP_REAUTHENTICATION_REQUIRED',
    });
    actor.authenticatedAt = Date.now();
    const result = await createMcpPersonalAccessToken(form);
    expect(result).toMatchObject({ ok: true, scopes: ['incidents:read'] });
  });
});

describe('personal access tokens on the request path', () => {
  it('authenticates through the same bearer lookup and records the call like OAuth', async () => {
    await signIn('ADMIN');
    const { token, grantId } = await created({ scopes: ['incidents:read', 'incidents:write'] });
    const identity = await authenticateMcp(bearerRequest(token), 1);
    expect(identity).toMatchObject({ grantId, kind: 'PAT' });
    expect(identity.auth.apiKey.scopes.sort()).toEqual(['incidents:read', 'incidents:write']);
    const usage = await db.mcpToken.findFirstOrThrow({ where: { grantId } });
    expect(usage.lastUsedAt).not.toBeNull();
    // The per-grant quota applies to personal tokens too.
    const quota = await db.rateLimit.aggregate({
      where: { key: { startsWith: `mcp:${grantId}` } },
      _sum: { count: true },
    });
    expect(quota._sum.count).toBeGreaterThan(0);
  });

  it('caps a token live by the allowed list and drops it the moment tokens are turned off', async () => {
    await signIn('ADMIN');
    const { token } = await created({ scopes: ['incidents:read', 'incidents:write'] });
    await db.mcpPolicy.update({
      where: { id: 'default' },
      data: { patAllowedScopes: ['incidents:read'] },
    });
    expect((await authenticateMcp(bearerRequest(token), null)).auth.apiKey.scopes).toEqual([
      'incidents:read',
    ]);
    // Even an administrator listing runbooks:execute directly never gets it on a token.
    await db.mcpPolicy.update({
      where: { id: 'default' },
      data: { patAllowedScopes: ['incidents:read', 'runbooks:execute'] },
    });
    const grant = await db.mcpGrant.findFirstOrThrow({ where: { kind: 'PAT' } });
    await db.mcpGrant.update({
      where: { id: grant.id },
      data: { scopes: ['incidents:read', 'runbooks:execute'] },
    });
    await db.mcpToken.updateMany({
      where: { grantId: grant.id },
      data: { scopes: ['incidents:read', 'runbooks:execute'] },
    });
    expect((await authenticateMcp(bearerRequest(token), null)).auth.apiKey.scopes).toEqual([
      'incidents:read',
    ]);
    await db.mcpPolicy.update({ where: { id: 'default' }, data: { patEnabled: false } });
    await expect(authenticateMcp(bearerRequest(token), null)).rejects.toMatchObject({
      code: 'MCP_INVALID_GRANT',
    });
  });

  it('turning tokens off in the policy revokes them for good, and leaves OAuth alone', async () => {
    const user = await signIn('ADMIN');
    const { token, grantId } = await created();
    const oauth = await oauthConnection(user.id, ['incidents:read']);
    const policy = await db.mcpPolicy.findUniqueOrThrow({ where: { id: 'default' } });
    expect(
      await policyForm({ patMaxDays: '30', policyRevision: String(policy.policyRevision) })
    ).toMatchObject({ ok: true });
    const saved = await db.mcpPolicy.findUniqueOrThrow({ where: { id: 'default' } });
    expect(saved.patEnabled).toBe(false);
    expect((await db.mcpGrant.findUniqueOrThrow({ where: { id: grantId } })).revokedAt).not.toBe(
      null
    );
    expect(
      (await db.mcpGrant.findUniqueOrThrow({ where: { id: oauth.grant.id } })).revokedAt
    ).toBeNull();
    // Turning them back on does not bring the old token back.
    expect(
      await policyForm({
        patEnabled: 'on',
        patMaxDays: '30',
        patAllowedScopes: ['incidents:read'],
        policyRevision: String(saved.policyRevision),
      })
    ).toMatchObject({ ok: true });
    await expect(authenticateMcp(bearerRequest(token), null)).rejects.toMatchObject({
      code: 'MCP_INVALID_GRANT',
    });
    await expect(authenticateMcp(bearerRequest(oauth.bearer), null)).resolves.toBeTruthy();
  });

  it('the policy save keeps runbooks:execute off the list, starts from reads, and caps expiry at 90', async () => {
    await signIn('ADMIN');
    await db.mcpPolicy.update({
      where: { id: 'default' },
      data: { patEnabled: false, patAllowedScopes: [] },
    });
    let revision = (await db.mcpPolicy.findUniqueOrThrow({ where: { id: 'default' } }))
      .policyRevision;
    await policyForm({ patEnabled: 'on', patMaxDays: '60', policyRevision: String(revision) });
    let saved = await db.mcpPolicy.findUniqueOrThrow({ where: { id: 'default' } });
    expect(saved.patAllowedScopes.sort()).toEqual([...READS].sort());
    expect(saved.patMaxDays).toBe(60);
    revision = saved.policyRevision;
    await policyForm({
      patEnabled: 'on',
      patMaxDays: '30',
      patAllowedScopes: ['incidents:read', 'runbooks:execute'],
      policyRevision: String(revision),
    });
    saved = await db.mcpPolicy.findUniqueOrThrow({ where: { id: 'default' } });
    expect(saved.patAllowedScopes).toEqual(['incidents:read']);
    await expect(
      policyForm({
        patEnabled: 'on',
        patMaxDays: '91',
        policyRevision: String(saved.policyRevision),
      })
    ).rejects.toThrow();
    // A form without the personal-token controls keeps them as stored.
    const { updateMcpPolicy } = await import('@/app/(app)/settings/integrations/mcp/actions');
    const legacy = new FormData();
    for (const [key, value] of Object.entries({
      enabled: 'on',
      maxInFlight: '4',
      maxOperations: '8',
      requestsPerMinute: '600',
    }))
      legacy.set(key, value);
    await updateMcpPolicy(legacy);
    expect((await db.mcpPolicy.findUniqueOrThrow({ where: { id: 'default' } })).patEnabled).toBe(
      true
    );
  });

  it('revoke all includes personal tokens', async () => {
    await signIn('ADMIN');
    const { token } = await created();
    const { revokeAllMcpConnections } =
      await import('@/app/(app)/settings/integrations/mcp/actions');
    const form = new FormData();
    form.set('confirm', 'on');
    await revokeAllMcpConnections(form);
    await expect(authenticateMcp(bearerRequest(token), null)).rejects.toMatchObject({
      code: 'MCP_INVALID_GRANT',
    });
  });

  it('a token owner revokes it from Connections; the internal client cannot be revoked', async () => {
    await signIn('USER');
    const { token, grantId } = await created();
    const { revokeMcpAccess } = await import('@/app/(app)/settings/integrations/mcp/actions');
    const form = new FormData();
    form.set('kind', 'grant');
    form.set('id', grantId);
    await revokeMcpAccess(form);
    await expect(authenticateMcp(bearerRequest(token), null)).rejects.toMatchObject({
      code: 'MCP_INVALID_GRANT',
    });
    await signIn('ADMIN');
    const client = new FormData();
    client.set('kind', 'client');
    client.set('id', MCP_PAT_CLIENT_ID);
    await expect(revokeMcpAccess(client)).rejects.toMatchObject({ code: 'MCP_CLIENT_NOT_FOUND' });
  });

  it('no OAuth flow can use the internal client or refresh a personal token', async () => {
    const user = await signIn('ADMIN');
    const { grantId } = await created();
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: MCP_PAT_CLIENT_ID,
      redirect_uri: 'http://127.0.0.1:9911/callback',
      scope: 'incidents:read',
      state: randomBytes(24).toString('base64url'),
      code_challenge: createHash('sha256').update('v'.repeat(43)).digest('base64url'),
      code_challenge_method: 'S256',
      resource: mcpResource(),
    });
    const started = await authorize(new Request(`${origin}/oauth/mcp/authorize?${query}`));
    expect(started.headers.get('location') ?? '').not.toContain('/oauth/mcp/consent?id=');
    await db.$transaction(async tx => {
      const model = createMcpOAuthModel(tx, () => {});
      expect(await model.getClient(MCP_PAT_CLIENT_ID, '')).toBe(false);
      // Even with a real client, a personal token's grant is never valid for OAuth issuance.
      const other = await tx.mcpClient.create({
        data: { name: 'Other', scopes: ['incidents:read'], redirectUris: [] },
      });
      await expect(
        model.validateScope!({ id: user.id, grantId }, { id: other.id, grants: [] }, [
          'incidents:read',
        ])
      ).rejects.toMatchObject({ code: 'invalid_grant' });
      const server = mcpOAuthServer(tx, () => {});
      await expect(
        server.authorize(
          new OAuth2Server.Request({
            method: 'GET',
            headers: {},
            body: {},
            query: Object.fromEntries(query),
          }),
          new OAuth2Server.Response(),
          {
            requirePKCE: true,
            authenticateHandler: { handle: async () => ({ id: user.id, grantId }) },
          }
        )
      ).rejects.toThrow();
    });
  });

  it('a change requested with a personal token never self-approves, even for an administrator', async () => {
    const admin = await signIn('ADMIN');
    const { grantId } = await created();
    const operation = MCP_CATALOG.find(item => item.status === 'APPROVAL_REQUIRED')!;
    const token = await db.mcpToken.findFirstOrThrow({ where: { grantId } });
    const approval = await db.mcpOperationApproval.create({
      data: {
        operationId: operation.operationId,
        riskClass: 'R2',
        operationDigest: 'a'.repeat(64),
        contractDigest: 'b'.repeat(64),
        actorId: admin.id,
        requesterGrantId: grantId,
        requesterCredentialId: token.id,
        summary: {},
        expiresAt: new Date(Date.now() + 3600000),
      },
    });
    const reviewer = { id: admin.id, tokenVersion: admin.tokenVersion };
    await expect(loadMcpOperationReview(approval.id, reviewer)).rejects.toMatchObject({
      code: 'MCP_DISTINCT_REVIEWER_REQUIRED',
    });
    // The same request from an OAuth connection is an administrator's own, confirmable review.
    const oauth = await oauthConnection(admin.id, ['incidents:read']);
    await db.mcpOperationApproval.update({
      where: { id: approval.id },
      data: { requesterGrantId: oauth.grant.id },
    });
    await expect(loadMcpOperationReview(approval.id, reviewer)).rejects.not.toMatchObject({
      code: 'MCP_DISTINCT_REVIEWER_REQUIRED',
    });
    // Another administrator may review the personal-token request.
    await db.mcpOperationApproval.update({
      where: { id: approval.id },
      data: { requesterGrantId: grantId },
    });
    const other = await createTestUser({ role: 'ADMIN' });
    await expect(
      loadMcpOperationReview(approval.id, { id: other.id, tokenVersion: other.tokenVersion })
    ).rejects.not.toMatchObject({ code: 'MCP_DISTINCT_REVIEWER_REQUIRED' });
  });
});

describe('a personal token prepares changes for someone else to approve', () => {
  it('tells the assistant an administrator cannot approve a personal-token request', async () => {
    const f = await fixture();
    const call = async () => {
      const { body } = await rpc(f.bearer, 'tools/call', {
        name: 'operation_prepare',
        arguments: await f.leadArgs(),
      });
      return body.result.structuredContent as { selfApprovable: boolean; approvalId: string };
    };
    expect((await call()).selfApprovable).toBe(true);
    // The same administrator's connection, turned into a personal token.
    await db.mcpPolicy.update({
      where: { id: 'default' },
      data: { patAllowedScopes: approvalScopes },
    });
    await db.mcpGrant.update({ where: { id: f.grant.id }, data: { kind: 'PAT' } });
    const prepared = await call();
    expect(prepared.selfApprovable).toBe(false);
    await expect(
      f.review(prepared as never, 'approve', { id: f.user.id, tokenVersion: f.user.tokenVersion })
    ).rejects.toMatchObject({ code: 'MCP_DISTINCT_REVIEWER_REQUIRED' });
  });
});

describe('view-only connections', () => {
  it('"Require view-only connections" caps OAuth and personal tokens live, and back again', async () => {
    const user = await signIn('ADMIN');
    const oauth = await oauthConnection(user.id, ['incidents:read', 'incidents:write']);
    const { token } = await created({ scopes: ['incidents:read', 'incidents:write'] });
    await db.mcpPolicy.update({
      where: { id: 'default' },
      data: { requireReadOnlyConnections: true },
    });
    for (const bearer of [oauth.bearer, token])
      expect((await authenticateMcp(bearerRequest(bearer), null)).auth.apiKey.scopes).toEqual([
        'incidents:read',
      ]);
    await db.mcpPolicy.update({
      where: { id: 'default' },
      data: { requireReadOnlyConnections: false },
    });
    expect(
      (await authenticateMcp(bearerRequest(oauth.bearer), null)).auth.apiKey.scopes.sort()
    ).toEqual(['incidents:read', 'incidents:write']);
  });

  it('a view-only or writes-off session is not offered call_operation or operation_prepare', async () => {
    const user = await signIn('ADMIN');
    const writer = await oauthConnection(user.id, [
      'incidents:read',
      'incidents:write',
      'services:read',
      'services:write',
    ]);
    const before = await toolNames(writer.bearer);
    expect(before).toContain('call_operation');
    expect(before).toContain('operation_prepare');
    await db.mcpPolicy.update({
      where: { id: 'default' },
      data: { requireReadOnlyConnections: true },
    });
    const capped = await toolNames(writer.bearer);
    expect(capped).not.toContain('call_operation');
    expect(capped).not.toContain('operation_prepare');
    expect(capped).toContain('read_operation');
    // A change guessed through read_operation is not pointed at a tool the session lacks.
    const guessed = await rpc(writer.bearer, 'tools/call', {
      name: 'read_operation',
      arguments: { operationId: 'resolveIncident', args: { path: { id: 'inc_1' } } },
    });
    expect(guessed.body.result.content[0].text).toBe(
      'MCP_NOT_A_READ: This operation changes state; this connection can only view.'
    );
    await db.mcpPolicy.update({
      where: { id: 'default' },
      data: { requireReadOnlyConnections: false, writesEnabled: false },
    });
    const off = await toolNames(writer.bearer);
    expect(off).not.toContain('call_operation');
    expect(off).not.toContain('operation_prepare');
    const reader = await oauthConnection(user.id, ['incidents:read']);
    await db.mcpPolicy.update({ where: { id: 'default' }, data: { writesEnabled: true } });
    expect(await toolNames(reader.bearer)).not.toContain('call_operation');
  });

  async function consent(scopes: string[], { viewOnly }: { viewOnly: boolean }) {
    const client = await db.mcpClient.create({
      data: {
        name: 'Ops Copilot',
        scopes: ['incidents:read', 'incidents:write', 'services:read'],
        redirectUris: ['http://127.0.0.1:19412/callback'],
      },
    });
    const verifier = randomBytes(32).toString('base64url');
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: client.id,
      redirect_uri: 'http://127.0.0.1:19412/callback',
      scope: 'incidents:read incidents:write services:read',
      state: randomBytes(24).toString('base64url'),
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
      resource: mcpResource(),
    });
    const started = await authorize(new Request(`${origin}/oauth/mcp/authorize?${query}`));
    const id = new URL(started.headers.get('location')!).searchParams.get('id')!;
    const { decideMcpConsent } = await import('@/app/(app)/settings/integrations/mcp/actions');
    const form = new FormData();
    form.set('id', id);
    form.set('decision', 'allow');
    for (const scope of scopes) form.append('scope', scope);
    if (viewOnly) form.set('viewOnly', 'on');
    await decideMcpConsent(form);
    return db.mcpGrant.findFirstOrThrow({
      where: { clientId: client.id },
      orderBy: { createdAt: 'desc' },
    });
  }

  it('the consent "View only" switch grants read scopes only, whatever was ticked', async () => {
    await signIn('ADMIN');
    const grant = await consent(['incidents:read', 'incidents:write'], { viewOnly: true });
    expect(grant.scopes).toEqual(['incidents:read']);
    const full = await consent(['incidents:read', 'incidents:write'], { viewOnly: false });
    expect(full.scopes.sort()).toEqual(['incidents:read', 'incidents:write']);
  });

  it('a policy requiring view-only connections refuses a change scope at consent', async () => {
    await signIn('ADMIN');
    await db.mcpPolicy.update({
      where: { id: 'default' },
      data: { requireReadOnlyConnections: true },
    });
    await expect(
      consent(['incidents:read', 'incidents:write'], { viewOnly: false })
    ).rejects.toThrow();
    const grant = await consent(['incidents:read'], { viewOnly: false });
    expect(grant.scopes).toEqual(['incidents:read']);
  });
});

describe('expiry notices', () => {
  it('tells the owner once, seven days ahead, in OpsKnight only', async () => {
    const user = await signIn('USER');
    const soon = await created({ label: 'Nightly CI', expiresInDays: 5 });
    const later = await created({ label: 'Later', expiresInDays: 30 });
    expect(await notifyExpiringMcpPersonalTokens()).toBe(1);
    const notices = await db.inAppNotification.findMany({ where: { userId: user.id } });
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      type: 'SYSTEM',
      entityType: 'MCP_PERSONAL_TOKEN',
      entityId: soon.grantId,
    });
    expect(notices[0]!.message).toContain('"Nightly CI" expires in 5 days');
    expect(inAppNotificationHref(notices[0]!)).toBe('/settings/integrations/mcp?tab=connections');
    // Once per token, also through the scheduled cleanup.
    expect((await cleanupMcpCredentials()).expiringTokenNotices).toBe(0);
    expect(await db.inAppNotification.count({ where: { userId: user.id } })).toBe(1);
    // A revoked token is not announced.
    await db.mcpGrant.update({
      where: { id: later.grantId },
      data: { expiresAt: new Date(Date.now() + 86_400_000), revokedAt: new Date() },
    });
    expect(await notifyExpiringMcpPersonalTokens()).toBe(0);
  });
});
