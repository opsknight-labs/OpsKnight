// @vitest-environment node
import { randomBytes } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestUser, resetDatabase, testPrisma as db } from '../helpers/test-db';
import { POST as deviceAuthorization } from '@/app/oauth/mcp/device_authorization/route';
import { POST as tokenEndpoint } from '@/app/oauth/mcp/token/route';
import { POST as registerEndpoint } from '@/app/oauth/mcp/register/route';
import { GET as authorizationMetadata } from '@/app/.well-known/oauth-authorization-server/oauth/mcp/route';
import { POST as mcpRequest } from '@/app/mcp/route';
import { mcpResource, resetMcpRuntimeForTests } from '@/lib/mcp/auth/config';
import { clearDiscoveryPolicyCache } from '@/lib/mcp/auth/discovery-policy';
import { mcpScopesUsableByRole } from '@/lib/mcp/auth/role-scopes';
import { resetMcpAdmissionForTests } from '@/lib/mcp/auth/admission';
import {
  MCP_DEVICE_CODE_GRANT,
  MCP_USER_CODE_ALPHABET,
  normalizeMcpUserCode,
} from '@/lib/mcp/auth/device-flow';
import { cleanupMcpCredentials } from '@/lib/mcp/auth/retention';

const actor = vi.hoisted(() => ({
  id: '',
  role: 'ADMIN',
  email: '',
  name: 'Test User',
  status: 'ACTIVE',
  tokenVersion: 0,
  location: '',
  origin: 'http://localhost:3000' as string | null,
  ip: '203.0.113.7',
}));
vi.mock('@/lib/rbac', () => ({
  getCurrentUser: vi.fn(async () => actor),
  getUserPermissions: vi.fn(async () => ({ ...actor, capabilities: [] })),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    actor.location = url;
  }),
}));
vi.mock('next/headers', () => ({
  headers: vi.fn(
    async () =>
      new Headers({
        ...(actor.origin ? { origin: actor.origin } : {}),
        'x-forwarded-for': actor.ip,
      })
  ),
}));

const origin = 'http://localhost:3000';
const CLIENT_SCOPES = ['incidents:read', 'incidents:write', 'services:read', 'audit:read'];

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

async function setPolicy(data: Record<string, unknown> = {}) {
  const policy = {
    enabled: true,
    writesEnabled: true,
    requestsPerMinute: 600,
    deviceFlowEnabled: true,
    dcrEnabled: true,
    dcrScopes: CLIENT_SCOPES,
    ...data,
  };
  await db.mcpPolicy.upsert({ where: { id: 'default' }, create: policy, update: policy });
  clearDiscoveryPolicyCache();
}

beforeEach(async () => {
  resetMcpRuntimeForTests();
  resetMcpAdmissionForTests();
  await db.rateLimit.deleteMany({ where: { key: { startsWith: 'mcp:' } } });
  await db.mcpDeviceAuthorization.deleteMany();
  await db.mcpGrant.deleteMany();
  await db.mcpClient.deleteMany();
  await db.mcpPolicy.deleteMany();
  await setPolicy();
  actor.origin = origin;
  actor.ip = `203.0.113.${Math.floor(Math.random() * 200) + 1}`;
});

async function signIn(role: 'ADMIN' | 'RESPONDER' | 'AUDITOR' | 'USER' = 'ADMIN') {
  const user = await createTestUser({ role });
  Object.assign(actor, {
    id: user.id,
    role,
    email: user.email,
    tokenVersion: user.tokenVersion,
    location: '',
  });
  return user;
}

const cliClient = (deviceCodeGrant = true) =>
  db.mcpClient.create({
    data: {
      name: 'ops-cli',
      scopes: CLIENT_SCOPES,
      redirectUris: ['http://127.0.0.1:8765/callback'],
      deviceCodeGrant,
    },
  });

const form = (fields: Record<string, string>, extraHeaders: Record<string, string> = {}) => ({
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded', ...extraHeaders },
  body: new URLSearchParams(fields),
});

type DeviceResponse = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
};

async function startDevice(clientId: string, fields: Record<string, string> = {}) {
  const response = await deviceAuthorization(
    new Request(
      `${origin}/oauth/mcp/device_authorization`,
      form({ client_id: clientId, ...fields })
    )
  );
  return response;
}

async function start(clientId: string, fields: Record<string, string> = {}) {
  const response = await startDevice(clientId, fields);
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  return (await response.json()) as DeviceResponse;
}

const poll = (deviceCode: string, clientId: string) =>
  tokenEndpoint(
    new Request(
      `${origin}/oauth/mcp/token`,
      form({ grant_type: MCP_DEVICE_CODE_GRANT, device_code: deviceCode, client_id: clientId })
    )
  );

async function pollJson(deviceCode: string, clientId: string) {
  const response = await poll(deviceCode, clientId);
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

/** Lets the next poll through the interval check. */
async function waitedInterval() {
  await db.mcpDeviceAuthorization.updateMany({
    where: { status: 'PENDING' },
    data: { lastPolledAt: new Date(Date.now() - 120000) },
  });
}

async function confirm(userCode: string) {
  const { confirmMcpDeviceCode } = await import('@/app/oauth/mcp/device/actions');
  const data = new FormData();
  data.set('user_code', userCode);
  actor.location = '';
  await confirmMcpDeviceCode(data);
  return new URL(actor.location, origin);
}

async function decide(id: string, decision: 'allow' | 'deny', scopes: string[], viewOnly = false) {
  const { decideMcpDeviceConsent } = await import('@/app/oauth/mcp/device/actions');
  const data = new FormData();
  data.set('id', id);
  data.set('decision', decision);
  for (const scope of scopes) data.append('scope', scope);
  if (viewOnly) data.set('viewOnly', 'on');
  actor.location = '';
  await decideMcpDeviceConsent(data);
  return new URL(actor.location, origin);
}

let rpcId = 0;
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
        id: ++rpcId,
        method: 'tools/call',
        params: {
          name: 'whoami',
          arguments: {},
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2026-07-28',
            'io.modelcontextprotocol/clientCapabilities': {},
            'io.modelcontextprotocol/clientInfo': { name: 'device-test', version: '1' },
          },
        },
      }),
    })
  );
}

const refresh = (refreshToken: string, clientId: string) =>
  tokenEndpoint(
    new Request(
      `${origin}/oauth/mcp/token`,
      form({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId })
    )
  );

/** Request, enter the code and approve; returns everything a test needs to poll. */
async function approved(scopes = ['incidents:read', 'services:read']) {
  await signIn('ADMIN');
  const client = await cliClient();
  const device = await start(client.id);
  const landed = await confirm(device.user_code);
  const id = landed.searchParams.get('id')!;
  expect(id).toBeTruthy();
  const done = await decide(id, 'allow', scopes);
  expect(done.pathname + done.search).toBe('/oauth/mcp/device?done=approved');
  return { client, device, id };
}

const auditActions = async () =>
  (
    await db.auditLog.findMany({
      where: { action: { startsWith: 'mcp.device.' } },
      select: { action: true },
    })
  ).map(row => row.action);

describe('device authorization endpoint (RFC 8628 §3.1-3.2)', () => {
  it('returns high-entropy codes, an unambiguous user code and the verification URIs', async () => {
    const client = await cliClient();
    const device = await start(client.id, { scope: 'incidents:read unknown:scope', foo: 'bar' });
    expect(device.device_code.length).toBeGreaterThanOrEqual(43);
    expect(MCP_USER_CODE_ALPHABET).toBe('BCDFGHJKLMNPQRSTVWXZ');
    expect(device.user_code).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/);
    expect(device.verification_uri).toBe(`${origin}/oauth/mcp/device`);
    expect(device.verification_uri_complete).toBe(
      `${origin}/oauth/mcp/device?user_code=${device.user_code}`
    );
    expect(device.expires_in).toBe(600);
    expect(device.interval).toBe(5);
    const row = await db.mcpDeviceAuthorization.findFirstOrThrow({
      where: { clientId: client.id },
    });
    // Only digests are stored.
    expect(row.deviceCodeHash).not.toContain(device.device_code);
    expect(JSON.stringify(row)).not.toContain(device.device_code);
    expect(JSON.stringify(row)).not.toContain(device.user_code.replace('-', ''));
    expect(row.scopes).toEqual(['incidents:read']);
    expect(row.status).toBe('PENDING');
    expect(await auditActions()).toContain('mcp.device.requested');
  });

  it('refuses clients that are not registered for the grant, and metadata-document ids', async () => {
    const plain = await cliClient(false);
    const refused = await startDevice(plain.id);
    expect(refused.status).toBe(401);
    expect(await refused.json()).toEqual({ error: 'invalid_client' });
    expect((await startDevice('nope')).status).toBe(401);
    expect((await startDevice('https://client.example/metadata.json')).status).toBe(401);
    const revoked = await db.mcpClient.update({
      where: { id: (await cliClient()).id },
      data: { revokedAt: new Date() },
    });
    expect((await startDevice(revoked.id)).status).toBe(401);
  });

  it('validates the resource like authorize and refuses duplicate parameters', async () => {
    const client = await cliClient();
    const wrong = await startDevice(client.id, { resource: 'https://other.example/mcp' });
    expect(wrong.status).toBe(400);
    expect(await wrong.json()).toEqual({ error: 'invalid_target' });
    expect((await startDevice(client.id, { resource: mcpResource() })).status).toBe(200);
    const duplicate = await deviceAuthorization(
      new Request(`${origin}/oauth/mcp/device_authorization`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: `client_id=${client.id}&client_id=${client.id}`,
      })
    );
    expect(duplicate.status).toBe(400);
  });

  it('rate-limits each client', async () => {
    const client = await cliClient();
    const statuses: number[] = [];
    for (let i = 0; i < 32; i++) {
      // A fresh peer each time, so only the per-client budget can refuse.
      statuses.push(
        (
          await deviceAuthorization(
            new Request(
              `${origin}/oauth/mcp/device_authorization`,
              form({ client_id: client.id }, { 'x-forwarded-for': `198.51.100.${i + 1}` })
            )
          )
        ).status
      );
    }
    expect(statuses.filter(status => status === 200)).toHaveLength(30);
    expect(statuses.slice(30)).toEqual([429, 429]);
  });
});

describe('full device flow against the real route handlers', () => {
  it('pending → slow_down → approve with narrowed scopes → tokens work → single use → refresh', async () => {
    await signIn('ADMIN');
    const client = await cliClient();
    const device = await start(client.id);
    // Not approved yet.
    expect(await pollJson(device.device_code, client.id)).toEqual({
      status: 400,
      body: { error: 'authorization_pending' },
    });
    // Polling again at once is too fast: slow down, and the interval grows by five seconds.
    const fast = await pollJson(device.device_code, client.id);
    expect(fast).toEqual({ status: 400, body: { error: 'slow_down', interval: 10 } });
    expect(
      (await db.mcpDeviceAuthorization.findFirstOrThrow({ where: { clientId: client.id } }))
        .interval
    ).toBe(10);
    await waitedInterval();
    expect((await pollJson(device.device_code, client.id)).body.error).toBe(
      'authorization_pending'
    );

    // The person enters the code, sees consent and approves only a subset.
    const landed = await confirm(device.user_code.toLowerCase().replace('-', ' '));
    const id = landed.searchParams.get('id')!;
    expect(landed.pathname).toBe('/oauth/mcp/device');
    expect(id).toBeTruthy();
    expect((await decide(id, 'allow', ['incidents:read'])).search).toBe('?done=approved');

    const issued = await pollJson(device.device_code, client.id);
    expect(issued.status).toBe(200);
    expect(issued.body).toMatchObject({
      token_type: 'Bearer',
      expires_in: 300,
      scope: 'incidents:read',
    });
    const accessToken = String(issued.body.access_token);
    const refreshToken = String(issued.body.refresh_token);
    const grant = await db.mcpGrant.findFirstOrThrow({ where: { clientId: client.id } });
    expect(grant.scopes).toEqual(['incidents:read']);
    expect(grant.kind).toBe('OAUTH');

    const me = await whoami(accessToken);
    expect(me.status).toBe(200);
    expect(await me.text()).toContain(`"userId":"${actor.id}"`);

    // The device code is spent.
    expect(await pollJson(device.device_code, client.id)).toEqual({
      status: 400,
      body: { error: 'invalid_grant' },
    });
    const renewed = await refresh(refreshToken, client.id);
    expect(renewed.status).toBe(200);
    expect(((await renewed.json()) as { scope: string }).scope).toBe('incidents:read');
    expect(await auditActions()).toEqual(
      expect.arrayContaining(['mcp.device.requested', 'mcp.device.approved', 'mcp.device.consumed'])
    );
    // A device code from one client is useless to another.
    const other = await cliClient();
    const second = await start(client.id);
    expect((await pollJson(second.device_code, other.id)).body.error).toBe('invalid_grant');
  });

  it('prefill from verification_uri_complete still needs an explicit confirm', async () => {
    await signIn('ADMIN');
    const client = await cliClient();
    const device = await start(client.id);
    const { default: McpDevice } = await import('@/app/oauth/mcp/device/page');
    const tree = (await McpDevice({
      searchParams: Promise.resolve({ user_code: device.user_code }),
    })) as { type: { name?: string }; props: { state: Record<string, unknown> } };
    expect(tree.type.name).toBe('DeviceView');
    expect(tree.props.state).toMatchObject({ kind: 'enter', userCode: device.user_code });
    // Rendering the page claimed nothing.
    const row = await db.mcpDeviceAuthorization.findFirstOrThrow({
      where: { clientId: client.id },
    });
    expect(row.userId).toBeNull();
    expect(row.attempts).toBe(0);
  });

  it('the consent step shows the device warning and the role-limited offer', async () => {
    await signIn('USER');
    const client = await cliClient();
    const device = await start(client.id);
    const id = (await confirm(device.user_code)).searchParams.get('id')!;
    const { default: McpDevice } = await import('@/app/oauth/mcp/device/page');
    const tree = (await McpDevice({ searchParams: Promise.resolve({ id }) })) as {
      type: { name?: string };
      props: Record<string, unknown>;
    };
    expect(tree.type.name).toBe('ConsentView');
    expect(tree.props.device).toBe(true);
    expect(tree.props.returnHost).toBeNull();
    const usable = mcpScopesUsableByRole('USER');
    const offered = (
      tree.props.groups as { view: { scope: string }[]; change: { scope: string }[] }[]
    )
      .flatMap(group => [...group.view, ...group.change])
      .map(item => item.scope);
    expect(offered.every(scope => usable.has(scope))).toBe(true);
    // Another person cannot open someone else's claimed request.
    await signIn('ADMIN');
    const foreign = (await McpDevice({ searchParams: Promise.resolve({ id }) })) as {
      type: { name?: string };
      props: { state: Record<string, unknown> };
    };
    expect(foreign.type.name).toBe('DeviceView');
    expect(foreign.props.state).toMatchObject({ kind: 'enter', error: 'MCP_DEVICE_CODE_EXPIRED' });
  });

  it('role intersection: a User cannot obtain a scope their role cannot use', async () => {
    const usable = mcpScopesUsableByRole('USER');
    const forbidden = CLIENT_SCOPES.find(scope => !usable.has(scope));
    expect(forbidden).toBeTruthy();
    await signIn('USER');
    const client = await cliClient();
    const device = await start(client.id);
    const id = (await confirm(device.user_code)).searchParams.get('id')!;
    const refused = await decide(id, 'allow', ['incidents:read', forbidden!]);
    expect(refused.pathname + refused.search).toBe('/oauth/mcp/consent/result?code=invalid_scope');
    expect((await db.mcpDeviceAuthorization.findUniqueOrThrow({ where: { id } })).status).toBe(
      'PENDING'
    );
    expect((await decide(id, 'allow', ['incidents:read'])).search).toBe('?done=approved');
    const issued = await pollJson(device.device_code, client.id);
    expect(issued.status).toBe(200);
    expect(String(issued.body.scope).split(' ')).not.toContain(forbidden);
  });

  it('view only drops change scopes', async () => {
    await signIn('ADMIN');
    const client = await cliClient();
    const device = await start(client.id);
    const id = (await confirm(device.user_code)).searchParams.get('id')!;
    await decide(id, 'allow', ['incidents:read', 'incidents:write'], true);
    expect((await pollJson(device.device_code, client.id)).body.scope).toBe('incidents:read');
  });
});

describe('deny, expiry, lockout and replay', () => {
  it('deny: the device gets access_denied and no grant exists', async () => {
    await signIn('ADMIN');
    const client = await cliClient();
    const device = await start(client.id);
    const id = (await confirm(device.user_code)).searchParams.get('id')!;
    expect((await decide(id, 'deny', [])).search).toBe('?done=denied');
    expect(await pollJson(device.device_code, client.id)).toEqual({
      status: 400,
      body: { error: 'access_denied' },
    });
    expect(await db.mcpGrant.count({ where: { clientId: client.id } })).toBe(0);
    expect(await auditActions()).toContain('mcp.device.denied');
    // A decided request cannot be decided again.
    expect((await decide(id, 'allow', ['incidents:read'])).search).toBe(
      '?code=MCP_DEVICE_CODE_EXPIRED'
    );
  });

  it('expiry: the device gets expired_token, the code no longer opens consent', async () => {
    await signIn('ADMIN');
    const client = await cliClient();
    const device = await start(client.id);
    await db.mcpDeviceAuthorization.updateMany({
      where: { clientId: client.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await confirm(device.user_code)).searchParams.get('error')).toBe(
      'MCP_DEVICE_CODE_EXPIRED'
    );
    expect(await pollJson(device.device_code, client.id)).toEqual({
      status: 400,
      body: { error: 'expired_token' },
    });
    expect(
      (await db.mcpDeviceAuthorization.findFirstOrThrow({ where: { clientId: client.id } })).status
    ).toBe('EXPIRED');
  });

  it('an approval the device never collects is revoked when it expires', async () => {
    const { client, device } = await approved();
    await db.mcpDeviceAuthorization.updateMany({
      where: { clientId: client.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const result = await cleanupMcpCredentials();
    expect(result.expiredDeviceSignIns).toBe(1);
    expect(
      (await db.mcpGrant.findFirstOrThrow({ where: { clientId: client.id } })).revokedAt
    ).not.toBeNull();
    expect((await pollJson(device.device_code, client.id)).body.error).toBe('expired_token');
  });

  it('locks code entry after five wrong codes for that person', async () => {
    await signIn('ADMIN');
    const client = await cliClient();
    const device = await start(client.id);
    const wrong = device.user_code.startsWith('B') ? 'CCCC-CCCC' : 'BBBB-BBBB';
    for (let i = 0; i < 5; i++)
      expect((await confirm(i === 0 ? 'not a code' : wrong)).searchParams.get('error')).toBe(
        'MCP_DEVICE_CODE_INVALID'
      );
    // Even the right code is refused now.
    expect((await confirm(device.user_code)).searchParams.get('error')).toBe(
      'MCP_DEVICE_CODE_LOCKED'
    );
    // From another network address the same person is still locked.
    actor.ip = '198.51.100.250';
    expect((await confirm(device.user_code)).searchParams.get('error')).toBe(
      'MCP_DEVICE_CODE_LOCKED'
    );
    // And the network address is locked for other people too.
    actor.ip = '203.0.113.250';
    await signIn('ADMIN');
    for (let i = 0; i < 5; i++) await confirm(wrong);
    await signIn('ADMIN');
    expect((await confirm(device.user_code)).searchParams.get('error')).toBe(
      'MCP_DEVICE_CODE_LOCKED'
    );
  });

  it('a code entered by one person is unknown to everyone else', async () => {
    await signIn('ADMIN');
    const client = await cliClient();
    const device = await start(client.id);
    expect((await confirm(device.user_code)).searchParams.get('id')).toBeTruthy();
    await signIn('ADMIN');
    expect((await confirm(device.user_code)).searchParams.get('error')).toBe(
      'MCP_DEVICE_CODE_INVALID'
    );
  });

  it('refuses a cross-origin submission', async () => {
    await signIn('ADMIN');
    const client = await cliClient();
    const device = await start(client.id);
    actor.origin = 'https://evil.example';
    expect((await confirm(device.user_code)).searchParams.get('error')).toBe('MCP_INVALID_ORIGIN');
    const row = await db.mcpDeviceAuthorization.findFirstOrThrow({
      where: { clientId: client.id },
    });
    expect(row.userId).toBeNull();
    actor.origin = origin;
    const id = (await confirm(device.user_code)).searchParams.get('id')!;
    actor.origin = null;
    expect((await decide(id, 'allow', ['incidents:read'])).search).toBe('?code=MCP_INVALID_ORIGIN');
    expect((await db.mcpDeviceAuthorization.findUniqueOrThrow({ where: { id } })).status).toBe(
      'PENDING'
    );
  });
});

describe('revocation and concurrency', () => {
  it('two simultaneous polls: only one receives tokens', async () => {
    const { client, device } = await approved();
    const results = await Promise.all([
      pollJson(device.device_code, client.id),
      pollJson(device.device_code, client.id),
      pollJson(device.device_code, client.id),
    ]);
    expect(results.filter(result => result.status === 200)).toHaveLength(1);
    expect(
      results.filter(result => result.status !== 200).map(result => result.body.error)
    ).toEqual(['invalid_grant', 'invalid_grant']);
    expect(await db.mcpToken.count()).toBe(1);
  });

  it('the APPROVED to CONSUMED transition is itself the guard, even without serializable isolation', async () => {
    const { client, device } = await approved();
    const { pollMcpDeviceAuthorization } = await import('@/lib/mcp/auth/device-flow');
    // Two read-committed polls that both read APPROVED before either writes.
    let release!: () => void;
    const bothRead = new Promise<void>(resolve => (release = resolve));
    let reads = 0;
    const racing = () =>
      db.$transaction(async tx => {
        const gated = new Proxy(tx, {
          get(target, property, receiver) {
            const value = Reflect.get(target, property, receiver);
            if (property !== 'mcpDeviceAuthorization') return value;
            return new Proxy(value, {
              get(model, method, modelReceiver) {
                const fn = Reflect.get(model, method, modelReceiver);
                if (method !== 'findUnique') return fn;
                return async (...args: unknown[]) => {
                  const found = await fn.apply(model, args);
                  if (++reads === 2) release();
                  await bothRead;
                  return found;
                };
              },
            });
          },
        });
        return pollMcpDeviceAuthorization(gated, {
          deviceCode: device.device_code,
          clientId: client.id,
        });
      });
    const results = await Promise.all([racing(), racing()]);
    expect(results.filter(result => result.ok)).toHaveLength(1);
    expect(results.find(result => !result.ok)).toEqual({ ok: false, error: 'invalid_grant' });
    expect(await db.mcpToken.count()).toBe(1);
  });

  it('a security event before the poll: no tokens; after: the tokens stop working', async () => {
    const first = await approved();
    await db.user.update({
      where: { id: actor.id },
      data: { mcpRevocationVersion: { increment: 1 } },
    });
    expect(await pollJson(first.device.device_code, first.client.id)).toEqual({
      status: 400,
      body: { error: 'invalid_grant' },
    });
    expect(await db.mcpToken.count()).toBe(0);

    const second = await approved();
    const issued = await pollJson(second.device.device_code, second.client.id);
    expect(issued.status).toBe(200);
    expect((await whoami(String(issued.body.access_token))).status).toBe(200);
    await db.user.update({
      where: { id: actor.id },
      data: { mcpRevocationVersion: { increment: 1 } },
    });
    expect((await whoami(String(issued.body.access_token))).status).toBe(401);
    expect((await refresh(String(issued.body.refresh_token), second.client.id)).status).toBe(400);
  });

  it('revoking the grant from settings kills the device connection', async () => {
    const { client, device } = await approved();
    const issued = await pollJson(device.device_code, client.id);
    const grant = await db.mcpGrant.findFirstOrThrow({ where: { clientId: client.id } });
    const { revokeMcpAccess } = await import('@/app/(app)/settings/integrations/mcp/actions');
    const data = new FormData();
    data.set('id', grant.id);
    data.set('kind', 'grant');
    await revokeMcpAccess(data);
    expect((await whoami(String(issued.body.access_token))).status).toBe(401);
  });
});

describe('policy switch', () => {
  it('off: endpoint 404, not advertised, grant unsupported, page unavailable', async () => {
    const client = await cliClient();
    const live = await start(client.id);
    let metadata = (await (await authorizationMetadata()).json()) as Record<string, unknown>;
    expect(metadata.device_authorization_endpoint).toBe(`${origin}/oauth/mcp/device_authorization`);
    expect(metadata.grant_types_supported).toContain(MCP_DEVICE_CODE_GRANT);

    await setPolicy({ deviceFlowEnabled: false });
    const off = await startDevice(client.id);
    expect(off.status).toBe(404);
    metadata = (await (await authorizationMetadata()).json()) as Record<string, unknown>;
    expect(metadata).not.toHaveProperty('device_authorization_endpoint');
    expect(metadata.grant_types_supported).toEqual(['authorization_code', 'refresh_token']);
    const polled = await pollJson(live.device_code, client.id);
    expect(polled).toMatchObject({ status: 400, body: { error: 'unsupported_grant_type' } });
    await signIn('ADMIN');
    expect((await confirm(live.user_code)).searchParams.get('error')).toBe(
      'MCP_DEVICE_FLOW_DISABLED'
    );
    const { default: McpDevice } = await import('@/app/oauth/mcp/device/page');
    const tree = (await McpDevice({ searchParams: Promise.resolve({}) })) as {
      props: { state: Record<string, unknown> };
    };
    expect(tree.props.state).toEqual({ kind: 'unavailable', code: 'MCP_DEVICE_FLOW_DISABLED' });
    // MCP off entirely also hides it.
    await setPolicy({ enabled: false });
    expect((await startDevice(client.id)).status).toBe(404);
  });
});

describe('dynamic registration of device clients', () => {
  const register = (body: Record<string, unknown>) =>
    registerEndpoint(
      new Request(`${origin}/oauth/mcp/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    );

  it('a device-only client registers without redirect URIs and can sign in', async () => {
    const response = await register({
      client_name: 'headless-agent',
      grant_types: [MCP_DEVICE_CODE_GRANT, 'refresh_token'],
      scope: 'incidents:read',
    });
    expect(response.status).toBe(201);
    const registered = (await response.json()) as Record<string, unknown>;
    expect(registered.grant_types).toEqual(['refresh_token', MCP_DEVICE_CODE_GRANT]);
    expect(registered.redirect_uris).toEqual([]);
    const device = await start(String(registered.client_id));
    expect(device.user_code).toBeTruthy();
  });

  it('a browser client that also declares the device grant can use both', async () => {
    const response = await register({
      redirect_uris: ['http://127.0.0.1:8765/callback'],
      grant_types: ['authorization_code', 'refresh_token', MCP_DEVICE_CODE_GRANT],
    });
    const registered = (await response.json()) as Record<string, unknown>;
    expect(registered.grant_types).toEqual([
      'authorization_code',
      'refresh_token',
      MCP_DEVICE_CODE_GRANT,
    ]);
    expect((await startDevice(String(registered.client_id))).status).toBe(200);
  });

  it('a browser-only registration cannot use the device flow; device-only is refused while off', async () => {
    const browser = (await (
      await register({ redirect_uris: ['http://127.0.0.1:8765/callback'] })
    ).json()) as Record<string, unknown>;
    expect((await startDevice(String(browser.client_id))).status).toBe(401);
    expect((await register({ grant_types: ['authorization_code'] })).status).toBe(400);
    await setPolicy({ deviceFlowEnabled: false });
    expect((await register({ grant_types: [MCP_DEVICE_CODE_GRANT, 'refresh_token'] })).status).toBe(
      400
    );
  });
});

describe('user code normalisation', () => {
  it('ignores case, spaces and dashes; refuses anything outside the alphabet', () => {
    expect(normalizeMcpUserCode('bcdf-ghjk')).toBe('BCDFGHJK');
    expect(normalizeMcpUserCode(' BCDF GHJK ')).toBe('BCDFGHJK');
    expect(normalizeMcpUserCode('BCDFGHJA')).toBeNull();
    expect(normalizeMcpUserCode('BCDF-GHJ')).toBeNull();
    expect(normalizeMcpUserCode('B'.repeat(40))).toBeNull();
  });
});
