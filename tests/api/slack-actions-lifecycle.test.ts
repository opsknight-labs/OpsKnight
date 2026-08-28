import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleSlackActionRequest } from '@/app/api/slack/actions/route';
import prisma from '@/lib/prisma';
import {
  chatOpsLifecycleErrorMessage,
  executeChatOpsLifecycleCommand,
} from '@/lib/incidents/chatops-lifecycle';

vi.mock('@/lib/prisma', () => ({
  default: {
    incident: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    incidentEvent: {
      create: vi.fn(),
    },
    user: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('@/lib/slack', () => ({
  getSlackBotToken: vi.fn().mockResolvedValue('xoxb-test-token'),
}));

vi.mock('@/lib/slack-signature', () => ({
  verifySlackSignature: vi.fn(),
  toSlackResponseUrl: vi.fn(),
}));

vi.mock('@/lib/incidents/chatops-lifecycle', () => ({
  executeChatOpsLifecycleCommand: vi.fn(),
  chatOpsLifecycleErrorMessage: vi.fn(error =>
    error instanceof Error ? error.message : 'Unable to update incident.'
  ),
}));

vi.mock('@/lib/chatops/war-room', () => ({
  updateWarRoomTopic: vi.fn().mockResolvedValue(undefined),
  slackApiCall: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock('@/lib/escalation', () => ({
  executeEscalation: vi.fn().mockResolvedValue({ escalated: true }),
}));

describe('Slack interactive lifecycle actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: async () => ({
          ok: true,
          user: { profile: { email: 'alice@test.com', real_name: 'Alice' } },
        }),
      })
    );
    vi.mocked(prisma.incident.findUnique).mockResolvedValue({
      id: 'inc-1',
      serviceId: 'svc-1',
      slackChannelId: 'C123',
    } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.user.findFirst).mockResolvedValue({
      id: 'user-1',
      name: 'Alice',
    } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
    vi.mocked(executeChatOpsLifecycleCommand).mockImplementation(async input => ({
      incidentId: input.incidentId,
      command: input.command,
      source: 'CHATOPS',
      previousStatus: 'OPEN',
      status:
        input.command === 'ACKNOWLEDGE'
          ? 'ACKNOWLEDGED'
          : input.command === 'RESOLVE'
            ? 'RESOLVED'
            : 'SNOOZED',
      changed: true,
    }));
  });

  function payload(action: string, extra: Record<string, unknown> = {}) {
    return {
      type: 'block_actions',
      actions: [{ value: JSON.stringify({ action, incidentId: 'inc-1', ...extra }) }],
      user: { id: 'U123', name: 'alice' },
    };
  }

  it('routes acknowledge through the lifecycle adapter without a duplicate timeline write', async () => {
    const response = await handleSlackActionRequest(payload('ack'));
    const body = await response.json();

    expect(body.text).toContain('acknowledged');
    expect(executeChatOpsLifecycleCommand).toHaveBeenCalledWith({
      incidentId: 'inc-1',
      command: 'ACKNOWLEDGE',
      actor: { id: 'user-1', name: 'Alice' },
      eventMessage: 'Acknowledged via Slack button by Alice',
    });
    expect(prisma.incidentEvent.create).not.toHaveBeenCalled();
  });

  it('keeps an idempotent lifecycle retry side-effect free at the adapter', async () => {
    vi.mocked(executeChatOpsLifecycleCommand).mockResolvedValue({
      incidentId: 'inc-1',
      command: 'ACKNOWLEDGE',
      source: 'CHATOPS',
      previousStatus: 'ACKNOWLEDGED',
      status: 'ACKNOWLEDGED',
      changed: false,
    });

    const response = await handleSlackActionRequest(payload('ack'));
    const body = await response.json();

    expect(body.text).toContain('already acknowledged');
    expect(prisma.incidentEvent.create).not.toHaveBeenCalled();
  });

  it('routes resolve through the lifecycle adapter without post-commit lifecycle work', async () => {
    const response = await handleSlackActionRequest(payload('resolve'));
    const body = await response.json();

    expect(body.text).toContain('resolved');
    expect(executeChatOpsLifecycleCommand).toHaveBeenCalledWith({
      incidentId: 'inc-1',
      command: 'RESOLVE',
      actor: { id: 'user-1', name: 'Alice' },
      eventMessage: 'Resolved via Slack button by Alice',
    });
    expect(prisma.incidentEvent.create).not.toHaveBeenCalled();
  });

  it('routes snooze through the lifecycle adapter with the durable timer owned by the lifecycle transaction', async () => {
    const before = Date.now();
    const response = await handleSlackActionRequest(payload('snooze', { minutes: 30 }));
    const body = await response.json();

    expect(body.text).toContain('snoozed for 30m');
    expect(executeChatOpsLifecycleCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        incidentId: 'inc-1',
        command: 'SNOOZE',
        actor: { id: 'user-1', name: 'Alice' },
        eventMessage: 'Snoozed for 30m via Slack button by Alice',
        snoozedUntil: expect.any(Date),
      })
    );
    const call = vi.mocked(executeChatOpsLifecycleCommand).mock.calls[0]?.[0];
    expect(call?.snoozedUntil?.getTime()).toBeGreaterThanOrEqual(before + 30 * 60 * 1000);
    expect(prisma.incidentEvent.create).not.toHaveBeenCalled();
  });

  it('rejects invalid snooze duration before lifecycle execution', async () => {
    const response = await handleSlackActionRequest(payload('snooze', { minutes: 0 }));
    const body = await response.json();

    expect(body.text).toContain('positive number of minutes');
    expect(executeChatOpsLifecycleCommand).not.toHaveBeenCalled();
  });

  it('returns a safe typed lifecycle failure to Slack', async () => {
    vi.mocked(executeChatOpsLifecycleCommand).mockRejectedValue(new Error('internal detail'));
    vi.mocked(chatOpsLifecycleErrorMessage).mockReturnValue(
      'You do not have permission to modify this incident.'
    );

    const response = await handleSlackActionRequest(payload('resolve'));
    const body = await response.json();

    expect(body.response_type).toBe('ephemeral');
    expect(body.text).toBe('⚠️ You do not have permission to modify this incident.');
  });
});
