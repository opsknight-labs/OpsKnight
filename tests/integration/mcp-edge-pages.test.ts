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
import {
  MY_PAGES_URI,
  pollChanges,
  resetSubscriptionStateForTests,
} from '@/lib/mcp/protocol/subscriptions';
import {
  emptyEscalationNotificationPlan,
  materializeEscalationNotificationIntents,
} from '@/lib/escalation/notification-intents';
import { POST } from '@/app/mcp/route';

beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (!url.pathname.endsWith('_test') || !['localhost', '127.0.0.1'].includes(url.hostname))
    throw new Error('Owned local test database required');
  process.env.MCP_PUBLIC_ORIGIN = 'http://localhost:3000';
  process.env.MCP_DATABASE_URL = process.env.DATABASE_URL;
  await resetDatabase();
}, 300000);
beforeEach(async () => {
  resetSubscriptionStateForTests();
  const policy = { enabled: true, writesEnabled: false, requestsPerMinute: 600, maxOperations: 8 };
  await db.mcpPolicy.upsert({ where: { id: 'default' }, create: policy, update: policy });
});
afterEach(() => resetSubscriptionStateForTests());

const scopes = ['incidents:read', 'services:read'];
async function principal(role: 'ADMIN' | 'RESPONDER' | 'USER' = 'RESPONDER') {
  const user = await createTestUser({ role });
  const client = await db.mcpClient.create({
    data: { name: 'Page push', scopes, redirectUris: ['http://localhost/callback'] },
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
function listen(bearer: string) {
  const method = 'subscriptions/listen';
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
          notifications: { resourceSubscriptions: [MY_PAGES_URI] },
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2026-07-28',
            'io.modelcontextprotocol/clientCapabilities': {},
            'io.modelcontextprotocol/clientInfo': { name: 'pages', version: '1' },
          },
        },
      }),
    })
  );
}

type Message = { method?: string; params?: Record<string, unknown> };
type Stream = {
  reader: ReadableStreamDefaultReader<Uint8Array>;
  buffer: string;
  pending?: Promise<ReadableStreamReadResult<Uint8Array>>;
};
/** Reads SSE frames until one matches; a timed-out read stays pending for the next call. */
async function nextEvent(
  stream: Stream,
  predicate: (message: Message) => boolean,
  timeoutMs = 3000
): Promise<Message | null> {
  const decoder = new TextDecoder();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    stream.pending ??= stream.reader.read();
    const chunk = await Promise.race([
      stream.pending,
      new Promise<null>(resolve => setTimeout(() => resolve(null), deadline - Date.now())),
    ]);
    if (!chunk) return null;
    stream.pending = undefined;
    if (chunk.done) return null;
    stream.buffer += decoder.decode(chunk.value, { stream: true });
    let index;
    while ((index = stream.buffer.indexOf('\n\n')) >= 0) {
      const frame = stream.buffer.slice(0, index);
      stream.buffer = stream.buffer.slice(index + 2);
      const data = frame
        .split('\n')
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).trim())
        .join('');
      if (!data) continue;
      const message = JSON.parse(data) as Message;
      if (predicate(message)) return message;
    }
  }
  return null;
}

/** Pages `userIds` for `incidentId` through escalation's own durable write. */
async function page(incidentId: string, userIds: string[]) {
  const plan = emptyEscalationNotificationPlan(
    incidentId,
    `test-${randomBytes(6).toString('hex')}`
  );
  plan.inAppUserIds = userIds;
  plan.displayMessage = 'Page';
  await db.$transaction(tx => materializeEscalationNotificationIntents(tx, plan));
}

async function openStream(bearer: string) {
  const response = await listen(bearer);
  expect(response.status).toBe(200);
  const reader: Stream = { reader: response.body!.getReader(), buffer: '' };
  const ack = await nextEvent(reader, m => m.method === 'notifications/subscriptions/acknowledged');
  expect(ack?.params?.notifications).toMatchObject({ resourceSubscriptions: [MY_PAGES_URI] });
  return reader;
}
const isPage = (m: Message) =>
  m.method === 'notifications/resources/updated' && m.params?.uri === MY_PAGES_URI;

describe('opsknight://oncall/me/pages', () => {
  it('delivers my page with minimal fields and never someone else’s', async () => {
    const me = await principal();
    const other = await principal();
    const service = await createTestService('Paged service');
    const mine = await createTestIncident('Disk full', service.id, {
      description: 'SECRET alert payload',
    });
    const theirs = await createTestIncident('Their incident', service.id);
    const reader = await openStream(me.bearer);

    await page(theirs.id, [other.user.id]);
    await pollChanges();
    expect(await nextEvent(reader, isPage, 600)).toBeNull();

    await page(mine.id, [me.user.id]);
    await pollChanges();
    const event = await nextEvent(reader, isPage);
    expect(event?.params?._meta).toMatchObject({
      'com.opsknight/page': {
        incidentId: mine.id,
        title: 'Disk full',
        urgency: mine.urgency,
        priority: mine.priority,
        serviceId: service.id,
      },
    });
    expect(JSON.stringify(event)).not.toContain('SECRET');
    // A page is delivered once, not on every poll.
    await pollChanges();
    expect(await nextEvent(reader, isPage, 600)).toBeNull();
    await reader.reader.cancel();
  });

  it('withholds a page for an incident the person cannot read', async () => {
    const me = await principal('USER');
    const team = await createTestTeam('Mine');
    await db.teamMember.create({ data: { teamId: team.id, userId: me.user.id, role: 'MEMBER' } });
    const hiddenTeam = await createTestTeam('Hidden');
    const hiddenService = await createTestService('Hidden service', hiddenTeam.id);
    const hidden = await createTestIncident('Hidden incident', hiddenService.id, {
      teamId: hiddenTeam.id,
    });
    const visibleService = await createTestService('Visible service', team.id);
    const visible = await createTestIncident('Visible incident', visibleService.id, {
      teamId: team.id,
    });
    const reader = await openStream(me.bearer);
    await page(hidden.id, [me.user.id]);
    await pollChanges();
    await page(visible.id, [me.user.id]);
    await pollChanges();
    // Only the readable incident arrives; the hidden one never does.
    const first = await nextEvent(reader, isPage);
    expect(first?.params?._meta).toMatchObject({
      'com.opsknight/page': { incidentId: visible.id },
    });
    expect(await nextEvent(reader, isPage, 800)).toBeNull();
    await reader.reader.cancel();
  });

  it('stops delivering when the grant is revoked', async () => {
    resetSubscriptionStateForTests(150);
    const me = await principal();
    const service = await createTestService('Revoked service');
    const incident = await createTestIncident('After revoke', service.id);
    const reader = await openStream(me.bearer);
    await db.mcpGrant.update({ where: { id: me.grant.id }, data: { revokedAt: new Date() } });
    await page(incident.id, [me.user.id]);
    await pollChanges();
    // Either the stream has already ended or the page is withheld; it is never delivered.
    expect(await nextEvent(reader, isPage, 1500)).toBeNull();
    await reader.reader.cancel().catch(() => undefined);
  });

  it('refuses the collection without incident read authority', async () => {
    const me = await principal();
    await db.mcpGrant.update({ where: { id: me.grant.id }, data: { scopes: ['services:read'] } });
    await db.mcpToken.updateMany({
      where: { grantId: me.grant.id },
      data: { scopes: ['services:read'] },
    });
    const response = await listen(me.bearer);
    const body = await response.text();
    expect(body).toContain('resource unavailable');
  });
});
