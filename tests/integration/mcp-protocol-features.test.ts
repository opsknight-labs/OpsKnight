// @vitest-environment node
import { randomBytes } from 'node:crypto';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createTestIncident,
  createTestService,
  createTestTeam,
  createTestUser,
  resetDatabase,
  testPrisma as db,
} from '../helpers/test-db';
import { digestMcpSecret, mcpResource } from '@/lib/mcp/auth/config';
import { pollChanges, resetSubscriptionStateForTests } from '@/lib/mcp/protocol/subscriptions';
import { POST } from '@/app/mcp/route';

beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (!url.pathname.endsWith('_test') || !['localhost', '127.0.0.1'].includes(url.hostname))
    throw new Error('Owned local test database required');
  process.env.MCP_PUBLIC_ORIGIN = 'http://localhost:3000';
  process.env.MCP_DATABASE_URL = process.env.DATABASE_URL;
  await resetDatabase();
}, 60000);
beforeEach(async () => {
  resetSubscriptionStateForTests();
  const policy = { enabled: true, writesEnabled: false, requestsPerMinute: 600, maxOperations: 8 };
  await db.mcpPolicy.upsert({ where: { id: 'default' }, create: policy, update: policy });
});
afterEach(() => resetSubscriptionStateForTests());

const scopes = ['incidents:read', 'services:read'];
async function principal(role: 'ADMIN' | 'RESPONDER' | 'USER' = 'ADMIN') {
  const user = await createTestUser({ role });
  const client = await db.mcpClient.create({
    data: { name: 'Protocol features', scopes, redirectUris: ['http://localhost/callback'] },
  });
  const grant = await db.mcpGrant.create({
    data: {
      clientId: client.id,
      userId: user.id,
      userTokenVersion: user.tokenVersion,
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
  return { user, grant, bearer };
}

let rpcId = 0;
function call(bearer: string, method: string, params: Record<string, unknown> = {}) {
  return POST(
    new Request(mcpResource(), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${bearer}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2026-07-28',
        'mcp-method': method,
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
            'io.modelcontextprotocol/clientInfo': { name: 'protocol-features', version: '1' },
          },
        },
      }),
    })
  );
}

/** Reads SSE frames until `predicate` matches one, or the deadline passes. */
async function nextEvent(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  predicate: (message: { method?: string; params?: Record<string, unknown> }) => boolean,
  timeoutMs = 4000
) {
  const decoder = new TextDecoder();
  let buffer = '';
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const chunk = await Promise.race([
      reader.read(),
      new Promise<{ done: true; value: undefined }>(resolve =>
        setTimeout(() => resolve({ done: true, value: undefined }), deadline - Date.now())
      ),
    ]);
    if (chunk.done) return null;
    buffer += decoder.decode(chunk.value, { stream: true });
    let index;
    while ((index = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      const data = frame
        .split('\n')
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).trim())
        .join('');
      if (!data) continue;
      const message = JSON.parse(data);
      if (predicate(message)) return message;
    }
  }
  return null;
}

async function listen(bearer: string, notifications: Record<string, unknown>) {
  const response = await call(bearer, 'subscriptions/listen', { notifications });
  return response;
}

describe('completions over the authenticated wire', () => {
  it('suggests only ids the principal can list, filtered by prefix', async () => {
    const admin = await principal('ADMIN');
    const outsider = await principal('USER');
    const team = await createTestTeam('Completion team');
    const service = await createTestService('Completion service', team.id);
    const visible = await createTestIncident('Visible', service.id, { visibility: 'PUBLIC' });
    const hidden = await createTestIncident('Hidden', service.id, {
      visibility: 'PRIVATE',
      teamId: team.id,
    });
    const complete = async (bearer: string, value: string) =>
      (
        await (
          await call(bearer, 'completion/complete', {
            ref: { type: 'ref/resource', uri: 'opsknight://incidents/{id}' },
            argument: { name: 'id', value },
          })
        ).json()
      ).result.completion.values as string[];
    expect(await complete(admin.bearer, '')).toEqual(
      expect.arrayContaining([visible.id, hidden.id])
    );
    expect(await complete(admin.bearer, hidden.id.slice(0, 12))).toContain(hidden.id);
    const outsiderValues = await complete(outsider.bearer, '');
    expect(outsiderValues).not.toContain(hidden.id);
    expect(await complete(outsider.bearer, hidden.id)).toEqual([]);
    const prompt = await (
      await call(admin.bearer, 'completion/complete', {
        ref: { type: 'ref/prompt', name: 'investigate_incident' },
        argument: { name: 'incidentId', value: visible.id.slice(0, 10) },
      })
    ).json();
    expect(prompt.result.completion.values).toContain(visible.id);
  });
});

describe('subscriptions/listen', () => {
  it('advertises subscribe capability honestly', async () => {
    const admin = await principal();
    const discover = await (await call(admin.bearer, 'server/discover')).json();
    expect(discover.result.capabilities.resources).toMatchObject({ subscribe: true });
    expect(discover.result.capabilities.tools).toMatchObject({ listChanged: true });
  });

  it('refuses unreadable and nonexistent URIs identically and caps the subscription size', async () => {
    const outsider = await principal('USER');
    const team = await createTestTeam('Private team');
    const service = await createTestService('Private service', team.id);
    const hidden = await createTestIncident('Hidden', service.id, {
      visibility: 'PRIVATE',
      teamId: team.id,
    });
    const forbidden = await (
      await listen(outsider.bearer, {
        resourceSubscriptions: [`opsknight://incidents/${hidden.id}`],
      })
    ).json();
    const missing = await (
      await listen(outsider.bearer, {
        resourceSubscriptions: ['opsknight://incidents/cmcpdoesnotexist0000000001'],
      })
    ).json();
    expect(forbidden.error).toEqual(missing.error);
    expect(forbidden.error.code).toBe(-32602);
    const tooMany = await listen(outsider.bearer, {
      resourceSubscriptions: Array.from({ length: 6 }, (_, i) => `opsknight://incidents/x${i}`),
    });
    expect(tooMany.status).toBeGreaterThanOrEqual(400);
    const arbitrary = await listen(outsider.bearer, {
      resourceSubscriptions: ['https://evil.example.com/x'],
    });
    expect(arbitrary.status).toBeGreaterThanOrEqual(400);
  });

  it('delivers a URI-only hint when an authorized resource changes, and releases on cancel', async () => {
    const admin = await principal();
    const service = await createTestService('Watched service');
    const incident = await createTestIncident('Watched', service.id);
    const uri = `opsknight://incidents/${incident.id}`;
    const response = await listen(admin.bearer, { resourceSubscriptions: [uri] });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    // Reverse proxies (nginx) must pass events straight through, not buffer them (CERT-07).
    expect(response.headers.get('x-accel-buffering')).toBe('no');
    const reader = response.body!.getReader();
    const ack = await nextEvent(
      reader,
      m => m.method === 'notifications/subscriptions/acknowledged'
    );
    expect(ack?.params?.notifications).toMatchObject({ resourceSubscriptions: [uri] });
    await pollChanges(); // baseline
    await db.incident.update({ where: { id: incident.id }, data: { title: 'Changed title' } });
    await pollChanges();
    const updated = await nextEvent(reader, m => m.method === 'notifications/resources/updated');
    expect(updated?.params).toMatchObject({ uri });
    // The hint never carries the changed data itself.
    expect(JSON.stringify(updated)).not.toContain('Changed title');
    await reader.cancel();
    // Both stream slots for this grant are free again after cancellation.
    const again = [
      await listen(admin.bearer, { toolsListChanged: true }),
      await listen(admin.bearer, { toolsListChanged: true }),
    ];
    expect(again.map(r => r.status)).toEqual([200, 200]);
    await Promise.all(again.map(r => r.body!.cancel()));
  });

  it('ends a listen stream and frees its slot when the client aborts the request (CERT-12)', async () => {
    const admin = await principal();
    const holders = await Promise.all(
      [0, 1].map(async () => {
        const controller = new AbortController();
        const response = await POST(
          new Request(mcpResource(), {
            method: 'POST',
            signal: controller.signal,
            headers: {
              authorization: `Bearer ${admin.bearer}`,
              'content-type': 'application/json',
              accept: 'application/json, text/event-stream',
              'mcp-protocol-version': '2026-07-28',
              'mcp-method': 'subscriptions/listen',
            },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: ++rpcId,
              method: 'subscriptions/listen',
              params: {
                notifications: { toolsListChanged: true },
                _meta: {
                  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
                  'io.modelcontextprotocol/clientCapabilities': {},
                  'io.modelcontextprotocol/clientInfo': { name: 'abort', version: '1' },
                },
              },
            }),
          })
        );
        expect(response.status).toBe(200);
        const reader = response.body!.getReader();
        await nextEvent(reader, m => m.method === 'notifications/subscriptions/acknowledged');
        return { controller, reader };
      })
    );
    // Both slots are held, so a third stream is refused until the aborts land.
    expect((await listen(admin.bearer, { toolsListChanged: true })).status).toBe(429);
    for (const { controller } of holders) controller.abort();
    for (const { reader } of holders) {
      const ended = await Promise.race([
        reader.read().then(
          chunk => chunk.done,
          () => true
        ),
        new Promise<false>(resolve => setTimeout(() => resolve(false), 3000)),
      ]);
      expect(ended).toBe(true);
    }
    await expect
      .poll(async () => {
        const next = await listen(admin.bearer, { toolsListChanged: true });
        await next.body?.cancel();
        return next.status;
      })
      .toBe(200);
  });

  it('bounds streams per grant and does not hold database admission while streaming', async () => {
    const admin = await principal();
    const streams = [
      await listen(admin.bearer, { toolsListChanged: true }),
      await listen(admin.bearer, { toolsListChanged: true }),
    ];
    expect(streams.map(r => r.status)).toEqual([200, 200]);
    const third = await listen(admin.bearer, { toolsListChanged: true });
    expect(third.status).toBe(429);
    // Ordinary requests still run while the grant has two open streams (default 4 DB slots).
    for (let i = 0; i < 5; i++) {
      const list = await call(admin.bearer, 'tools/list');
      expect(list.status).toBe(200);
    }
    await Promise.all(streams.map(r => r.body!.cancel()));
  });

  it('notifies tool-list changes when the MCP policy changes', async () => {
    const admin = await principal();
    const response = await listen(admin.bearer, { toolsListChanged: true });
    const reader = response.body!.getReader();
    await nextEvent(reader, m => m.method === 'notifications/subscriptions/acknowledged');
    await pollChanges();
    await db.mcpPolicy.update({ where: { id: 'default' }, data: { writesEnabled: true } });
    await pollChanges();
    expect(
      await nextEvent(reader, m => m.method === 'notifications/tools/list_changed')
    ).not.toBeNull();
    await reader.cancel();
  });

  it('closes the stream when the grant is revoked', async () => {
    resetSubscriptionStateForTests(150);
    const admin = await principal();
    const response = await listen(admin.bearer, { toolsListChanged: true });
    const reader = response.body!.getReader();
    await nextEvent(reader, m => m.method === 'notifications/subscriptions/acknowledged');
    await db.mcpGrant.update({ where: { id: admin.grant.id }, data: { revokedAt: new Date() } });
    const deadline = Date.now() + 5000;
    let ended = false;
    while (!ended && Date.now() < deadline) {
      const chunk = await Promise.race([
        reader.read(),
        new Promise<{ done: false; value: undefined }>(resolve =>
          setTimeout(() => resolve({ done: false, value: undefined }), 250)
        ),
      ]);
      ended = chunk.done;
    }
    expect(ended).toBe(true);
  });

  async function streamEnds(reader: ReadableStreamDefaultReader<Uint8Array>, withinMs = 5000) {
    const deadline = Date.now() + withinMs;
    while (Date.now() < deadline) {
      const chunk = await Promise.race([
        reader.read(),
        new Promise<{ done: false; value: undefined }>(resolve =>
          setTimeout(() => resolve({ done: false, value: undefined }), 250)
        ),
      ]);
      if (chunk.done) return true;
    }
    return false;
  }

  it('streams without proxy buffering (CERT-07)', async () => {
    const admin = await principal();
    const response = await listen(admin.bearer, { toolsListChanged: true });
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('x-accel-buffering')).toBe('no');
    await response.body!.cancel();
  });

  it('closes the stream when a subscribed incident moves to another team (SEC-13)', async () => {
    resetSubscriptionStateForTests(150);
    const viewer = await principal('USER');
    const team = await createTestTeam('Subscription owners');
    await db.teamMember.create({
      data: { teamId: team.id, userId: viewer.user.id, role: 'MEMBER' },
    });
    const service = await createTestService('Subscription owners service', team.id);
    // A USER reads only incidents of their own teams' services.
    const incident = await createTestIncident('Moved incident', service.id, {
      visibility: 'PUBLIC',
      teamId: team.id,
    });
    const response = await listen(viewer.bearer, {
      resourceSubscriptions: [`opsknight://incidents/${incident.id}`],
    });
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const reader = response.body!.getReader();
    await nextEvent(reader, m => m.method === 'notifications/subscriptions/acknowledged');
    // Still allowed: the stream survives several revalidation ticks.
    expect(await streamEnds(reader, 600)).toBe(false);
    // The person's role and teams are unchanged; only the resource's owner moved.
    const other = await createTestTeam('Other owners');
    const otherService = await createTestService('Other owners service', other.id);
    await db.incident.update({
      where: { id: incident.id },
      data: { teamId: other.id, serviceId: otherService.id },
    });
    expect(await streamEnds(reader)).toBe(true);
  });

  it('closes the stream when the person leaves a team (SEC-13)', async () => {
    resetSubscriptionStateForTests(150);
    const viewer = await principal('RESPONDER');
    const team = await createTestTeam('Subscription membership');
    await db.teamMember.create({
      data: { teamId: team.id, userId: viewer.user.id, role: 'MEMBER' },
    });
    const service = await createTestService('Membership service', team.id);
    const incident = await createTestIncident('Membership incident', service.id, {
      visibility: 'PRIVATE',
      teamId: team.id,
    });
    const response = await listen(viewer.bearer, {
      resourceSubscriptions: [`opsknight://incidents/${incident.id}`],
    });
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const reader = response.body!.getReader();
    await nextEvent(reader, m => m.method === 'notifications/subscriptions/acknowledged');
    expect(await streamEnds(reader, 600)).toBe(false);
    await db.teamMember.deleteMany({ where: { teamId: team.id, userId: viewer.user.id } });
    expect(await streamEnds(reader)).toBe(true);
  });

  it('ends the stream and frees its slot when the client aborts (CERT-12, node runtime)', async () => {
    const admin = await principal();
    const listenOnce = (signal?: AbortSignal) =>
      POST(
        new Request(mcpResource(), {
          method: 'POST',
          signal,
          headers: {
            authorization: `Bearer ${admin.bearer}`,
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
            'mcp-protocol-version': '2026-07-28',
            'mcp-method': 'subscriptions/listen',
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: ++rpcId,
            method: 'subscriptions/listen',
            params: {
              notifications: { toolsListChanged: true },
              _meta: {
                'io.modelcontextprotocol/protocolVersion': '2026-07-28',
                'io.modelcontextprotocol/clientCapabilities': {},
                'io.modelcontextprotocol/clientInfo': { name: 'abort', version: '1' },
              },
            },
          }),
        })
      );
    // AbortController here is Node's own, as in production, not a jsdom replacement.
    expect(typeof process.versions.node).toBe('string');
    expect(typeof (globalThis as { document?: unknown }).document).toBe('undefined');
    const controller = new AbortController();
    const response = await listenOnce(controller.signal);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const reader = response.body!.getReader();
    await nextEvent(reader, m => m.method === 'notifications/subscriptions/acknowledged');
    controller.abort();
    await reader.cancel();
    // Both per-connection stream slots are free again.
    const second = await listenOnce();
    const third = await listenOnce();
    expect(second.headers.get('content-type')).toContain('text/event-stream');
    expect(third.headers.get('content-type')).toContain('text/event-stream');
    await second.body!.cancel();
    await third.body!.cancel();
  });
});
