import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  prisma: { incident: { findMany: vi.fn() } },
  enqueue: vi.fn(),
  callSlackApi: vi.fn(),
  resolveUser: vi.fn(),
  token: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({ default: m.prisma }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/chatops/intents', () => ({ enqueueChatOpsIntent: m.enqueue }));
vi.mock('@/lib/slack/api', () => ({ callSlackApi: m.callSlackApi }));
vi.mock('@/lib/chatops/slash-commands', () => ({
  workspaceBotToken: m.token,
  resolveOpsKnightUser: m.resolveUser,
}));
vi.mock('@/lib/authorization-actors', () => ({
  resolveUserActor: vi.fn().mockResolvedValue({ id: 'u1' }),
}));
vi.mock('@/lib/authorization-filters', () => ({
  incidentReadWhere: () => ({}),
  scheduleReadWhere: () => ({}),
}));
vi.mock('@/lib/oncall-now', () => ({
  getOnCallNow: vi.fn().mockResolvedValue({
    schedules: [{ scheduleName: 'Primary', onCall: [{ userId: 'u1', name: 'Alice' }] }],
  }),
}));
vi.mock('@/lib/env-validation', () => ({ getBaseUrl: () => 'https://ok.example/' }));

import {
  buildHomeView,
  buildUnlinkedHomeView,
  enqueueAppHome,
  processAppHome,
} from '@/lib/slack/home';

const incident = (n: number, status = 'OPEN') => ({
  id: `i${n}`,
  title: `Incident ${n} <b>`,
  status,
  urgency: 'HIGH',
  service: { name: 'API' },
});

beforeEach(() => {
  vi.clearAllMocks();
  m.token.mockResolvedValue('xoxb');
  m.resolveUser.mockResolvedValue({ id: 'u1', name: 'Alice' });
  m.callSlackApi.mockResolvedValue({ ok: true, data: {} });
  m.prisma.incident.findMany.mockResolvedValue([incident(1), incident(2, 'ACKNOWLEDGED')]);
});

describe('home view', () => {
  it('stays bounded and uses the existing action ids', () => {
    const many = Array.from({ length: 40 }, (_, i) => incident(i));
    const view = buildHomeView({ baseUrl: 'https://x', onCall: [], mine: many, open: many });
    expect(view.type).toBe('home');
    expect(view.blocks.length).toBeLessThanOrEqual(100);
    const json = JSON.stringify(view);
    expect(json).toContain('ack_incident');
    expect(json).toContain('view_incident');
    expect(json).toContain('home_declare_incident');
    expect(json).toContain('&lt;b&gt;');
  });
  it('only offers Acknowledge on open incidents', () => {
    const view = buildHomeView({
      baseUrl: 'https://x',
      onCall: [],
      mine: [incident(1, 'ACKNOWLEDGED')],
      open: [],
    });
    expect(JSON.stringify(view)).not.toContain('ack_incident');
  });
  it('shows a link-your-account message when unlinked', () => {
    expect(JSON.stringify(buildUnlinkedHomeView())).toContain('not linked');
  });
});

describe('app_home_opened', () => {
  it('queues only the home tab event', async () => {
    const envelope = {
      team_id: 'T1',
      event_id: 'Ev1',
      event: { type: 'app_home_opened', user: 'U1', tab: 'home' },
    };
    expect(await enqueueAppHome(envelope)).toBe(true);
    expect(m.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        signature: 'app-home:T1:Ev1',
        payload: expect.objectContaining({ __kind: 'APP_HOME' }),
      })
    );
    expect(
      await enqueueAppHome({ ...envelope, event: { ...envelope.event, tab: 'messages' } })
    ).toBe(false);
    expect(await enqueueAppHome({ event: { type: 'app_home_opened' } })).toBe(false);
  });
  it('publishes the viewer view', async () => {
    await processAppHome({ __kind: 'APP_HOME', team_id: 'T1', user_id: 'U1' });
    const call = m.callSlackApi.mock.calls[0];
    expect(call[0]).toBe('views.publish');
    expect(call[2].user_id).toBe('U1');
    expect(JSON.stringify(call[2].view)).toContain('Primary');
  });
  it('publishes the unlinked message for an unmatched viewer', async () => {
    m.resolveUser.mockResolvedValue(null);
    await processAppHome({ __kind: 'APP_HOME', team_id: 'T1', user_id: 'U1' });
    expect(JSON.stringify(m.callSlackApi.mock.calls[0][2].view)).toContain('not linked');
  });
  it('never throws when the query or Slack fails', async () => {
    m.prisma.incident.findMany.mockRejectedValue(new Error('db'));
    await expect(
      processAppHome({ __kind: 'APP_HOME', team_id: 'T1', user_id: 'U1' })
    ).resolves.toBeNull();
    m.prisma.incident.findMany.mockResolvedValue([]);
    m.callSlackApi.mockRejectedValue(new Error('net'));
    await expect(
      processAppHome({ __kind: 'APP_HOME', team_id: 'T1', user_id: 'U1' })
    ).resolves.toBeNull();
  });
});
