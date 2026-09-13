import { beforeEach, describe, expect, it, vi } from 'vitest';

const executeChatOpsCommand = vi.fn(async () => ({ changed: true }));
const resolveMicrosoftTeamsUser = vi.fn<() => Promise<{ linkId: string; userId: string; displayName: string } | null>>(async () => ({ linkId: 'link-1', userId: 'user-1', displayName: 'Alice' }));
const createMicrosoftTeamsIdentityChallenge = vi.fn(async () => 'challenge-token');
let persistedIntentPayload: Record<string, unknown> = {};
const enqueueChatOpsIntent = vi.fn(async (input: { payload: Record<string, unknown> }) => {
  persistedIntentPayload = input.payload;
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
};

vi.mock('@/lib/prisma', () => ({ default: prismaMock }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn(async () => ({ allowed: true, remaining: 10, resetAt: Date.now() + 1000, count: 1 })) }));
vi.mock('@/lib/chatops/intents', () => ({ enqueueChatOpsIntent, processInlineChatOpsIntent }));
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
    expect(response).toMatchObject({ statusCode: 401, type: 'application/vnd.microsoft.error' });
    expect(JSON.stringify(response)).toContain('/settings/chatops/link?token=challenge-token');
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
    expect(executeChatOpsCommand).toHaveBeenCalledWith(expect.objectContaining({
      command: expect.objectContaining({ kind: 'SNOOZE', snoozedUntil: new Date('2026-09-13T10:30:00.000Z') }),
    }));
    vi.useRealTimers();
  });
});
