import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  slackDestinationMatches,
  destinationPrioritiesSchema,
  destinationUrgenciesSchema,
} from '@/lib/slack/destination-conditions';
import { planLiveCardDelivery } from '@/lib/slack/live-card';

describe('slack destination conditions', () => {
  const inc = { priority: 'P2', urgency: 'HIGH' };
  it.each([
    [[], [], true],
    [['P2'], [], true],
    [['P1'], [], false],
    [[], ['LOW'], false],
    [['P1', 'P2'], ['HIGH'], true],
    [['P2'], ['LOW'], false],
  ])('priorities %j urgencies %j -> %s', (priorities, urgencies, expected) => {
    expect(slackDestinationMatches({ priorities, urgencies }, inc)).toBe(expected);
  });

  it('treats missing columns and a missing incident priority sanely', () => {
    expect(slackDestinationMatches({}, inc)).toBe(true);
    expect(slackDestinationMatches({ priorities: ['P1'] }, { priority: null })).toBe(false);
  });

  it('a card that already exists still edits when the destination no longer matches', () => {
    const request = { event: 'updated', eventKey: 'k', reply: false, editOnly: true } as never;
    const ref = { channelId: 'C1', ts: '1.2', lastEventKey: null, updatedAt: new Date() };
    expect(planLiveCardDelivery(ref, request).kind).toBe('update');
    expect(planLiveCardDelivery(null, request).kind).toBe('skip');
  });

  it('validates priorities and urgencies', () => {
    expect(destinationPrioritiesSchema.safeParse(['P1', 'P5']).success).toBe(true);
    expect(destinationPrioritiesSchema.safeParse(['P0']).success).toBe(false);
    expect(destinationUrgenciesSchema.safeParse(['HIGH', 'LOW']).success).toBe(true);
    expect(destinationUrgenciesSchema.safeParse(['URGENT']).success).toBe(false);
  });
});

const mocks = vi.hoisted(() => ({
  prisma: {
    user: { findMany: vi.fn() },
    slackOnCallSync: { update: vi.fn().mockResolvedValue({}) },
    chatOpsConfig: { findUnique: vi.fn() },
    escalationRule: { findMany: vi.fn() },
  },
  resolve: vi.fn(),
  callSlackApi: vi.fn(),
  lookup: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({ default: mocks.prisma }));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/escalation/target-resolution', () => ({ resolveEscalationTarget: mocks.resolve }));
vi.mock('@/lib/slack', () => ({ getSlackInstall: vi.fn() }));
vi.mock('@/lib/slack/api', () => ({ callSlackApi: mocks.callSlackApi }));
vi.mock('@/lib/slack/live-card', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/slack/live-card')>()),
  lookupSlackUserIdByEmail: mocks.lookup,
}));

describe('on-call usergroup sync safety', () => {
  const mapping = { scheduleId: 's1', usergroupId: 'S123', enabled: true };
  const install = { token: 't', scopes: ['usergroups:write'], workspaceId: 'T1' };
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.user.findMany.mockResolvedValue([
      { id: 'u1', email: 'a@x.io' },
      { id: 'u2', email: 'b@x.io' },
    ]);
    mocks.resolve.mockResolvedValue(['u1', 'u2']);
    mocks.lookup.mockImplementation(async (_i: unknown, email: string) =>
      email === 'a@x.io' ? 'UA' : null
    );
    mocks.callSlackApi.mockResolvedValue({ ok: true, data: {} });
  });

  it('sends matched members and skips unmatched users', async () => {
    const { syncScheduleUsergroup } = await import('@/lib/slack/oncall-sync');
    expect(await syncScheduleUsergroup(mapping, install)).toEqual({
      status: 'synced',
      members: 1,
      unmatched: 1,
    });
    expect(mocks.callSlackApi).toHaveBeenCalledWith('usergroups.users.update', 't', {
      usergroup: 'S123',
      users: 'UA',
    });
  });

  it('never sends an empty list', async () => {
    const { syncScheduleUsergroup } = await import('@/lib/slack/oncall-sync');
    mocks.resolve.mockResolvedValue([]);
    mocks.prisma.user.findMany.mockResolvedValue([]);
    expect((await syncScheduleUsergroup(mapping, install)).status).toBe('skipped');
    mocks.resolve.mockResolvedValue(['u1']);
    mocks.lookup.mockResolvedValue(null);
    mocks.prisma.user.findMany.mockResolvedValue([{ id: 'u1', email: 'a@x.io' }]);
    expect((await syncScheduleUsergroup(mapping, install)).status).toBe('skipped');
    expect(mocks.callSlackApi).not.toHaveBeenCalled();
    expect(mocks.prisma.slackOnCallSync.update).toHaveBeenCalledTimes(2);
  });

  it('skips without the scope, when disabled, or when Slack is not connected', async () => {
    const { syncScheduleUsergroup } = await import('@/lib/slack/oncall-sync');
    expect((await syncScheduleUsergroup(mapping, { ...install, scopes: [] })).status).toBe(
      'skipped'
    );
    expect((await syncScheduleUsergroup({ ...mapping, enabled: false }, install)).status).toBe(
      'skipped'
    );
    expect((await syncScheduleUsergroup(mapping, null)).status).toBe('skipped');
    expect(mocks.callSlackApi).not.toHaveBeenCalled();
  });

  it('records a rate limit instead of throwing', async () => {
    const { syncScheduleUsergroup } = await import('@/lib/slack/oncall-sync');
    mocks.callSlackApi.mockResolvedValue({
      ok: false,
      error: 'ratelimited',
      status: 429,
      retryAfterMs: 5000,
    });
    const out = await syncScheduleUsergroup(mapping, install);
    expect(out).toMatchObject({
      status: 'skipped',
      reason: expect.stringContaining('rate limited'),
    });
  });
});

describe('war room on-call invite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.escalationRule.findMany.mockResolvedValue([{ targetScheduleId: 's1' }]);
    mocks.resolve.mockResolvedValue(['u9']);
  });

  it('is off by default', async () => {
    const { resolveOnCallWarRoomResponders } = await import('@/lib/war-room/oncall-responders');
    mocks.prisma.chatOpsConfig.findUnique.mockResolvedValue({ warRoomInviteOnCall: false });
    expect(await resolveOnCallWarRoomResponders('svc')).toEqual([]);
    mocks.prisma.chatOpsConfig.findUnique.mockResolvedValue(null);
    expect(await resolveOnCallWarRoomResponders('svc')).toEqual([]);
    expect(mocks.prisma.escalationRule.findMany).not.toHaveBeenCalled();
  });

  it('adds the current on-call users when enabled', async () => {
    const { resolveOnCallWarRoomResponders } = await import('@/lib/war-room/oncall-responders');
    mocks.prisma.chatOpsConfig.findUnique.mockResolvedValue({ warRoomInviteOnCall: true });
    expect(await resolveOnCallWarRoomResponders('svc')).toEqual(['u9']);
    expect(mocks.resolve).toHaveBeenCalledWith('SCHEDULE', 's1');
  });
});
