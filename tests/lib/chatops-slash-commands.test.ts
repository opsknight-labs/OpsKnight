import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  handleSlashCommand,
  parseRoleCommandArgs,
  parsePageCommandArgs,
  buildSlackDeclareModal,
  parseSlackDeclareSubmission,
  parseSlashCommandText,
  SLACK_INCIDENT_COMMAND_USAGE_HINT,
  type SlashCommandPayload,
} from '@/lib/chatops/slash-commands';
import prisma from '@/lib/prisma';
import * as retryModule from '@/lib/retry';
import {
  chatOpsLifecycleErrorMessage,
  executeChatOpsNote,
  executeChatOpsLifecycleCommand,
  executeChatOpsAssignment,
  executeChatOpsPage,
  executeChatOpsRole,
} from '@/lib/incidents/chatops-lifecycle';
import { sendIncidentNotifications } from '@/lib/user-notifications';

vi.mock('@/lib/prisma', () => ({
  default: {
    $transaction: vi.fn(),
    incident: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    service: {
      findFirst: vi.fn(),
    },
    slackIntegration: {
      findFirst: vi.fn().mockResolvedValue(null),
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
    team: { findFirst: vi.fn() },
    onCallSchedule: { findFirst: vi.fn() },
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
  executeChatOpsAssignment: vi.fn().mockResolvedValue({ changed: true }),
  executeChatOpsPage: vi.fn().mockResolvedValue({ changed: true, targetName: 'Alice' }),
  authorizeChatOpsIncident: vi.fn().mockResolvedValue(undefined),
  chatOpsLifecycleErrorMessage: vi.fn(error =>
    error instanceof Error ? error.message : 'Unable to update incident.'
  ),
}));

vi.mock('@/lib/authorization-actors', () => ({
  resolveUserActor: vi.fn().mockResolvedValue({ id: 'usr-alice', status: 'ACTIVE' }),
}));

vi.mock('@/lib/authorization-filters', () => ({
  serviceReadWhere: vi.fn().mockReturnValue({}),
  incidentReadWhere: vi.fn().mockReturnValue({}),
}));

vi.mock('@/lib/env-validation', () => ({
  getBaseUrl: () => 'https://ops.example.com/',
}));

vi.mock('@/lib/chatops/intents', () => ({ enqueueChatOpsIntent: vi.fn() }));

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
      json: async () => ({
        ok: true,
        user: { team_id: 'T111222', profile: { email: 'alice@test.com' } },
      }),
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

  describe('/incident page and assign', () => {
    beforeEach(() => {
      vi.mocked(prisma.incident.findFirst).mockResolvedValue({
        id: 'inc-104',
        title: 'Payments API Failure',
        status: 'OPEN',
        roleAssignments: [],
        service: { id: 'srv-1', name: 'Payments' },
      } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
    });

    it.each([
      ['<@U123|bob>', { kind: 'slack', slackUserId: 'U123' }],
      ['team:SRE', { kind: 'team', name: 'SRE' }],
      ['schedule: Primary', { kind: 'schedule', name: 'Primary' }],
      ['SRE', { kind: 'name', name: 'SRE' }],
      ['', null],
    ])('parses %j', (args, expected) => {
      expect(parsePageCommandArgs(args)).toEqual(expected);
    });

    it('pages a linked person in channel', async () => {
      const result = await handleSlashCommand({ ...basePayload, text: 'page <@U123>' });
      expect(result.response_type).toBe('in_channel');
      expect(result.text).toContain('Paged Alice');
      expect(executeChatOpsPage).toHaveBeenCalledWith(
        expect.objectContaining({
          incidentId: 'inc-104',
          target: { kind: 'user', userId: 'usr-alice' },
        })
      );
    });

    it('pages a team by name, and refuses an unknown target privately', async () => {
      vi.mocked(prisma.team.findFirst).mockResolvedValueOnce({ id: 'team-1' } as never);
      await handleSlashCommand({ ...basePayload, text: 'page team:SRE' });
      expect(executeChatOpsPage).toHaveBeenCalledWith(
        expect.objectContaining({ target: { kind: 'team', teamId: 'team-1' } })
      );
      vi.mocked(prisma.team.findFirst).mockResolvedValueOnce(null);
      const unknown = await handleSlashCommand({ ...basePayload, text: 'page team:Nope' });
      expect(unknown.response_type).toBe('ephemeral');
      expect(unknown.text).toContain('No team or schedule');
    });

    it('answers an unlinked Slack target privately without paging', async () => {
      vi.mocked(prisma.user.findFirst)
        .mockResolvedValueOnce({ id: 'usr-alice', name: 'Alice' } as never)
        .mockResolvedValueOnce(null);
      const result = await handleSlashCommand({ ...basePayload, text: 'page <@U777>' });
      expect(result.response_type).toBe('ephemeral');
      expect(result.text).toContain('not linked');
      expect(executeChatOpsPage).not.toHaveBeenCalled();
    });

    it('shows a permission refusal privately', async () => {
      vi.mocked(executeChatOpsPage).mockRejectedValueOnce(
        new Error('You cannot manage this incident.')
      );
      const result = await handleSlashCommand({ ...basePayload, text: 'page <@U123>' });
      expect(result.response_type).toBe('ephemeral');
      expect(result.text).toContain('You cannot manage this incident.');
    });

    it('assigns to me or a mention, and rejects other target forms', async () => {
      const me = await handleSlashCommand({ ...basePayload, text: 'assign me' });
      expect(me.response_type).toBe('in_channel');
      expect(executeChatOpsAssignment).toHaveBeenCalledWith(
        expect.objectContaining({ incidentId: 'inc-104', targetUserId: 'usr-alice' })
      );
      const bad = await handleSlashCommand({ ...basePayload, text: 'assign team:SRE' });
      expect(bad.response_type).toBe('ephemeral');
      expect(bad.text).toContain('Usage');
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

  describe('commands that work in any channel', () => {
    it('parses the subcommand and keeps raw args', () => {
      expect(parseSlashCommandText('  OnCall   Payments API ')).toEqual({
        subcommand: 'oncall',
        args: 'Payments API',
      });
      expect(parseSlashCommandText('')).toEqual({ subcommand: 'help', args: '' });
      expect(SLACK_INCIDENT_COMMAND_USAGE_HINT).toContain('declare');
    });

    it('lists every command in help, including declare, list and oncall', async () => {
      const result = await handleSlashCommand({ ...basePayload, text: 'help' });
      const text = JSON.stringify(result.blocks);
      for (const command of [
        'declare',
        'list',
        'oncall',
        'ack',
        'resolve',
        'note',
        'who',
        'postmortem',
        'ask',
      ])
        expect(text).toContain(`/incident ${command}`);
    });

    it('answers /incident oncall <service> outside a war room', async () => {
      vi.mocked(prisma.incident.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.service.findFirst).mockResolvedValue({
        id: 'srv-1',
        name: 'Pay<ments>',
        escalationPolicyId: 'pol-1',
      } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
      vi.mocked(prisma.escalationPolicy.findUnique).mockResolvedValue({
        id: 'pol-1',
        steps: [{ delayMinutes: 0, targetUser: { name: 'Bob <!here>' }, targetTeam: null }],
      } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
      const result = await handleSlashCommand({ ...basePayload, text: 'oncall payments' });
      expect(result.text).toContain('On-Call for Pay&lt;ments&gt;');
      expect(result.text).toContain('Bob &lt;!here&gt;');
      expect(result.text).not.toContain('No incident is linked');
    });

    it('lists my open incidents outside a war room with absolute links', async () => {
      vi.mocked(prisma.incident.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.incident.findMany).mockResolvedValue([
        {
          id: 'inc-1',
          title: 'DB <down>',
          status: 'OPEN',
          urgency: 'HIGH',
          service: { name: 'Pay' },
        },
      ] as any); // eslint-disable-line @typescript-eslint/no-explicit-any
      const result = await handleSlashCommand({ ...basePayload, text: 'list' });
      expect(result.text).toContain('assigned to you');
      expect(result.text).toContain('<https://ops.example.com/incidents/inc-1|DB &lt;down&gt;>');
      expect(vi.mocked(prisma.incident.findMany).mock.calls[0][0]).toMatchObject({
        where: { AND: expect.arrayContaining([{ assigneeId: 'usr-alice' }]) },
      });
    });

    it('falls back to the open incidents you can see when none are yours', async () => {
      vi.mocked(prisma.incident.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.incident.findMany)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            id: 'inc-2',
            title: 'API slow',
            status: 'OPEN',
            urgency: 'LOW',
            service: { name: 'Api' },
          },
        ] as any); // eslint-disable-line @typescript-eslint/no-explicit-any
      const result = await handleSlashCommand({ ...basePayload, text: 'list' });
      expect(result.text).toContain('none are assigned to you');
      expect(result.text).toContain('/incidents/inc-2|API slow>');
    });
  });

  it('re-throws a transient failure in the durable worker so the intent is retried', async () => {
    vi.mocked(prisma.incident.findFirst).mockResolvedValue({
      id: 'inc-104',
      title: 'Payments API Failure',
      status: 'OPEN',
      service: { id: 'srv-1', name: 'Payments' },
    } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
    vi.mocked(executeChatOpsLifecycleCommand).mockRejectedValue(new Error('db timeout'));
    await expect(
      handleSlashCommand({ ...basePayload, text: 'ack', __opsknightIntentId: 'intent-1' })
    ).rejects.toThrow('db timeout');
  });

  it('escapes the incident title in slash replies', async () => {
    vi.mocked(prisma.incident.findFirst).mockResolvedValue({
      id: 'inc-104',
      title: '<!channel> payments',
      status: 'OPEN',
      service: { id: 'srv-1', name: 'Payments' },
    } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
    const result = await handleSlashCommand({ ...basePayload, text: 'ack' });
    expect(result.text).toContain('&lt;!channel&gt; payments');
    expect(result.text).not.toContain('<!channel>');
  });

  describe('/incident declare submission', () => {
    const view = (values: Record<string, unknown>) => ({
      state: {
        values: {
          declare_title: { value: { value: values.title } },
          declare_service: {
            value: { selected_option: values.service ? { value: values.service } : null },
          },
          declare_urgency: { value: { selected_option: { value: values.urgency ?? 'HIGH' } } },
          declare_description: { value: { value: values.description ?? null } },
        },
      },
    });

    it('accepts a complete form', () => {
      expect(
        parseSlackDeclareSubmission(
          view({ title: ' Checkout down ', service: 'srv-1', urgency: 'LOW' })
        )
      ).toEqual({
        ok: true,
        value: { title: 'Checkout down', serviceId: 'srv-1', urgency: 'LOW' },
      });
    });

    it('reads the optional priority, visibility and assignee, and stays valid without them', () => {
      const withExtras = {
        state: {
          values: {
            ...view({ title: 'Checkout down', service: 'srv-1' }).state.values,
            declare_priority: { value: { selected_option: { value: 'P1' } } },
            declare_visibility: { value: { selected_option: { value: 'PRIVATE' } } },
            declare_assignee: { value: { selected_user: 'U123ABC' } },
          },
        },
      };
      expect(parseSlackDeclareSubmission(withExtras)).toEqual({
        ok: true,
        value: {
          title: 'Checkout down',
          serviceId: 'srv-1',
          urgency: 'HIGH',
          priority: 'P1',
          visibility: 'PRIVATE',
          assigneeSlackId: 'U123ABC',
        },
      });
    });

    it('rejects an out-of-range priority and a malformed assignee on their own fields', () => {
      const bad = {
        state: {
          values: {
            ...view({ title: 'Checkout down', service: 'srv-1' }).state.values,
            declare_priority: { value: { selected_option: { value: 'P9' } } },
            declare_assignee: { value: { selected_user: '<!channel>' } },
          },
        },
      };
      const result = parseSlackDeclareSubmission(bad);
      expect(result.ok).toBe(false);
      if (!result.ok)
        expect(Object.keys(result.errors).sort()).toEqual(
          ['declare_assignee', 'declare_priority'].sort()
        );
    });

    it('offers priority, visibility and an assignee picker, all optional', () => {
      const modal = buildSlackDeclareModal({ services: [{ id: 's1', name: 'Pay' }] });
      const byBlock = new Map<string, Record<string, unknown>>(
        modal.blocks.map(block => [block.block_id, block as Record<string, unknown>])
      );
      for (const id of ['declare_priority', 'declare_visibility', 'declare_assignee'])
        expect(byBlock.get(id)).toMatchObject({ optional: true });
      expect((byBlock.get('declare_assignee')?.element as { type: string }).type).toBe(
        'users_select'
      );
    });

    it('returns field errors keyed by block id', () => {
      const result = parseSlackDeclareSubmission(view({ title: 'x', urgency: 'URGENT' }));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(Object.keys(result.errors).sort()).toEqual(
          ['declare_service', 'declare_title', 'declare_urgency'].sort()
        );
      }
    });
  });
});
