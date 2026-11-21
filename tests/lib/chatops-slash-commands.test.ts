import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  handleSlashCommand,
  parseRoleCommandArgs,
  type SlashCommandPayload,
} from '@/lib/chatops/slash-commands';
import prisma from '@/lib/prisma';
import * as retryModule from '@/lib/retry';
import {
  chatOpsLifecycleErrorMessage,
  executeChatOpsNote,
  executeChatOpsLifecycleCommand,
  executeChatOpsRole,
} from '@/lib/incidents/chatops-lifecycle';
import { sendIncidentNotifications } from '@/lib/user-notifications';

vi.mock('@/lib/prisma', () => ({
  default: {
    $transaction: vi.fn(),
    incident: {
      findFirst: vi.fn(),
    },
    incidentNote: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    incidentEvent: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    user: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    escalationPolicy: {
      findUnique: vi.fn(),
    },
    postmortem: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  },
}));

vi.mock('@/lib/slack', () => ({
  getSlackBotToken: vi.fn().mockResolvedValue('xoxb-test-token'),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('@/lib/retry', () => ({
  retryFetch: vi.fn(),
}));

vi.mock('@/lib/incidents/chatops-lifecycle', () => ({
  executeChatOpsLifecycleCommand: vi.fn(),
  executeChatOpsNote: vi.fn().mockResolvedValue({ created: true }),
  executeChatOpsRole: vi.fn().mockResolvedValue({ changed: true, userName: 'Alice' }),
  authorizeChatOpsIncident: vi.fn().mockResolvedValue(undefined),
  chatOpsLifecycleErrorMessage: vi.fn(error =>
    error instanceof Error ? error.message : 'Unable to update incident.'
  ),
}));

vi.mock('@/lib/user-notifications', () => ({
  sendIncidentNotifications: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('@/lib/chatops/war-room', () => ({
  updateWarRoomTopic: vi.fn().mockResolvedValue(undefined),
  archiveWarRoomChannel: vi.fn().mockResolvedValue(undefined),
}));

describe('ChatOps Slash Command Dispatcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(retryModule.retryFetch).mockResolvedValue({
      json: async () => ({ ok: true, user: { profile: { email: 'alice@test.com' } } }),
    } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.user.findFirst).mockResolvedValue({
      id: 'usr-alice',
      name: 'Alice',
      email: 'alice@test.com',
    } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
    vi.mocked(executeChatOpsLifecycleCommand).mockImplementation(async input => ({
      incidentId: input.incidentId,
      command: input.command,
      source: 'CHATOPS',
      previousStatus: 'OPEN',
      status: input.command === 'ACKNOWLEDGE' ? 'ACKNOWLEDGED' : 'RESOLVED',
      changed: true,
    }));
    vi.mocked(prisma.$transaction).mockImplementation(async operation =>
      operation(prisma as never)
    );
  });

  const basePayload: SlashCommandPayload = {
    command: '/incident',
    text: 'help',
    channel_id: 'C123456',
    channel_name: 'inc-104-payments',
    user_id: 'U999888',
    user_name: 'alice',
    team_id: 'T111222',
    response_url: 'https://hooks.slack.com/commands/test',
  };

  describe('/incident role', () => {
    it.each([
      ['commander me', 'COMMANDER', { kind: 'me' }],
      ['ops-lead clear', 'OPS_LEAD', { kind: 'clear' }],
      ['Comms lead <@U123|bob>', 'COMMS_LEAD', { kind: 'slack', slackUserId: 'U123' }],
      ['ic <@U9>', 'COMMANDER', { kind: 'slack', slackUserId: 'U9' }],
      ['scribe none', 'SCRIBE', { kind: 'clear' }],
    ])('parses %s', (args, roleKey, target) => {
      expect(parseRoleCommandArgs(args)).toEqual({ roleKey, target });
    });

    it.each(['', 'commander', 'pilot me', 'commander bob'])('rejects %j with usage', args => {
      expect(parseRoleCommandArgs(args)).toHaveProperty('error');
    });

    it('takes command for the caller through the role command', async () => {
      vi.mocked(prisma.incident.findFirst).mockResolvedValue({
        id: 'inc-104',
        title: 'Payments API Failure',
        status: 'OPEN',
        roleAssignments: [],
        service: { id: 'srv-1', name: 'Payments' },
      } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
      const result = await handleSlashCommand({ ...basePayload, text: 'role commander me' });
      expect(result.response_type).toBe('in_channel');
      expect(result.text).toContain('Incident commander');
      expect(executeChatOpsRole).toHaveBeenCalledWith({
        incidentId: 'inc-104',
        actor: { id: 'usr-alice', name: 'Alice' },
        roleKey: 'COMMANDER',
        targetUserId: 'usr-alice',
        provider: 'SLACK',
      });
    });

    it('lists every role with holders and gaps', async () => {
      vi.mocked(prisma.incident.findFirst).mockResolvedValue({
        id: 'inc-104',
        title: 'Payments API Failure',
        status: 'OPEN',
        roleAssignments: [{ roleKey: 'SCRIBE', user: { name: 'Sam' } }],
        service: { id: 'srv-1', name: 'Payments' },
      } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
      const result = await handleSlashCommand({ ...basePayload, text: 'roles' });
      expect(result.text).toContain('*Scribe:* Sam');
      expect(result.text).toContain('*Incident commander:* _unassigned_');
    });
  });

  it('returns help block when /incident help is invoked', async () => {
    const result = await handleSlashCommand({ ...basePayload, text: 'help' });
    expect(result.response_type).toBe('ephemeral');
    expect(result.blocks).toBeDefined();
  });

  it('returns an error when the channel is not linked to an incident', async () => {
    vi.mocked(prisma.incident.findFirst).mockResolvedValue(null);

    const result = await handleSlashCommand({ ...basePayload, text: 'ack' });
    expect(result.response_type).toBe('ephemeral');
    expect(result.text).toContain('No incident is linked to this channel');
  });

  it('routes /incident ack through the ChatOps lifecycle adapter', async () => {
    vi.mocked(prisma.incident.findFirst).mockResolvedValue({
      id: 'inc-104',
      title: 'Payments API Failure',
      status: 'OPEN',
      service: { id: 'srv-1', name: 'Payments' },
    } as any); // eslint-disable-line @typescript-eslint/no-explicit-any

    const result = await handleSlashCommand({ ...basePayload, text: 'ack' });

    expect(result.response_type).toBe('in_channel');
    expect(result.text).toContain('Incident Acknowledged');
    expect(executeChatOpsLifecycleCommand).toHaveBeenCalledWith({
      incidentId: 'inc-104',
      command: 'ACKNOWLEDGE',
      actor: { id: 'usr-alice', name: 'Alice' },
      eventMessage: 'Acknowledged via Slack ChatOps by Alice',
    });
  });

  it('treats duplicate ACK as a no-op without repeating lifecycle notifications', async () => {
    vi.mocked(prisma.incident.findFirst).mockResolvedValue({
      id: 'inc-104',
      title: 'Payments API Failure',
      status: 'ACKNOWLEDGED',
      service: { id: 'srv-1', name: 'Payments' },
    } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
    vi.mocked(executeChatOpsLifecycleCommand).mockResolvedValue({
      incidentId: 'inc-104',
      command: 'ACKNOWLEDGE',
      source: 'CHATOPS',
      previousStatus: 'ACKNOWLEDGED',
      status: 'ACKNOWLEDGED',
      changed: false,
    });

    const result = await handleSlashCommand({ ...basePayload, text: 'ack' });

    expect(result.response_type).toBe('ephemeral');
    expect(result.text).toContain('already acknowledged');
    expect(sendIncidentNotifications).not.toHaveBeenCalled();
  });

  it('routes /incident resolve through the lifecycle adapter with the resolution note', async () => {
    vi.mocked(prisma.incident.findFirst).mockResolvedValue({
      id: 'inc-104',
      title: 'Payments API Failure',
      status: 'ACKNOWLEDGED',
      service: { id: 'srv-1', name: 'Payments' },
    } as any); // eslint-disable-line @typescript-eslint/no-explicit-any

    const result = await handleSlashCommand({
      ...basePayload,
      text: 'resolve Restarted service pods',
    });

    expect(result.response_type).toBe('in_channel');
    expect(result.text).toContain('Incident Resolved');
    expect(executeChatOpsLifecycleCommand).toHaveBeenCalledWith({
      incidentId: 'inc-104',
      command: 'RESOLVE',
      actor: { id: 'usr-alice', name: 'Alice' },
      resolutionNote: 'Restarted service pods',
      eventMessage: 'Resolved via Slack ChatOps by Alice: Restarted service pods',
    });
  });

  it('returns a safe lifecycle error to Slack', async () => {
    vi.mocked(prisma.incident.findFirst).mockResolvedValue({
      id: 'inc-104',
      title: 'Payments API Failure',
      status: 'OPEN',
      service: { id: 'srv-1', name: 'Payments' },
    } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
    vi.mocked(executeChatOpsLifecycleCommand).mockRejectedValue(new Error('denied'));
    vi.mocked(chatOpsLifecycleErrorMessage).mockReturnValue(
      'You do not have permission to acknowledge this incident.'
    );

    const result = await handleSlashCommand({ ...basePayload, text: 'ack' });

    expect(result.response_type).toBe('ephemeral');
    expect(result.text).toBe('⚠️ You do not have permission to acknowledge this incident.');
  });

  it('keeps non-lifecycle /incident note behavior unchanged', async () => {
    vi.mocked(prisma.incident.findFirst).mockResolvedValue({
      id: 'inc-104',
      title: 'Payments API Failure',
      status: 'OPEN',
      service: { id: 'srv-1', name: 'Payments' },
    } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.incidentNote.create).mockResolvedValue({} as any); // eslint-disable-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.incidentEvent.create).mockResolvedValue({} as any); // eslint-disable-line @typescript-eslint/no-explicit-any

    const result = await handleSlashCommand({
      ...basePayload,
      text: 'note Checking DB connection pool',
    });

    expect(result.response_type).toBe('in_channel');
    expect(executeChatOpsNote).toHaveBeenCalledWith(
      expect.objectContaining({
        incidentId: 'inc-104',
        actor: { id: 'usr-alice', name: 'Alice' },
        content: 'Checking DB connection pool',
        provider: 'SLACK',
      })
    );
    expect(executeChatOpsLifecycleCommand).not.toHaveBeenCalled();
  });

  it('handles /incident who command', async () => {
    vi.mocked(prisma.incident.findFirst).mockResolvedValue({
      id: 'inc-104',
      title: 'Payments API Failure',
      status: 'OPEN',
      service: { id: 'srv-1', name: 'Payments', escalationPolicyId: 'pol-1' },
    } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.escalationPolicy.findUnique).mockResolvedValue({
      id: 'pol-1',
      steps: [
        {
          delayMinutes: 0,
          targetUser: { name: 'Bob OnCall', email: 'bob@test.com' },
          targetTeam: null,
        },
      ],
    } as any); // eslint-disable-line @typescript-eslint/no-explicit-any

    const result = await handleSlashCommand({ ...basePayload, text: 'who' });
    expect(result.response_type).toBe('ephemeral');
    expect(result.text).toContain('Bob OnCall');
  });

  it('returns an error for unknown subcommands', async () => {
    vi.mocked(prisma.incident.findFirst).mockResolvedValue({
      id: 'inc-104',
      status: 'OPEN',
      service: { id: 'srv-1', name: 'Payments' },
    } as any); // eslint-disable-line @typescript-eslint/no-explicit-any

    const result = await handleSlashCommand({ ...basePayload, text: 'foobar' });
    expect(result.response_type).toBe('ephemeral');
    expect(result.text).toContain('Unknown command: `foobar`');
  });
});
