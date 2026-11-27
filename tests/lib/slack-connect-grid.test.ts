import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ slackApiCall: vi.fn(), findFirst: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/war-room/providers/slack/client', () => ({ slackApiCall: h.slackApiCall }));
vi.mock('@/lib/prisma', () => ({ default: { slackIntegration: { findFirst: h.findFirst } } }));

import { inviteWarRoomExternalGuests } from '@/lib/war-room/providers/slack/connect-invites';
import { resolveSlackWorkspaceKey, slackWorkspaceMatches } from '@/lib/slack/workspace-match';
import { chatOpsConfigSchema } from '@/lib/chatops/config-command';

beforeEach(() => vi.resetAllMocks());

describe('Slack Connect war-room invites', () => {
  const base = { botToken: 'xoxb', channelId: 'C1', emails: ['a@x.com', 'b@y.org'] };

  it('does nothing without the optional scope', async () => {
    expect(await inviteWarRoomExternalGuests({ ...base, scopes: ['chat:write'] })).toBe(0);
    expect(h.slackApiCall).not.toHaveBeenCalled();
  });

  it('does nothing without emails', async () => {
    const scopes = ['conversations.connect:write'];
    expect(await inviteWarRoomExternalGuests({ ...base, emails: [], scopes })).toBe(0);
    expect(h.slackApiCall).not.toHaveBeenCalled();
  });

  it('invites each valid email and isolates failures', async () => {
    h.slackApiCall.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({ ok: true });
    const n = await inviteWarRoomExternalGuests({
      ...base,
      emails: ['a@x.com', 'not-an-email', 'b@y.org', 'A@X.com'],
      scopes: ['conversations.connect:write'],
    });
    expect(n).toBe(1);
    expect(h.slackApiCall).toHaveBeenCalledTimes(2);
    expect(h.slackApiCall).toHaveBeenLastCalledWith(
      'conversations.inviteShared',
      'xoxb',
      expect.objectContaining({ channel: 'C1', emails: 'b@y.org' })
    );
  });

  it('validates the setting: emails, cap of 20, minute bounds', () => {
    const valid = {
      enabled: true,
      channelPrefix: 'inc',
      autoCreateOnUrgency: ['HIGH'],
      autoCreateOnPriority: ['P1'],
      archiveOnResolve: true,
      defaultVideoBridge: 'NONE',
      customBridgeUrlTemplate: '',
      defaultProviders: ['SLACK'],
    };
    const ok = (extra: object) => chatOpsConfigSchema.safeParse({ ...valid, ...extra }).success;
    expect(ok({})).toBe(true);
    expect(ok({ slackWarRoomExternalEmails: ['a@x.com'] })).toBe(true);
    expect(ok({ slackWarRoomExternalEmails: ['nope'] })).toBe(false);
    expect(
      ok({ slackWarRoomExternalEmails: Array.from({ length: 21 }, (_, i) => `u${i}@x.com`) })
    ).toBe(false);
    expect(ok({ slackUnackedNudgeMinutes: 1441 })).toBe(false);
    expect(ok({ slackUnackedNudgeMinutes: null, slackNoUpdateNudgeMinutes: 30 })).toBe(true);
  });
});

describe('Enterprise Grid workspace match', () => {
  it('single-workspace installs match directly without any lookup', async () => {
    expect(
      await slackWorkspaceMatches({ teamId: 'T1', enterpriseId: null, incidentWorkspaceId: 'T1' })
    ).toBe(true);
    expect(
      await slackWorkspaceMatches({ teamId: 'T2', enterpriseId: null, incidentWorkspaceId: 'T1' })
    ).toBe(false);
    expect(h.findFirst).not.toHaveBeenCalled();
  });

  it('a member workspace matches an org-wide install by enterprise id', async () => {
    h.findFirst.mockResolvedValue({ id: 'i' });
    expect(
      await slackWorkspaceMatches({ teamId: 'T9', enterpriseId: 'E1', incidentWorkspaceId: 'E1' })
    ).toBe(true);
    expect(h.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { enabled: true, enterpriseId: 'E1', workspaceId: 'E1' } })
    );
  });

  it('rejects another enterprise or an install that is not org-wide', async () => {
    h.findFirst.mockResolvedValue(null);
    expect(
      await slackWorkspaceMatches({ teamId: 'T9', enterpriseId: 'E1', incidentWorkspaceId: 'E1' })
    ).toBe(false);
    expect(
      await slackWorkspaceMatches({ teamId: 'T9', enterpriseId: 'E2', incidentWorkspaceId: 'E1' })
    ).toBe(false);
    expect(
      await slackWorkspaceMatches({ teamId: 'T9', enterpriseId: 'E1', incidentWorkspaceId: 'T1' })
    ).toBe(false);
  });

  it('resolveSlackWorkspaceKey returns the team id when there is no enterprise', async () => {
    expect(await resolveSlackWorkspaceKey('T1', undefined)).toBe('T1');
    h.findFirst.mockResolvedValue({ id: 'i' });
    expect(await resolveSlackWorkspaceKey('T1', 'E1')).toBe('E1');
  });
});
