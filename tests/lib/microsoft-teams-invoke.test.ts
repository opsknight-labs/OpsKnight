import { beforeEach, describe, expect, it, vi } from 'vitest';

const executeChatOpsCommand = vi.fn(async () => ({ changed: true }));
const resolveMicrosoftTeamsUser = vi.fn<() => Promise<{ linkId: string; userId: string; displayName: string } | null>>(async () => ({ linkId: 'link-1', userId: 'user-1', displayName: 'Alice' }));
const createMicrosoftTeamsIdentityChallenge = vi.fn(async () => 'challenge-token');
let persistedIntentPayload: Record<string, unknown> = {};
let capturedPayloadDigest: string | undefined;
const enqueueChatOpsIntent = vi.fn(async (input: { payload: Record<string, unknown>; payloadDigest?: string }) => {
  persistedIntentPayload = input.payload;
  capturedPayloadDigest = input.payloadDigest;
  return { id: 'intent-1', duplicate: false };
});
const processInlineChatOpsIntent = vi.fn(async (_id: string, execute: (input: { intentId: string; payload: Record<string, unknown> }) => Promise<unknown>) => execute({ intentId: 'intent-1', payload: persistedIntentPayload }));

const destination = { id: 'dest-1', tenantId: 'tenant-1', teamId: 'team-1', channelId: 'channel-1', serviceId: 'svc-1', enabled: true, interactiveEnabled: true, installation: { enabled: true } };
const incident = { id: 'inc-1', serviceId: 'svc-1', title: 'Incident', description: null, status: 'OPEN', urgency: 'HIGH', priority: 'P1', createdAt: new Date(), acknowledgedAt: null, resolvedAt: null, service: { name: 'API' }, assignee: null };
const canonical = { conversationId: 'conversation-1', messageId: 'message-1', messageGeneration: 1 };
const prismaMock = {
  microsoftTeamsConfig: { findFirst: vi.fn(async () => ({ id: 'config', enabled: true, interactiveEnabled: true })) },
  microsoftTeamsDestination: { findUnique: vi.fn(async () => destination) },
  incident: { findUnique: vi.fn(async (args: { select?: unknown }) => args.select ? ({ assignee: null, watchers: [] }) : incident) },
  microsoftTeamsIncidentMessage: { findUnique: vi.fn(async () => canonical) },
  microsoftTeamsInstallation: { findMany: vi.fn(async () => []) },
  incidentWarRoom: { findFirst: vi.fn(async () => null) },
};

vi.mock('@/lib/prisma', () => ({ default: prismaMock }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn(async () => ({ allowed: true, remaining: 10, resetAt: Date.now() + 1000, count: 1 })) }));
vi.mock('@/lib/chatops/intents', () => ({
  enqueueChatOpsIntent,
  processInlineChatOpsIntent,
  payloadDigestFromPayload: vi.fn((p: Record<string, unknown>) => JSON.stringify(p)),
}));
vi.mock('@/lib/chatops/commands', () => ({ executeChatOpsCommand }));
vi.mock('@/lib/chatops/incident-capabilities', () => ({ getIncidentChatOpsCapabilities: vi.fn(async () => ({ canRead: true })) }));
vi.mock('@/lib/microsoft-teams/identity', () => ({ resolveMicrosoftTeamsUser, createMicrosoftTeamsIdentityChallenge }));
vi.mock('@/lib/audit', () => ({ emitAuditEvent: vi.fn(async () => undefined) }));
vi.mock('@/lib/env-validation', () => ({ getBaseUrl: () => 'https://opsknight.example.com' }));

function activity(overrides: Record<string, unknown> = {}) {
  return {
    id: 'invoke-1', replyToId: 'message-1', from: { id: 'teams-user', aadObjectId: 'aad-1', name: 'Alice' },
    conversation: { id: 'conversation-1' },
    channelData: { tenant: { id: 'tenant-1' }, team: { id: 'team-1' }, channel: { id: 'channel-1' } },
    value: { action: { type: 'Action.Execute', verb: 'opsknight.incident.ack', data: { v: 2, incidentId: 'inc-1', destinationId: 'dest-1', messageGeneration: 1 } } },
    ...overrides,
  };
}

describe('Microsoft Teams invoke adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    persistedIntentPayload = {};
  });

  it('binds a valid click and dispatches through the provider-neutral command', async () => {
    const { handleMicrosoftTeamsAdaptiveCardAction } = await import('@/lib/microsoft-teams/invoke');
    const response = await handleMicrosoftTeamsAdaptiveCardAction({ activity: activity(), verifiedTenantId: 'tenant-1' });
    expect(response).toMatchObject({ statusCode: 200, value: 'Incident acknowledged.' });
    expect(executeChatOpsCommand).toHaveBeenCalledWith(expect.objectContaining({ provider: 'MICROSOFT_TEAMS', command: { kind: 'ACKNOWLEDGE', incidentId: 'inc-1' }, idempotency: { key: 'intent-1', principalId: 'chatops:microsoft-teams:tenant-1:teams-user' } }));
  });

  it('rejects a cross-channel or stale-generation card before identity or mutation', async () => {
    const { handleMicrosoftTeamsAdaptiveCardAction } = await import('@/lib/microsoft-teams/invoke');
    const wrongChannel = activity({ channelData: { tenant: { id: 'tenant-1' }, team: { id: 'team-1' }, channel: { id: 'evil' } } });
    await expect(handleMicrosoftTeamsAdaptiveCardAction({ activity: wrongChannel, verifiedTenantId: 'tenant-1' })).resolves.toMatchObject({ statusCode: 409 });
    expect(executeChatOpsCommand).not.toHaveBeenCalled();
  });

  it.each([
    ['wrong team', activity({ channelData: { tenant: { id: 'tenant-1' }, team: { id: 'evil' }, channel: { id: 'channel-1' } } })],
    ['wrong conversation', activity({ conversation: { id: 'evil' } })],
    ['wrong canonical message', activity({ replyToId: 'evil' })],
    ['stale generation', activity({ value: { action: { type: 'Action.Execute', verb: 'opsknight.incident.ack', data: { v: 2, incidentId: 'inc-1', destinationId: 'dest-1', messageGeneration: 2 } } } })],
  ])('rejects %s binding before identity or mutation', async (_label, boundActivity) => {
    const { handleMicrosoftTeamsAdaptiveCardAction } = await import('@/lib/microsoft-teams/invoke');
    await expect(handleMicrosoftTeamsAdaptiveCardAction({ activity: boundActivity, verifiedTenantId: 'tenant-1' })).resolves.toMatchObject({ statusCode: 409 });
    expect(resolveMicrosoftTeamsUser).not.toHaveBeenCalled();
    expect(executeChatOpsCommand).not.toHaveBeenCalled();
  });

  it('returns a short-lived linking flow for an unknown identity', async () => {
    resolveMicrosoftTeamsUser.mockResolvedValueOnce(null);
    const { handleMicrosoftTeamsAdaptiveCardAction } = await import('@/lib/microsoft-teams/invoke');
    const response = await handleMicrosoftTeamsAdaptiveCardAction({ activity: activity(), verifiedTenantId: 'tenant-1' });
    expect(response).toMatchObject({
      statusCode: 401,
      type: 'application/vnd.microsoft.activity.loginRequest',
    });
    expect(JSON.stringify(response)).toContain('/settings/chatops/link?token=challenge-token');
    expect(executeChatOpsCommand).not.toHaveBeenCalled();
  });

  it('allows unlinked identity to refresh card without 401 prompt', async () => {
    resolveMicrosoftTeamsUser.mockResolvedValueOnce(null);
    const { handleMicrosoftTeamsAdaptiveCardAction } = await import('@/lib/microsoft-teams/invoke');
    const refreshActivity = activity({
      value: {
        action: {
          type: 'Action.Execute',
          verb: 'opsknight.incident.refresh',
          data: { v: 2, incidentId: 'inc-1', destinationId: 'dest-1', messageGeneration: 1 },
        },
      },
    });
    const response = await handleMicrosoftTeamsAdaptiveCardAction({
      activity: refreshActivity,
      verifiedTenantId: 'tenant-1',
    });
    expect(response).toMatchObject({ statusCode: 200, type: 'application/vnd.microsoft.card.adaptive' });
    expect(executeChatOpsCommand).not.toHaveBeenCalled();
  });

  it('rejects clicks after destination disablement', async () => {
    prismaMock.microsoftTeamsDestination.findUnique.mockResolvedValueOnce({ ...destination, enabled: false });
    const { handleMicrosoftTeamsAdaptiveCardAction } = await import('@/lib/microsoft-teams/invoke');
    await expect(handleMicrosoftTeamsAdaptiveCardAction({ activity: activity(), verifiedTenantId: 'tenant-1' })).resolves.toMatchObject({ statusCode: 403 });
    expect(executeChatOpsCommand).not.toHaveBeenCalled();
  });

  it('rejects clicks when the canonical ledger row no longer exists', async () => {
    prismaMock.microsoftTeamsIncidentMessage.findUnique.mockResolvedValueOnce(null as never);
    const { handleMicrosoftTeamsAdaptiveCardAction } = await import('@/lib/microsoft-teams/invoke');
    await expect(handleMicrosoftTeamsAdaptiveCardAction({ activity: activity(), verifiedTenantId: 'tenant-1' })).resolves.toMatchObject({ statusCode: 409 });
    expect(executeChatOpsCommand).not.toHaveBeenCalled();
  });

  it('rejects clicks when global interactive actions are disabled', async () => {
    prismaMock.microsoftTeamsConfig.findFirst.mockResolvedValueOnce(null as never);
    const { handleMicrosoftTeamsAdaptiveCardAction } = await import('@/lib/microsoft-teams/invoke');
    await expect(handleMicrosoftTeamsAdaptiveCardAction({ activity: activity(), verifiedTenantId: 'tenant-1' })).resolves.toMatchObject({ statusCode: 403 });
    expect(executeChatOpsCommand).not.toHaveBeenCalled();
  });

  it('persists a fixed snooze deadline and reuses it during intent execution', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-13T10:00:00.000Z'));
    const { handleMicrosoftTeamsAdaptiveCardAction } = await import('@/lib/microsoft-teams/invoke');
    const snooze = activity({ value: { action: { type: 'Action.Execute', verb: 'opsknight.incident.snooze', data: { v: 2, incidentId: 'inc-1', destinationId: 'dest-1', messageGeneration: 1, minutes: 30 } } } });
    await expect(handleMicrosoftTeamsAdaptiveCardAction({ activity: snooze, verifiedTenantId: 'tenant-1' })).resolves.toMatchObject({ statusCode: 200 });

    expect(persistedIntentPayload.snoozedUntil).toBe('2026-09-13T10:30:00.000Z');
    expect(capturedPayloadDigest).toBeDefined();
    expect(capturedPayloadDigest).not.toContain('snoozedUntil');
    expect(executeChatOpsCommand).toHaveBeenCalledWith(expect.objectContaining({
      command: expect.objectContaining({ kind: 'SNOOZE', snoozedUntil: new Date('2026-09-13T10:30:00.000Z') }),
    }));

    // Simulate Teams retrying the same snooze activity after 5 seconds
    const firstDigest = capturedPayloadDigest;
    vi.advanceTimersByTime(5000);
    enqueueChatOpsIntent.mockResolvedValueOnce({ id: 'intent-1', duplicate: true });
    await expect(handleMicrosoftTeamsAdaptiveCardAction({ activity: snooze, verifiedTenantId: 'tenant-1' })).resolves.toMatchObject({ statusCode: 200 });
    expect(capturedPayloadDigest).toBe(firstDigest);

    vi.useRealTimers();
  });

  it('bridges Azure AD Group GUID destination with Teams internal thread ID via installation ledger', async () => {
    const guidTeamId = 'e83b3788-96b6-49fc-a485-582b719e49d3';
    const threadTeamId = '19:PcM4kw6ULagEt9_wcgiuSYEwaCgAu1_22W8K-D41spM1@thread.tacv2';
    const notificationChannelId = '19:ea6c2a8074a348ceb302a2fac8df17b5@thread.tacv2';

    prismaMock.microsoftTeamsDestination.findUnique.mockResolvedValueOnce({
      ...destination,
      teamId: guidTeamId,
      channelId: notificationChannelId,
      installation: {
        enabled: true,
        teamId: guidTeamId,
        channelId: threadTeamId,
        conversationId: threadTeamId,
      },
    } as never);
    prismaMock.microsoftTeamsIncidentMessage.findUnique.mockResolvedValueOnce({
      ...canonical,
      conversationId: notificationChannelId,
    } as never);

    const { handleMicrosoftTeamsAdaptiveCardAction } = await import('@/lib/microsoft-teams/invoke');

    // Teams Bot Framework sends channelData.team.id = threadTeamId and omits aadGroupId
    const teamsActivity = activity({
      channelData: {
        tenant: { id: 'tenant-1' },
        team: { id: threadTeamId },
        channel: { id: notificationChannelId },
      },
      conversation: { id: `${notificationChannelId};messageid=message-1` },
      replyToId: 'message-1',
    });

    const response = await handleMicrosoftTeamsAdaptiveCardAction({
      activity: teamsActivity,
      verifiedTenantId: 'tenant-1',
    });
    expect(response).toMatchObject({ statusCode: 200, value: 'Incident acknowledged.' });
  });

  it('allows War Room card interaction when triggered from war room channel', async () => {
    const guidTeamId = 'e83b3788-96b6-49fc-a485-582b719e49d3';
    const warRoomChannelId = '19:87262c3ec7c54a65b3e03769669af9a3@thread.tacv2';
    const warRoomMessageId = '1789744465529';
    const warRoomConvId = `${warRoomChannelId};messageid=${warRoomMessageId}`;

    prismaMock.microsoftTeamsDestination.findUnique.mockResolvedValueOnce({
      ...destination,
      teamId: guidTeamId,
      installationId: 'install-1',
      installation: {
        id: 'install-1',
        enabled: true,
        teamId: guidTeamId,
      },
    } as never);

    prismaMock.incidentWarRoom.findFirst.mockResolvedValueOnce({
      id: 'war-room-1',
      incidentId: 'inc-1',
      destinationId: 'dest-1',
      installationId: 'install-1',
      state: 'READY',
      providerTenantId: 'tenant-1',
      providerContainerId: guidTeamId,
      providerChannelId: warRoomChannelId,
      commandMessageId: warRoomMessageId,
      commandConversationId: warRoomConvId,
      messageGeneration: 1,
    } as never);

    const { handleMicrosoftTeamsAdaptiveCardAction } = await import('@/lib/microsoft-teams/invoke');

    const warRoomActivity = activity({
      replyToId: warRoomMessageId,
      conversation: { id: warRoomConvId },
      channelData: {
        tenant: { id: 'tenant-1' },
        team: { id: '19:general@thread.tacv2' },
        channel: { id: warRoomChannelId },
      },
      value: {
        action: {
          type: 'Action.Execute',
          verb: 'opsknight.incident.ack',
          data: {
            v: 2,
            incidentId: 'inc-1',
            destinationId: 'dest-1',
            warRoomId: 'war-room-1',
            messageGeneration: 1,
          },
        },
      },
    });

    const response = await handleMicrosoftTeamsAdaptiveCardAction({
      activity: warRoomActivity,
      verifiedTenantId: 'tenant-1',
    });
    expect(response).toMatchObject({ statusCode: 200, value: 'Incident acknowledged.' });
  });

  it.each(['CLOSING', 'CLOSED', 'ARCHIVED'] as const)(
    'allows card refresh when war room is in %s state',
    async (warRoomState) => {
      const guidTeamId = 'e83b3788-96b6-49fc-a485-582b719e49d3';
      const warRoomChannelId = '19:87262c3ec7c54a65b3e03769669af9a3@thread.tacv2';
      const warRoomMessageId = '1789744465529';
      const warRoomConvId = `${warRoomChannelId};messageid=${warRoomMessageId}`;

      prismaMock.microsoftTeamsDestination.findUnique.mockResolvedValueOnce({
        ...destination,
        teamId: guidTeamId,
        installationId: 'install-1',
        installation: {
          id: 'install-1',
          enabled: true,
          teamId: guidTeamId,
        },
      } as never);

      prismaMock.incidentWarRoom.findFirst.mockResolvedValueOnce({
        id: 'war-room-1',
        incidentId: 'inc-1',
        destinationId: 'dest-1',
        installationId: 'install-1',
        state: warRoomState,
        providerTenantId: 'tenant-1',
        providerContainerId: guidTeamId,
        providerChannelId: warRoomChannelId,
        commandMessageId: warRoomMessageId,
        commandConversationId: warRoomConvId,
        messageGeneration: 1,
      } as never);

      prismaMock.incident.findUnique.mockResolvedValueOnce({
        ...incident,
        status: 'RESOLVED',
        resolvedAt: new Date(),
      } as never);

      const { handleMicrosoftTeamsAdaptiveCardAction } = await import('@/lib/microsoft-teams/invoke');

      const refreshActivity = activity({
        replyToId: warRoomMessageId,
        conversation: { id: warRoomConvId },
        channelData: {
          tenant: { id: 'tenant-1' },
          team: { id: '19:general@thread.tacv2' },
          channel: { id: warRoomChannelId },
        },
        value: {
          action: {
            type: 'Action.Execute',
            verb: 'opsknight.incident.refresh',
            data: {
              v: 2,
              incidentId: 'inc-1',
              destinationId: 'dest-1',
              warRoomId: 'war-room-1',
              messageGeneration: 1,
            },
          },
        },
      });

      const response = await handleMicrosoftTeamsAdaptiveCardAction({
        activity: refreshActivity,
        verifiedTenantId: 'tenant-1',
      });
      expect(response).toMatchObject({
        statusCode: 200,
        type: 'application/vnd.microsoft.card.adaptive',
      });
    }
  );
});
