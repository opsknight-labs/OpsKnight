import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleSlashCommand, SlashCommandPayload } from '@/lib/chatops/slash-commands';
import prisma from '@/lib/prisma';
import * as retryModule from '@/lib/retry';

vi.mock('@/lib/prisma', () => ({
  default: {
    incident: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    incidentNote: {
      create: vi.fn(),
    },
    incidentEvent: {
      create: vi.fn(),
    },
    user: {
      findFirst: vi.fn(),
    },
    escalationPolicy: {
      findUnique: vi.fn(),
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

describe('ChatOps Slash Command Dispatcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(retryModule.retryFetch).mockResolvedValue({
      json: async () => ({ ok: true, user: { profile: { email: 'alice@test.com' } } }),
    } as any);
    vi.mocked(prisma.user.findFirst).mockResolvedValue({
      id: 'usr-alice',
      name: 'Alice',
      email: 'alice@test.com',
    } as any);
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

  it('should return help block when /incident help is invoked', async () => {
    const result = await handleSlashCommand({ ...basePayload, text: 'help' });
    expect(result.response_type).toBe('ephemeral');
    expect(result.blocks).toBeDefined();
  });

  it('should return error message when channel is not linked to any incident', async () => {
    vi.mocked(prisma.incident.findFirst).mockResolvedValue(null);

    const result = await handleSlashCommand({ ...basePayload, text: 'ack' });
    expect(result.response_type).toBe('ephemeral');
    expect(result.text).toContain('No incident is linked to this channel');
  });

  it('should handle /incident ack command', async () => {
    vi.mocked(prisma.incident.findFirst).mockResolvedValue({
      id: 'inc-104',
      title: 'Payments API Failure',
      status: 'OPEN',
      acknowledgedAt: null,
      service: { id: 'srv-1', name: 'Payments' },
    } as any);

    vi.mocked(prisma.incident.update).mockResolvedValue({} as any);
    vi.mocked(prisma.incidentEvent.create).mockResolvedValue({} as any);

    const result = await handleSlashCommand({ ...basePayload, text: 'ack' });
    expect(result.response_type).toBe('in_channel');
    expect(result.text).toContain('Incident Acknowledged');
    expect(prisma.incident.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'inc-104' },
        data: expect.objectContaining({ status: 'ACKNOWLEDGED' }),
      })
    );
  });

  it('should handle /incident resolve command with summary', async () => {
    vi.mocked(prisma.incident.findFirst).mockResolvedValue({
      id: 'inc-104',
      title: 'Payments API Failure',
      status: 'ACKNOWLEDGED',
      resolvedAt: null,
      service: { id: 'srv-1', name: 'Payments' },
    } as any);

    vi.mocked(prisma.incident.update).mockResolvedValue({} as any);
    vi.mocked(prisma.incidentEvent.create).mockResolvedValue({} as any);

    // Mock Slack user resolution
    vi.spyOn(retryModule, 'retryFetch').mockResolvedValue({
      json: async () => ({ ok: true, user: { profile: { email: 'alice@test.com' } } }),
    } as any);

    vi.mocked(prisma.user.findFirst).mockResolvedValue({
      id: 'usr-alice',
      name: 'Alice',
      email: 'alice@test.com',
    } as any);

    vi.mocked(prisma.incidentNote.create).mockResolvedValue({} as any);

    const result = await handleSlashCommand({
      ...basePayload,
      text: 'resolve Restarted service pods',
    });
    expect(result.response_type).toBe('in_channel');
    expect(result.text).toContain('Incident Resolved');
    expect(result.text).toContain('Restarted service pods');
    expect(prisma.incident.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'inc-104' },
        data: expect.objectContaining({ status: 'RESOLVED' }),
      })
    );
  });

  it('should handle /incident note command', async () => {
    vi.mocked(prisma.incident.findFirst).mockResolvedValue({
      id: 'inc-104',
      title: 'Payments API Failure',
      status: 'OPEN',
      service: { id: 'srv-1', name: 'Payments' },
    } as any);

    vi.spyOn(retryModule, 'retryFetch').mockResolvedValue({
      json: async () => ({ ok: true, user: { profile: { email: 'alice@test.com' } } }),
    } as any);

    vi.mocked(prisma.user.findFirst).mockResolvedValue({
      id: 'usr-alice',
      name: 'Alice',
      email: 'alice@test.com',
    } as any);

    vi.mocked(prisma.incidentNote.create).mockResolvedValue({} as any);
    vi.mocked(prisma.incidentEvent.create).mockResolvedValue({} as any);

    const result = await handleSlashCommand({
      ...basePayload,
      text: 'note Checking DB connection pool',
    });
    expect(result.response_type).toBe('in_channel');
    expect(result.text).toContain('Note added');
    expect(prisma.incidentNote.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          incidentId: 'inc-104',
          userId: 'usr-alice',
          content: 'Checking DB connection pool',
        }),
      })
    );
  });

  it('should handle /incident who command', async () => {
    vi.mocked(prisma.incident.findFirst).mockResolvedValue({
      id: 'inc-104',
      title: 'Payments API Failure',
      status: 'OPEN',
      service: { id: 'srv-1', name: 'Payments', escalationPolicyId: 'pol-1' },
    } as any);

    vi.mocked(prisma.escalationPolicy.findUnique).mockResolvedValue({
      id: 'pol-1',
      steps: [
        {
          delayMinutes: 0,
          targetUser: { name: 'Bob OnCall', email: 'bob@test.com' },
          targetTeam: null,
        },
      ],
    } as any);

    const result = await handleSlashCommand({ ...basePayload, text: 'who' });
    expect(result.response_type).toBe('ephemeral');
    expect(result.text).toContain('Bob OnCall');
  });

  it('should return error for unknown subcommand', async () => {
    vi.mocked(prisma.incident.findFirst).mockResolvedValue({
      id: 'inc-104',
      status: 'OPEN',
      service: { id: 'srv-1', name: 'Payments' },
    } as any);

    const result = await handleSlashCommand({ ...basePayload, text: 'foobar' });
    expect(result.response_type).toBe('ephemeral');
    expect(result.text).toContain('Unknown command: `foobar`');
  });
});
