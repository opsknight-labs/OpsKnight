// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  config: {
    id: 'cfg',
    clientId: 'bot-app',
    tenantId: 'tenant-a' as string | null,
    tenantMode: 'SINGLE' as 'SINGLE' | 'MULTI',
  },
  upsert: vi.fn(),
  count: vi.fn(),
  updateMany: vi.fn(),
  incidentFindUnique: vi.fn(),
  enqueue: vi.fn(),
  findIncident: vi.fn(),
  reply: vi.fn(),
  squireOn: vi.fn(),
  audit: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    microsoftTeamsInstallation: { upsert: m.upsert, count: m.count, updateMany: m.updateMany },
    incident: { findUnique: m.incidentFindUnique },
  },
}));
vi.mock('@/lib/audit', () => ({ emitAuditEvent: m.audit }));
vi.mock('@/lib/microsoft-teams/lifecycle', () => ({
  revokeMicrosoftTeamsOperations: vi.fn(),
  revokeMicrosoftTeamsWarRoomProvisioning: vi.fn(),
  TEAMS_REVOCATION_TX_OPTIONS: {},
}));
vi.mock('@/lib/microsoft-teams/auth', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/microsoft-teams/auth')>();
  return {
    ...actual,
    assertMicrosoftTeamsActivityAuth: vi.fn(async () => ({ serviceUrl: null, appId: 'bot-app' })),
    getMicrosoftTeamsConfig: vi.fn(async () => ({ config: m.config, clientSecret: 's' })),
  };
});
vi.mock('@/lib/chatops/squire/teams', () => ({
  mentionsBot: (a: {
    recipient?: { id?: string };
    entities?: Array<{ type?: string; mentioned?: { id?: string } }>;
  }) =>
    Boolean(a.entities?.some(e => e?.type === 'mention' && e.mentioned?.id === a.recipient?.id)),
  enqueueTeamsSquireMention: m.enqueue,
  findTeamsWarRoomIncident: m.findIncident,
}));
vi.mock('@/lib/chatops/squire/switches', () => ({
  isSquireChatOpsEnabled: m.squireOn,
  chatBaseUrl: () => 'https://ops.example.com',
}));
vi.mock('@/lib/microsoft-teams/client', () => ({ replyToMicrosoftTeamsActivity: m.reply }));

import { NextRequest } from 'next/server';
import { POST } from '@/app/api/microsoft-teams/messages/route';

const post = (activity: unknown) =>
  POST(
    new NextRequest('http://localhost/api/microsoft-teams/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer t' },
      body: JSON.stringify(activity),
    })
  );

const install = (tenantId: string) => ({
  type: 'conversationUpdate',
  id: 'act-1',
  serviceUrl: 'https://smba.trafficmanager.net/amer/',
  recipient: { id: '28:bot' },
  membersAdded: [{ id: '28:bot' }],
  conversation: { id: '19:general@thread.tacv2', conversationType: 'channel' },
  channelData: { tenant: { id: tenantId }, team: { id: '19:team', aadGroupId: 'team-1' } },
});

const message = (overrides: Record<string, unknown> = {}) => ({
  type: 'message',
  id: 'msg-1',
  text: '<at>OpsKnight</at> what broke?',
  serviceUrl: 'https://smba.trafficmanager.net/amer/',
  from: { id: '29:user', aadObjectId: 'aad-user' },
  recipient: { id: '28:bot' },
  entities: [{ type: 'mention', mentioned: { id: '28:bot' } }],
  conversation: { id: '19:room@thread.tacv2;messageid=1', conversationType: 'channel' },
  channelData: { tenant: { id: 'tenant-a' }, channel: { id: '19:room@thread.tacv2' } },
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  m.config.tenantId = 'tenant-a';
  m.config.tenantMode = 'SINGLE';
  m.squireOn.mockResolvedValue(true);
  m.reply.mockResolvedValue({ success: true });
  m.updateMany.mockResolvedValue({ count: 1 });
  m.count.mockResolvedValue(1);
});

describe('Teams messages route: SINGLE tenant fails closed', () => {
  it('rejects an install when the configured tenant ID is empty', async () => {
    m.config.tenantId = null;
    const res = await post(install('tenant-anything'));
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('TENANT_REQUIRED');
    expect(m.upsert).not.toHaveBeenCalled();
    expect(m.audit).toHaveBeenCalled();
  });

  it('rejects an install from another tenant', async () => {
    const res = await post(install('tenant-b'));
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('TENANT_NOT_ALLOWED');
    expect(m.upsert).not.toHaveBeenCalled();
  });

  it('records an install from the configured tenant', async () => {
    const res = await post(install('tenant-a'));
    expect(res.status).toBe(200);
    expect(m.upsert).toHaveBeenCalledOnce();
  });

  it('keeps MULTI-tenant self-registration', async () => {
    m.config.tenantMode = 'MULTI';
    m.config.tenantId = null;
    const res = await post(install('tenant-new'));
    expect(res.status).toBe(200);
    expect(m.upsert).toHaveBeenCalledOnce();
  });

  it('ignores messages when the configured tenant ID is empty', async () => {
    m.config.tenantId = null;
    const res = await post(message());
    expect(res.status).toBe(200);
    expect(m.enqueue).not.toHaveBeenCalled();
    expect(m.reply).not.toHaveBeenCalled();
  });

  it('does not record personal or group chat installs as Teams', async () => {
    const personal = install('tenant-a');
    personal.conversation = { id: 'a:chat', conversationType: 'personal' };
    expect((await post(personal)).status).toBe(200);
    const group = install('tenant-a');
    group.conversation = { id: '19:chat@thread.v2', conversationType: 'groupChat' };
    expect((await post(group)).status).toBe(200);
    expect(m.upsert).not.toHaveBeenCalled();
  });
});

describe('Teams messages route: conversational bot', () => {
  it('queues an @mention for Squire and records inbound activity', async () => {
    expect((await post(message())).status).toBe(200);
    expect(m.enqueue).toHaveBeenCalledOnce();
    expect(m.updateMany).toHaveBeenCalledOnce();
    expect(m.reply).not.toHaveBeenCalled();
  });

  it('routes a personal chat to Squire without an explicit mention', async () => {
    await post(
      message({
        text: 'why is checkout slow?',
        entities: [],
        conversation: { id: 'a:personal', conversationType: 'personal' },
      })
    );
    expect(m.enqueue).toHaveBeenCalledOnce();
    const [forwarded] = m.enqueue.mock.calls[0];
    expect(forwarded.entities).toContainEqual({ type: 'mention', mentioned: { id: '28:bot' } });
  });

  it('answers help inline instead of queueing it', async () => {
    await post(message({ text: '<at>OpsKnight</at> help' }));
    expect(m.enqueue).not.toHaveBeenCalled();
    expect(m.reply).toHaveBeenCalledOnce();
    expect(JSON.stringify(m.reply.mock.calls[0][0].card)).toContain('What OpsKnight can do here');
  });

  it('answers status with the channel incident, escaping its title', async () => {
    m.findIncident.mockResolvedValue('inc-1');
    m.incidentFindUnique.mockResolvedValue({
      id: 'inc-1',
      title: '[click](https://evil.example) *db*',
      status: 'ACKNOWLEDGED',
      urgency: 'HIGH',
      service: { name: 'Payments' },
    });
    await post(message({ text: '<at>OpsKnight</at> status' }));
    const card = JSON.stringify(m.reply.mock.calls[0][0].card);
    expect(card).toContain('Acknowledged');
    expect(card).toContain('https://ops.example.com/incidents/inc-1');
    expect(card).not.toContain('[click](https://evil.example)');
  });

  it('replies with help when Squire in chat is off, instead of dropping the mention', async () => {
    m.squireOn.mockResolvedValue(false);
    await post(message());
    expect(m.enqueue).not.toHaveBeenCalled();
    expect(JSON.stringify(m.reply.mock.calls[0][0].card)).toContain('Squire in chat is turned off');
  });

  it('ignores channel messages that do not mention the bot', async () => {
    await post(message({ entities: [] }));
    expect(m.enqueue).not.toHaveBeenCalled();
    expect(m.reply).not.toHaveBeenCalled();
  });

  it('never crashes on unknown conversation types or a failing reply', async () => {
    m.reply.mockRejectedValue(new Error('boom'));
    const res = await post(
      message({ text: 'help', conversation: { id: 'x', conversationType: 'meeting' } })
    );
    expect(res.status).toBe(200);
    const odd = await post({ type: 'message', channelData: { tenant: { id: 'tenant-a' } } });
    expect(odd.status).toBe(200);
  });
});
