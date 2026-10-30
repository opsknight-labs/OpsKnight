import { createHash, randomBytes } from 'node:crypto';
import { isValidElement, type ReactNode } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestUser, resetDatabase, testPrisma as db } from '../helpers/test-db';
import { GET as authorize } from '@/app/oauth/mcp/authorize/route';
import { POST as exchange } from '@/app/oauth/mcp/token/route';
import { POST as mcpRequest } from '@/app/mcp/route';
import { resetMcpRuntimeForTests, mcpResource } from '@/lib/mcp/auth/config';
import { mcpScopesUsableByRole } from '@/lib/mcp/auth/role-scopes';
import type { McpConsentGroup } from '@/lib/mcp/auth/consent-offer';
import { authenticateMcp } from '@/lib/mcp/auth/principal';
import { callMcpOperation } from '@/lib/mcp/core/execution';
import { CostBudget } from '@/lib/mcp/core/budget';

const actor = vi.hoisted(() => ({
  id: '',
  role: 'ADMIN',
  email: '',
  name: 'Test User',
  status: 'ACTIVE',
  tokenVersion: 0,
  location: '',
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

const origin = 'http://localhost:3000';
const callback = 'http://127.0.0.1:19411/callback';
// Read and change permissions across areas, including administration a responder cannot use.
const CLIENT_SCOPES = [
  'incidents:read',
  'incidents:write',
  'services:read',
  'schedules:read',
  'runbooks:read',
  'runbooks:execute',
  'runbooks:write',
  'audit:read',
  'integrations:write',
];

beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (!url.pathname.endsWith('_test') || !['localhost', '127.0.0.1'].includes(url.hostname))
    throw new Error('Owned local PostgreSQL required');
  process.env.MCP_PUBLIC_ORIGIN = origin;
  process.env.ENCRYPTION_KEY = randomBytes(32).toString('hex');
  delete process.env.ENCRYPTION_KEYS;
  await resetDatabase();
}, 60000);
beforeEach(async () => {
  resetMcpRuntimeForTests();
  await db.rateLimit.deleteMany({ where: { key: { startsWith: 'mcp:' } } });
  await db.mcpConsentRequest.deleteMany();
  await db.mcpGrant.deleteMany();
  await db.mcpClient.deleteMany();
  await db.mcpPolicy.deleteMany();
  await db.mcpPolicy.create({
    data: { enabled: true, writesEnabled: true, requestsPerMinute: 600 },
  });
});

async function signIn(role: 'ADMIN' | 'RESPONDER' | 'AUDITOR' | 'USER') {
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

/** A manually registered client asks for `scope`; returns the pending consent id. */
async function startConsent(scope = CLIENT_SCOPES.join(' ')) {
  const client = await db.mcpClient.create({
    data: { name: 'Ops Copilot', scopes: CLIENT_SCOPES, redirectUris: [callback] },
  });
  const verifier = randomBytes(32).toString('base64url');
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: client.id,
    redirect_uri: callback,
    ...(scope ? { scope } : {}),
    state: randomBytes(24).toString('base64url'),
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    resource: mcpResource(),
  });
  const started = await authorize(new Request(`${origin}/oauth/mcp/authorize?${query}`));
  expect(started.status).toBe(307);
  const id = new URL(started.headers.get('location')!).searchParams.get('id')!;
  return { id, client, verifier, state: query.get('state')! };
}

async function decide(id: string, decision: 'allow' | 'deny', scopes: string[]) {
  const { decideMcpConsent } = await import('@/app/(app)/settings/integrations/mcp/actions');
  const form = new FormData();
  form.set('id', id);
  form.set('decision', decision);
  for (const scope of scopes) form.append('scope', scope);
  actor.location = '';
  return decideMcpConsent(form);
}

async function tokenFor(flow: Awaited<ReturnType<typeof startConsent>>) {
  const back = new URL(actor.location);
  expect(back.searchParams.get('state')).toBe(flow.state);
  const response = await exchange(
    new Request(`${origin}/oauth/mcp/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: flow.client.id,
        code: back.searchParams.get('code')!,
        code_verifier: flow.verifier,
        redirect_uri: callback,
        resource: mcpResource(),
      }),
    })
  );
  expect(response.status).toBe(200);
  return (await response.json()) as { access_token: string; refresh_token: string; scope: string };
}

/** Renders the consent Server Component and returns the props it hands the checkbox form. */
async function renderOffer(id: string) {
  const { default: McpConsent } = await import('@/app/oauth/mcp/consent/page');
  const tree = await McpConsent({ searchParams: Promise.resolve({ id }) });
  const find = (node: ReactNode): Record<string, unknown> | null => {
    if (Array.isArray(node)) {
      for (const child of node) {
        const hit = find(child);
        if (hit) return hit;
      }
      return null;
    }
    if (!isValidElement(node)) return null;
    const props = node.props as Record<string, unknown>;
    if ('groups' in props && 'unavailableNote' in props) return props;
    // Expand the synchronous presentational shell to reach the checkbox form inside it.
    if (typeof node.type === 'function' && node.type.name === 'ConsentView')
      return find((node.type as (props: unknown) => ReactNode)(props));
    return find(props.children as ReactNode);
  };
  const props = find(tree);
  expect(props).toBeTruthy();
  const groups = props!.groups as McpConsentGroup[];
  const items = groups.flatMap(group => [...group.view, ...group.change]);
  return { groups, items, unavailableNote: props!.unavailableNote as string | null };
}

async function pendingConsumed(id: string) {
  return (await db.mcpConsentRequest.findUniqueOrThrow({ where: { id } })).consumedAt;
}

describe('role-aware MCP consent', () => {
  it('offers a responder only the permissions a responder can use', async () => {
    await signIn('RESPONDER');
    const flow = await startConsent();
    const { items, groups, unavailableNote } = await renderOffer(flow.id);
    const usable = mcpScopesUsableByRole('RESPONDER');
    expect(items.map(item => item.scope).sort()).toEqual(
      CLIENT_SCOPES.filter(scope => usable.has(scope)).sort()
    );
    for (const scope of ['runbooks:write', 'audit:read', 'integrations:write'])
      expect(items.map(item => item.scope)).not.toContain(scope);
    expect(unavailableNote).toBe(
      'Some requested permissions aren’t available to your role (Responder).'
    );
    // Reads start selected; requested change permissions are selected and shown as changes.
    expect(items.find(item => item.scope === 'incidents:read')?.checked).toBe(true);
    const incidents = groups.find(group => group.label === 'Incidents')!;
    expect(incidents.change.map(item => [item.scope, item.checked])).toEqual([
      ['incidents:write', true],
    ]);
  });

  it('offers an administrator everything the client may request, with nothing hidden', async () => {
    await signIn('ADMIN');
    const flow = await startConsent();
    const { items, unavailableNote } = await renderOffer(flow.id);
    expect(items.map(item => item.scope).sort()).toEqual([...CLIENT_SCOPES].sort());
    expect(unavailableNote).toBeNull();
  });

  it('leaves change permissions unselected when the assistant did not name them', async () => {
    await signIn('ADMIN');
    // No scope parameter: the request falls back to the client ceiling.
    const flow = await startConsent('');
    const { items } = await renderOffer(flow.id);
    expect(items.length).toBe(CLIENT_SCOPES.length);
    for (const item of items) expect(item.checked).toBe(item.scope.endsWith(':read'));
  });

  it('refuses a forged form scope outside the offer without consuming the request', async () => {
    await signIn('RESPONDER');
    const flow = await startConsent();
    const grants = await db.mcpGrant.count();
    // Requested and inside the client ceiling, but not usable by a responder.
    for (const forged of ['runbooks:write', 'audit:read', 'teams:write', 'admin:manage']) {
      await expect(decide(flow.id, 'allow', ['incidents:read', forged])).rejects.toThrow(
        'invalid_scope'
      );
      expect(actor.location).toBe('/oauth/mcp/consent/result?code=invalid_scope');
    }
    expect(await db.mcpGrant.count()).toBe(grants);
    expect(await pendingConsumed(flow.id)).toBeNull();
  });

  it('rejects an empty selection and keeps the request open', async () => {
    await signIn('RESPONDER');
    const flow = await startConsent();
    await expect(decide(flow.id, 'allow', [])).rejects.toThrow('MCP_CONSENT_NO_SCOPES');
    expect(actor.location).toBe('/oauth/mcp/consent/result?code=MCP_CONSENT_NO_SCOPES');
    expect(await db.mcpGrant.count()).toBe(0);
    expect(await pendingConsumed(flow.id)).toBeNull();
  });

  it('still cancels back to the assistant with access_denied and no selection', async () => {
    await signIn('RESPONDER');
    const flow = await startConsent();
    await decide(flow.id, 'deny', []);
    const back = new URL(actor.location);
    expect(back.searchParams.get('error')).toBe('access_denied');
    expect(back.searchParams.get('state')).toBe(flow.state);
    expect(await db.mcpGrant.count()).toBe(0);
    expect(await pendingConsumed(flow.id)).not.toBeNull();
    // The consent is single-use.
    await expect(decide(flow.id, 'allow', ['incidents:read'])).rejects.toThrow(
      'MCP_CONSENT_EXPIRED'
    );
  });

  it('narrows the grant, its tokens and refreshes to exactly the selection, and audits it', async () => {
    const user = await signIn('RESPONDER');
    const flow = await startConsent();
    await decide(flow.id, 'allow', ['services:read', 'incidents:write']);
    const grant = await db.mcpGrant.findFirstOrThrow({ where: { userId: user.id } });
    expect([...grant.scopes].sort()).toEqual(['incidents:write', 'services:read']);
    const tokens = await tokenFor(flow);
    expect(tokens.scope.split(' ').sort()).toEqual(['incidents:write', 'services:read']);
    const refresh = (scope?: string, refresh_token = tokens.refresh_token) =>
      exchange(
        new Request(`${origin}/oauth/mcp/token`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            client_id: flow.client.id,
            refresh_token,
            ...(scope ? { scope } : {}),
          }),
        })
      );
    // A refresh cannot widen the grant to an unselected scope.
    expect((await refresh('services:read incidents:read')).status).toBe(400);
    const refreshed = await refresh();
    expect(refreshed.status).toBe(200);
    const next = (await refreshed.json()) as { access_token: string; scope: string };
    expect(next.scope.split(' ').sort()).toEqual(['incidents:write', 'services:read']);
    const principal = await authenticateMcp(
      new Request(mcpResource(), { headers: { authorization: `Bearer ${next.access_token}` } }),
      1
    );
    expect([...principal.auth.apiKey.scopes].sort()).toEqual(['incidents:write', 'services:read']);
    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: 'mcp.grant.consented', entityId: grant.id },
    });
    expect(audit.details).toMatchObject({
      metadata: {
        selectedScopeCount: 2,
        selectedScopes: expect.arrayContaining(['incidents:write', 'services:read']),
        role: 'RESPONDER',
      },
    });
  });

  it('refuses a tool that needs a permission the person did not select', async () => {
    await signIn('RESPONDER');
    const flow = await startConsent();
    // Incidents are readable by this role, but the person grants only services.
    await decide(flow.id, 'allow', ['services:read']);
    const tokens = await tokenFor(flow);
    const principal = await authenticateMcp(
      new Request(mcpResource(), { headers: { authorization: `Bearer ${tokens.access_token}` } }),
      1
    );
    const context = {
      grantId: principal.grantId,
      credentialId: principal.credentialId,
      tokenScopes: principal.tokenScopes,
      requestId: 'consent-role-scopes',
      budget: new CostBudget(),
    };
    await expect(callMcpOperation(context, 'listServices', {})).resolves.toBeTruthy();
    await expect(callMcpOperation(context, 'listIncidents', {})).rejects.toThrow(
      'MCP_OPERATION_FORBIDDEN'
    );
    // Through the real transport the incident tool is neither listed nor callable.
    const output = await searchIncidents(tokens.access_token);
    expect(output.error ?? output.result?.isError).toBeTruthy();
    expect(output.result?.structuredContent).toBeUndefined();
    // Control: the same tool works for a grant where the person did select incidents.
    const selected = await startConsent();
    await decide(selected.id, 'allow', ['incidents:read']);
    const allowed = await searchIncidents((await tokenFor(selected)).access_token);
    expect(allowed.error).toBeUndefined();
    expect(allowed.result?.isError).not.toBe(true);
    expect(allowed.result?.structuredContent).toBeDefined();
  });

  async function searchIncidents(accessToken: string) {
    const response = await mcpRequest(
      new Request(mcpResource(), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'mcp-protocol-version': '2026-07-28',
          'mcp-method': 'tools/call',
          'mcp-name': 'incident_search',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'incident_search',
            arguments: { query: { limit: 5 } },
            _meta: {
              'io.modelcontextprotocol/protocolVersion': '2026-07-28',
              'io.modelcontextprotocol/clientInfo': { name: 'consent-regression', version: '1' },
              'io.modelcontextprotocol/clientCapabilities': {},
            },
          },
        }),
      })
    );
    return JSON.parse(await response.text()) as {
      error?: unknown;
      result?: { isError?: boolean; structuredContent?: unknown };
    };
  }

  it('re-checks the role on submit, so a demotion after the page loaded narrows the offer', async () => {
    const user = await signIn('ADMIN');
    const flow = await startConsent();
    await db.user.update({ where: { id: user.id }, data: { role: 'RESPONDER' } });
    await expect(decide(flow.id, 'allow', ['incidents:read', 'audit:read'])).rejects.toThrow(
      'invalid_scope'
    );
    await decide(flow.id, 'allow', ['incidents:read']);
    const grant = await db.mcpGrant.findFirstOrThrow({ where: { userId: user.id } });
    expect(grant.scopes).toEqual(['incidents:read']);
  });
});
