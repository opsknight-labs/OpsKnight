import { createHash } from 'node:crypto';
import OAuth2Server from '@node-oauth/oauth2-server';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createTestUser,
  createTestService,
  createTestIncident,
  resetDatabase,
  testPrisma as db,
} from '../helpers/test-db';
import { mcpOAuthServer } from '@/lib/mcp/auth/oauth-model';
import { digestMcpSecret, mcpResource } from '@/lib/mcp/auth/config';
import { authenticateMcp, resolveMcpGrant } from '@/lib/mcp/auth/principal';
import { POST as tokenExchange } from '@/app/oauth/mcp/token/route';
import { callMcpOperation, type ExecutionContext } from '@/lib/mcp/core/execution';
import { CostBudget } from '@/lib/mcp/core/budget';
import { executeMcpPlan } from '@/lib/mcp/core/plan';
import { POST as revokeToken } from '@/app/oauth/mcp/revoke/route';
import { POST as mcpRequest } from '@/app/mcp/route';

beforeAll(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  process.env.MCP_PUBLIC_ORIGIN = 'http://localhost:3000';
  await resetDatabase();
}, 60000);
// Tests own fresh principals/resources. Repeated global truncation can outlive
// a hook timeout and corrupt the next test's sealed policy fixture.
beforeEach(async () => {
  const policy = {
    enabled: true,
    writesEnabled: true,
    maxInFlight: 4,
    maxOperations: 8,
    requestsPerMinute: 60,
  };
  await db.mcpPolicy.upsert({ where: { id: 'default' }, create: policy, update: policy });
}, 30000);

async function fixture(
  role: 'ADMIN' | 'USER' | 'AUDITOR' | 'RESPONDER' = 'ADMIN',
  scopes = ['incidents:read', 'incidents:write']
) {
  const user = await createTestUser({ role });
  const client = await db.mcpClient.create({
    data: { name: 'MCP test', scopes, redirectUris: ['http://127.0.0.1:9999/callback'] },
  });
  const grant = await db.mcpGrant.create({
    data: {
      userId: user.id,
      userTokenVersion: user.tokenVersion,
      clientId: client.id,
      scopes,
      resource: mcpResource(),
      expiresAt: new Date(Date.now() + 3600000),
    },
  });
  const verifier = 'a'.repeat(43);
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  let code = '';
  await db.$transaction(async tx => {
    const response = new OAuth2Server.Response();
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
      response,
      {
        authenticateHandler: { handle: async () => ({ id: user.id, grantId: grant.id }) },
        requirePKCE: true,
      }
    );
    code = authorized.authorizationCode;
  });
  return { user, client, grant, verifier, code };
}
async function exchange(input: Record<string, string>, peer?: string) {
  return tokenExchange(
    new Request('http://localhost:3000/oauth/mcp/token', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        ...(peer ? { 'x-forwarded-for': peer } : {}),
      },
      body: new URLSearchParams({ resource: mcpResource(), ...input }).toString(),
    })
  );
}
async function access(f: Awaited<ReturnType<typeof fixture>>) {
  const response = await exchange({
    client_id: f.client.id,
    grant_type: 'authorization_code',
    code: f.code,
    code_verifier: f.verifier,
    redirect_uri: f.client.redirectUris[0],
  });
  expect(response.status).toBe(200);
  return (await response.json()) as { access_token: string; refresh_token: string };
}
async function context(f: Awaited<ReturnType<typeof fixture>>): Promise<ExecutionContext> {
  const token = await access(f);
  const principal = await authenticateMcp(
    new Request(mcpResource(), { headers: { authorization: `Bearer ${token.access_token}` } }),
    1
  );
  return {
    grantId: principal.grantId,
    credentialId: principal.credentialId,
    tokenScopes: principal.tokenScopes,
    requestId: 'integration-test',
    budget: new CostBudget(),
  };
}

describe('MCP PostgreSQL security and replay boundaries', () => {
  it('reloads the current role, memberships and scope intersection in each authority snapshot', async () => {
    const f = await fixture();
    const team = await db.team.create({ data: { name: `MCP authority ${f.user.id}` } });
    const before = await resolveMcpGrant(f.grant.id);
    expect(before.actor.role).toBe('ADMIN');
    expect(before.actor.teamIds).toEqual([]);
    await db.teamMember.create({ data: { userId: f.user.id, teamId: team.id } });
    await db.user.update({ where: { id: f.user.id }, data: { role: 'USER' } });
    await db.mcpClient.update({ where: { id: f.client.id }, data: { scopes: ['incidents:read'] } });
    const after = await resolveMcpGrant(f.grant.id);
    expect(after.actor.role).toBe('USER');
    expect(after.actor.teamIds).toEqual([team.id]);
    expect(after.apiKey.scopes).toEqual(['incidents:read']);
    await db.teamMember.deleteMany({ where: { userId: f.user.id } });
    expect((await resolveMcpGrant(f.grant.id)).actor.teamIds).toEqual([]);
    await db.user.update({ where: { id: f.user.id }, data: { tokenVersion: { increment: 1 } } });
    await expect(resolveMcpGrant(f.grant.id)).rejects.toThrow('MCP_INACTIVE_PRINCIPAL');
  });
  it('binds parameterized authority snapshots to the exact grant and live credential', async () => {
    const f = await fixture();
    const ctx = await context(f);
    const other = await fixture();
    await expect(resolveMcpGrant(other.grant.id, ctx.credentialId)).rejects.toThrow(
      'MCP_INVALID_GRANT'
    );
    await expect(resolveMcpGrant("' OR 1=1 --")).rejects.toThrow('MCP_INVALID_GRANT');
    await db.mcpToken.update({
      where: { id: ctx.credentialId },
      data: { accessExpiresAt: new Date(0) },
    });
    await expect(resolveMcpGrant(f.grant.id, ctx.credentialId)).rejects.toThrow(
      'MCP_INVALID_GRANT'
    );
    await db.mcpGrant.update({ where: { id: f.grant.id }, data: { expiresAt: new Date(0) } });
    await expect(resolveMcpGrant(f.grant.id)).rejects.toThrow('MCP_INVALID_GRANT');
  });
  it('rejects unauthenticated slow bodies before reading them or holding work admission', async () => {
    await fixture();
    const requests = Array.from(
      { length: 4 },
      (_, index) =>
        new Request('http://localhost:3000/mcp', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(index % 2 ? { authorization: `Bearer ${'x'.repeat(43)}` } : {}),
          },
          body: new ReadableStream({ start() {} }),
          duplex: 'half',
        } as RequestInit & { duplex: 'half' })
    );
    try {
      const responses = await Promise.all(requests.map(request => mcpRequest(request)));
      expect(responses.map(response => response.status)).toEqual([401, 401, 401, 401]);
      expect(requests.every(request => !request.bodyUsed)).toBe(true);
    } finally {
      await Promise.all(requests.map(request => request.body?.cancel()));
    }
  });
  it.each(['grant', 'client', 'scope', 'token', 'policy', 'role'] as const)(
    'rechecks %s authority after an authenticated request pauses its upload',
    async kind => {
      const f = await fixture();
      const token = await access(f);
      let controller!: ReadableStreamDefaultController<Uint8Array>;
      let started!: () => void;
      const reading = new Promise<void>(resolve => {
        started = resolve;
      });
      const body = new ReadableStream<Uint8Array>(
        {
          start(value) {
            controller = value;
          },
          pull() {
            started();
          },
        },
        { highWaterMark: 0 }
      );
      const request = new Request(mcpResource(), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          authorization: `Bearer ${token.access_token}`,
          'mcp-protocol-version': '2026-07-28',
          'mcp-method': 'tools/list',
        },
        body,
        duplex: 'half',
      } as RequestInit & { duplex: 'half' });
      const pending = mcpRequest(request);
      await reading;
      if (kind === 'grant')
        await db.mcpGrant.update({ where: { id: f.grant.id }, data: { revokedAt: new Date() } });
      if (kind === 'client')
        await db.mcpClient.update({ where: { id: f.client.id }, data: { revokedAt: new Date() } });
      if (kind === 'scope')
        await db.mcpClient.update({ where: { id: f.client.id }, data: { scopes: [] } });
      if (kind === 'token')
        await db.mcpToken.updateMany({
          where: { grantId: f.grant.id },
          data: { accessExpiresAt: new Date(0) },
        });
      if (kind === 'policy')
        await db.mcpPolicy.update({ where: { id: 'default' }, data: { enabled: false } });
      if (kind === 'role')
        await db.user.update({ where: { id: f.user.id }, data: { role: 'AUDITOR' } });
      controller.enqueue(
        new TextEncoder().encode(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/list',
            params: {
              _meta: {
                'io.modelcontextprotocol/protocolVersion': '2026-07-28',
                'io.modelcontextprotocol/clientCapabilities': {},
                'io.modelcontextprotocol/clientInfo': { name: 'gated-security-test', version: '1' },
              },
            },
          })
        )
      );
      controller.close();
      const response = await pending;
      if (kind === 'scope' || kind === 'role') {
        expect(response.status).toBe(200);
        const result = await response.json();
        expect(JSON.stringify(result)).not.toContain('incident_acknowledge');
      } else expect(response.status).toBe(kind === 'policy' ? 503 : 401);
    }
  );
  it('does not let malformed requests from one known peer exhaust another peer’s token admission', async () => {
    const f = await fixture();
    const globalBefore = await db.rateLimit.aggregate({
      where: { key: { startsWith: 'mcp:oauth:token:global:' } },
      _sum: { count: true },
    });
    const previous = process.env.TRUST_PROXY_HEADERS;
    process.env.TRUST_PROXY_HEADERS = 'true';
    try {
      let response: Response | undefined;
      for (let i = 0; i < 121; i++)
        response = await exchange({ invalid: 'malformed' }, '198.51.100.10');
      expect(response?.status).toBe(429);
      const valid = await exchange(
        {
          client_id: f.client.id,
          grant_type: 'authorization_code',
          code: f.code,
          code_verifier: f.verifier,
          redirect_uri: f.client.redirectUris[0],
        },
        '198.51.100.11'
      );
      expect(valid.status).toBe(200);
      const globalAfter = await db.rateLimit.aggregate({
        where: { key: { startsWith: 'mcp:oauth:token:global:' } },
        _sum: { count: true },
      });
      expect(globalAfter._sum.count! - (globalBefore._sum.count ?? 0)).toBeLessThanOrEqual(61);
    } finally {
      if (previous === undefined) delete process.env.TRUST_PROXY_HEADERS;
      else process.env.TRUST_PROXY_HEADERS = previous;
    }
  });
  it('preserves the shared expensive-operation quota even when the top-level MCP allowance is larger', async () => {
    const f = await fixture('ADMIN', [
      'services:read',
      'incidents:read',
      'notifications:read',
      'service-objectives:read',
      'escalation-policies:read',
      'schedules:read',
    ]);
    const ctx = await context(f);
    await db.mcpPolicy.update({ where: { id: 'default' }, data: { requestsPerMinute: 600 } });
    const service = await createTestService('Protected health projection');
    // Capacity already consumed by another replica must still protect this process.
    const window = Math.floor(Date.now() / 60000);
    await db.rateLimit.create({
      data: {
        key: `api:v2:mcp:${f.grant.id}:SEARCH_EXPORT:${window}`,
        count: 30,
        expiresAt: new Date((window + 1) * 60000),
      },
    });
    await expect(
      callMcpOperation(ctx, 'getServiceHealthSummary', { path: { id: service.id } })
    ).rejects.toMatchObject({ status: 429 });
    expect(
      (
        await db.rateLimit.findFirstOrThrow({
          where: { key: { startsWith: `api:v2:mcp:${f.grant.id}:SEARCH_EXPORT:` } },
        })
      ).count
    ).toBe(31);
  });
  it('executes joined service health with its complete native scope intersection', async () => {
    const scopes = [
      'services:read',
      'incidents:read',
      'notifications:read',
      'service-objectives:read',
      'escalation-policies:read',
      'schedules:read',
    ];
    const f = await fixture('ADMIN', scopes);
    const ctx = await context(f);
    const service = await createTestService('Joined health context');
    const result = await callMcpOperation(ctx, 'getServiceHealthSummary', {
      path: { id: service.id },
    });
    expect(result.evidence.operationId).toBe('getServiceHealthSummary');
    expect(JSON.stringify(result.data)).toContain(service.id);
  });
  it('caps actual serialized MCP results including text and structured-content copies', async () => {
    const f = await fixture('ADMIN', ['incidents:read']);
    const tokens = await access(f);
    const service = await createTestService('Wire budget service');
    await db.incident.createMany({
      data: Array.from({ length: 20 }, (_, i) => ({
        title: `Large evidence ${i}`,
        description: 'x'.repeat(10000),
        serviceId: service.id,
        status: 'OPEN' as const,
        urgency: 'HIGH' as const,
      })),
    });
    const response = await mcpRequest(
      new Request(mcpResource(), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${tokens.access_token}`,
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
            arguments: { query: { limit: 25 } },
            _meta: {
              'io.modelcontextprotocol/protocolVersion': '2026-07-28',
              'io.modelcontextprotocol/clientInfo': { name: 'wire-regression', version: '1' },
              'io.modelcontextprotocol/clientCapabilities': {},
            },
          },
        }),
      })
    );
    expect(response.status).toBe(413);
    const text = await response.text();
    expect(Buffer.byteLength(text)).toBeLessThan(262144);
    expect(JSON.parse(text).error.message).toBe('MCP_RESULT_BUDGET_EXCEEDED');
  });
  it('returns incident context through the actual MCP transport with canonical child arguments', async () => {
    const f = await fixture('ADMIN', ['incidents:read']);
    const tokens = await access(f);
    const service = await createTestService('Context service');
    const incident = await createTestIncident('Context evidence', service.id);
    const response = await mcpRequest(
      new Request(mcpResource(), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${tokens.access_token}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'mcp-protocol-version': '2026-07-28',
          'mcp-method': 'tools/call',
          'mcp-name': 'incident_get_context',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'incident_get_context',
            arguments: { id: incident.id },
            _meta: {
              'io.modelcontextprotocol/protocolVersion': '2026-07-28',
              'io.modelcontextprotocol/clientInfo': { name: 'context-regression', version: '1' },
              'io.modelcontextprotocol/clientCapabilities': {},
            },
          },
        }),
      })
    );
    expect(response.status).toBe(200);
    const output = await response.json();
    expect(output.result.isError).not.toBe(true);
    expect(output.result.structuredContent.rootCause).toEqual({
      status: 'unknown',
      confirmed: false,
    });
    expect(output.result.structuredContent.related).toBeDefined();
    expect(JSON.stringify(output.result.structuredContent.incident)).toContain(incident.id);
    expect(
      (
        await db.rateLimit.findFirstOrThrow({
          where: { key: { startsWith: `mcp:${f.grant.id}:` } },
        })
      ).count
    ).toBe(3);
  });
  it.each(['ADMIN', 'RESPONDER', 'AUDITOR', 'USER'] as const)(
    'preserves %s visibility and applies team removal on the next read',
    async role => {
      const f = await fixture(role, ['incidents:read']);
      const ctx = await context(f);
      const team = await db.team.create({ data: { name: `MCP ${role} team` } });
      await db.teamMember.create({ data: { teamId: team.id, userId: f.user.id } });
      const service = await createTestService('Scoped service', team.id);
      const incident = await createTestIncident('Team public incident', service.id);
      await callMcpOperation(ctx, 'getIncident', { path: { id: incident.id } });
      const privateIncident = await createTestIncident('Private incident', service.id, {
        visibility: 'PRIVATE',
      });
      if (role === 'USER')
        await expect(
          callMcpOperation(ctx, 'getIncident', { path: { id: privateIncident.id } })
        ).rejects.toThrow('MCP_RESOURCE_UNAVAILABLE');
      else await callMcpOperation(ctx, 'getIncident', { path: { id: privateIncident.id } });
      await db.teamMember.deleteMany({ where: { teamId: team.id, userId: f.user.id } });
      if (role === 'USER')
        await expect(
          callMcpOperation(ctx, 'getIncident', { path: { id: incident.id } })
        ).rejects.toThrow('MCP_RESOURCE_UNAVAILABLE');
      else await callMcpOperation(ctx, 'getIncident', { path: { id: incident.id } });
    }
  );
  it('requires PKCE and persists only keyed digests', async () => {
    const f = await fixture();
    expect(
      (
        await exchange({
          client_id: f.client.id,
          grant_type: 'authorization_code',
          code: f.code,
          code_verifier: 'b'.repeat(43),
          redirect_uri: f.client.redirectUris[0],
        })
      ).status
    ).toBe(400);
    const tokens = await access(f);
    const persisted = await db.mcpToken.findFirstOrThrow({ where: { grantId: f.grant.id } });
    expect(persisted.accessHash).toBe(digestMcpSecret(tokens.access_token));
    expect(JSON.stringify(persisted)).not.toContain(tokens.access_token);
    expect(
      JSON.stringify(
        await db.mcpAuthorizationCode.findFirstOrThrow({ where: { grantId: f.grant.id } })
      )
    ).not.toContain(f.code);
  });
  it('rotates refresh tokens, downscopes, detects reuse and revokes the entire grant', async () => {
    const f = await fixture();
    const tokens = await access(f);
    const request = {
      client_id: f.client.id,
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      scope: 'incidents:read',
    };
    const refreshed = await exchange(request);
    expect(refreshed.status).toBe(200);
    const newTokens = await refreshed.json();
    expect(newTokens.scope).toBe('incidents:read');
    expect((await exchange(request)).status).toBe(400);
    expect(
      (await db.mcpGrant.findUniqueOrThrow({ where: { id: f.grant.id } })).revokedAt
    ).not.toBeNull();
    await expect(
      authenticateMcp(
        new Request(mcpResource(), {
          headers: { authorization: `Bearer ${newTokens.access_token}` },
        }),
        1
      )
    ).rejects.toThrow();
  });
  it('allows one authorization-code redemption under concurrent retries', async () => {
    const f = await fixture();
    const request = {
      client_id: f.client.id,
      grant_type: 'authorization_code',
      code: f.code,
      code_verifier: f.verifier,
      redirect_uri: f.client.redirectUris[0],
    };
    const responses = await Promise.all([exchange(request), exchange(request)]);
    expect(responses.filter(response => response.status === 200)).toHaveLength(1);
    expect(await db.mcpToken.count({ where: { grantId: f.grant.id } })).toBe(1);
  });
  it('revokes only credentials belonging to the authenticated client identifier and conceals existence', async () => {
    const f = await fixture();
    const tokens = await access(f);
    const revoke = (clientId: string) =>
      revokeToken(
        new Request('http://localhost:3000/oauth/mcp/revoke', {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: clientId,
            token: tokens.refresh_token,
          }).toString(),
        })
      );
    expect((await revoke('different-client')).status).toBe(200);
    expect(
      (await db.mcpGrant.findUniqueOrThrow({ where: { id: f.grant.id } })).revokedAt
    ).toBeNull();
    expect((await revoke(f.client.id)).status).toBe(200);
    await expect(resolveMcpGrant(f.grant.id)).rejects.toThrow();
  });
  it('rejects a token rotated between composed-operation boundaries', async () => {
    const f = await fixture();
    const ctx = await context(f);
    await db.mcpToken.update({ where: { id: ctx.credentialId }, data: { rotatedAt: new Date() } });
    const service = await createTestService('Rotated-token service');
    const incident = await createTestIncident('Rotated-token incident', service.id);
    await expect(
      callMcpOperation(ctx, 'getIncident', { path: { id: incident.id } })
    ).rejects.toThrow('MCP_INVALID_GRANT');
  });
  it('immediately rejects disabled users and revoked clients or grants', async () => {
    const f = await fixture();
    await resolveMcpGrant(f.grant.id);
    await db.user.update({ where: { id: f.user.id }, data: { status: 'DISABLED' } });
    await expect(resolveMcpGrant(f.grant.id)).rejects.toThrow();
    await db.user.update({ where: { id: f.user.id }, data: { status: 'ACTIVE' } });
    await db.mcpClient.update({ where: { id: f.client.id }, data: { revokedAt: new Date() } });
    await expect(resolveMcpGrant(f.grant.id)).rejects.toThrow();
  });
  it('denies unscoped and wrong-resource reads without exposing private incident content', async () => {
    const f = await fixture('USER', ['incidents:read']);
    const ctx = await context(f);
    const service = await createTestService('Private service');
    const incident = await createTestIncident('Do not disclose this', service.id, {
      visibility: 'PRIVATE',
    });
    await expect(
      callMcpOperation(ctx, 'getIncident', { path: { id: incident.id } })
    ).rejects.toThrow('MCP_RESOURCE_UNAVAILABLE');
    await expect(callMcpOperation(ctx, 'getService', { path: { id: service.id } })).rejects.toThrow(
      'MCP_OPERATION_FORBIDDEN'
    );
  });
  it('runs the canonical mutation once with one timeline/audit result across retries', async () => {
    const f = await fixture();
    const ctx = await context(f);
    const service = await createTestService('Parity service');
    const incident = await createTestIncident('Replay incident', service.id);
    const args = {
      path: { id: incident.id },
      body: { content: 'One durable note' },
      idempotencyKey: 'mcp-note-idempotent-1',
    };
    await callMcpOperation(ctx, 'addIncidentNote', args);
    await callMcpOperation(ctx, 'addIncidentNote', args);
    expect(await db.incidentNote.count({ where: { incidentId: incident.id } })).toBe(1);
    expect(
      await db.auditLog.count({ where: { action: 'incident.note_added', entityId: incident.id } })
    ).toBe(1);
    // Ordinary reads do not amplify quota writes; protected mutation limits remain.
    expect(
      await db.rateLimit.count({ where: { key: { startsWith: `api:v2:mcp:${f.grant.id}:READ:` } } })
    ).toBe(0);
    expect(
      (
        await db.rateLimit.findFirstOrThrow({
          where: { key: { startsWith: `api:v2:mcp:${f.grant.id}:WRITE:` } },
        })
      ).count
    ).toBe(2);
  });
  it('rejects authority changes and the MCP kill switch between plan steps', async () => {
    const f = await fixture();
    const ctx = await context(f);
    const service = await createTestService('Revocation service');
    const incident = await createTestIncident('Revocation incident', service.id);
    await callMcpOperation(ctx, 'getIncident', { path: { id: incident.id } });
    await db.mcpGrant.update({ where: { id: f.grant.id }, data: { revokedAt: new Date() } });
    await expect(
      callMcpOperation(ctx, 'getIncident', { path: { id: incident.id } })
    ).rejects.toThrow();
    await db.mcpPolicy.update({ where: { id: 'default' }, data: { enabled: false } });
    await expect(
      callMcpOperation(ctx, 'getIncident', { path: { id: incident.id } })
    ).rejects.toThrow('MCP_OPERATION_DISABLED');
  });
  it('rejects cycles and writes before a plan performs any domain work', async () => {
    const f = await fixture();
    const ctx = await context(f);
    await expect(
      executeMcpPlan(ctx, {
        steps: [{ id: 'a', operationId: 'addIncidentNote', args: {}, dependsOn: [] }],
      })
    ).rejects.toThrow('MCP_PLAN_READS_ONLY');
    await expect(
      executeMcpPlan(ctx, {
        steps: [
          { id: 'a', operationId: 'getIncident', args: {}, dependsOn: ['b'] },
          { id: 'b', operationId: 'getIncident', args: {}, dependsOn: ['a'] },
        ],
      })
    ).rejects.toThrow('MCP_CYCLIC_PLAN');
  });
});
