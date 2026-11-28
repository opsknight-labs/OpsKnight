import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/lib/errors';
import {
  chatOpsLifecycleErrorMessage,
  executeChatOpsLifecycleCommand,
  executeChatOpsNote,
} from '@/lib/incidents/chatops-lifecycle';
import { applyIncidentLifecycleCommand } from '@/lib/incidents/lifecycle';
import { runSerializableTransaction } from '@/lib/db-utils';

const mocks = vi.hoisted(() => ({
  tx: {
    user: {
      findUnique: vi.fn(),
    },
    incident: {
      findUnique: vi.fn(),
    },
    incidentNote: { create: vi.fn() },
    incidentEvent: { create: vi.fn() },
  },
}));

vi.mock('@/lib/db-utils', () => ({
  runSerializableTransaction: vi.fn(async callback => callback(mocks.tx)),
}));

vi.mock('@/lib/idempotency', () => ({
  executeIdempotentOperation: vi.fn(
    async (_tx: unknown, input: { execute: () => Promise<unknown> }) => ({
      value: await input.execute(),
    })
  ),
}));

vi.mock('@/lib/incidents/lifecycle', () => ({
  applyIncidentLifecycleCommand: vi.fn(),
}));

describe('ChatOps lifecycle adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tx.user.findUnique.mockResolvedValue({
      id: 'user-1',
      role: 'ADMIN',
      status: 'ACTIVE',
      teamMemberships: [],
    });
    mocks.tx.incident.findUnique.mockResolvedValue({
      assigneeId: null,
      teamId: null,
      visibility: 'PUBLIC',
      watchers: [],
      service: { teamId: 'team-1' },
    });
    vi.mocked(applyIncidentLifecycleCommand).mockResolvedValue({
      incidentId: 'inc-1',
      command: 'ACKNOWLEDGE',
      source: 'CHATOPS',
      previousStatus: 'OPEN',
      status: 'ACKNOWLEDGED',
      changed: true,
    });
  });

  it('authorizes and applies ACK atomically with CHATOPS as the source', async () => {
    const result = await executeChatOpsLifecycleCommand({
      incidentId: 'inc-1',
      command: 'ACKNOWLEDGE',
      actor: { id: 'user-1', name: 'Alice' },
      eventMessage: 'Acknowledged via Slack by Alice',
    });

    expect(runSerializableTransaction).toHaveBeenCalledTimes(1);
    expect(applyIncidentLifecycleCommand).toHaveBeenCalledWith(
      mocks.tx,
      expect.objectContaining({
        incidentId: 'inc-1',
        command: 'ACKNOWLEDGE',
        source: 'CHATOPS',
        actor: { id: 'user-1', name: 'Alice' },
        eventMessage: 'Acknowledged via Slack by Alice',
      })
    );
    expect(result.changed).toBe(true);
  });

  it('denies USER acknowledgement even when the incident is assigned to the actor', async () => {
    mocks.tx.user.findUnique.mockResolvedValue({
      id: 'user-1',
      role: 'USER',
      status: 'ACTIVE',
      teamMemberships: [],
    });
    mocks.tx.incident.findUnique.mockResolvedValue({
      assigneeId: 'user-1',
      teamId: null,
      visibility: 'PRIVATE',
      watchers: [],
      service: { teamId: null },
    });

    await executeChatOpsLifecycleCommand({
      incidentId: 'inc-1',
      command: 'ACKNOWLEDGE',
      actor: { id: 'user-1', name: 'Alice' },
    });

    expect(applyIncidentLifecycleCommand).toHaveBeenCalled();
  });

  it('denies USER acknowledgement of an incident they have no relationship to', async () => {
    mocks.tx.user.findUnique.mockResolvedValue({
      id: 'user-1',
      role: 'USER',
      status: 'ACTIVE',
      teamMemberships: [],
    });
    mocks.tx.incident.findUnique.mockResolvedValue({
      assigneeId: 'someone-else',
      teamId: null,
      visibility: 'PUBLIC',
      watchers: [{ userId: 'user-1' }],
      service: { teamId: 'team-9', escalationPolicyId: null },
    });

    await expect(
      executeChatOpsLifecycleCommand({
        incidentId: 'inc-1',
        command: 'ACKNOWLEDGE',
        actor: { id: 'user-1', name: 'Alice' },
      })
    ).rejects.toMatchObject({ status: 403 });

    expect(applyIncidentLifecycleCommand).not.toHaveBeenCalled();
  });

  it('lets an assigned USER resolve but not snooze (snooze needs manage permission)', async () => {
    mocks.tx.user.findUnique.mockResolvedValue({
      id: 'user-1',
      role: 'USER',
      status: 'ACTIVE',
      teamMemberships: [],
    });
    mocks.tx.incident.findUnique.mockResolvedValue({
      assigneeId: 'user-1',
      teamId: null,
      visibility: 'PRIVATE',
      watchers: [],
      service: { teamId: null },
    });

    await executeChatOpsLifecycleCommand({
      incidentId: 'inc-1',
      command: 'RESOLVE',
      actor: { id: 'user-1', name: 'Alice' },
    });
    expect(applyIncidentLifecycleCommand).toHaveBeenCalledTimes(1);

    await expect(
      executeChatOpsLifecycleCommand({
        incidentId: 'inc-1',
        command: 'SNOOZE',
        actor: { id: 'user-1', name: 'Alice' },
      })
    ).rejects.toMatchObject({ code: 'INCIDENT_MODIFY_DENIED' });
    expect(applyIncidentLifecycleCommand).toHaveBeenCalledTimes(1);
  });

  it('rejects inactive or stale ChatOps identities before mutation', async () => {
    mocks.tx.user.findUnique.mockResolvedValue({
      id: 'user-1',
      role: 'RESPONDER',
      status: 'DISABLED',
      teamMemberships: [],
    });

    await expect(
      executeChatOpsLifecycleCommand({
        incidentId: 'inc-1',
        command: 'ACKNOWLEDGE',
        actor: { id: 'user-1', name: 'Alice' },
      })
    ).rejects.toMatchObject({ code: 'AUTHORIZATION_DENIED' });

    expect(applyIncidentLifecycleCommand).not.toHaveBeenCalled();
  });

  it('returns typed not-found failures before lifecycle execution', async () => {
    mocks.tx.incident.findUnique.mockResolvedValue(null);

    await expect(
      executeChatOpsLifecycleCommand({
        incidentId: 'missing',
        command: 'RESOLVE',
        actor: { id: 'user-1', name: 'Alice' },
      })
    ).rejects.toMatchObject({ code: 'INCIDENT_NOT_FOUND' });

    expect(applyIncidentLifecycleCommand).not.toHaveBeenCalled();
  });

  it('does not leak internal AppError messages into Slack responses', () => {
    const error = new AppError({
      code: 'INTERNAL_ERROR',
      userMessage: 'database credentials leaked here',
    });

    expect(chatOpsLifecycleErrorMessage(error)).not.toContain('database credentials');
  });

  it('keeps the whole note on the note but clips the indexed timeline message', async () => {
    // High-entropy text of ~3 KB: a btree entry on the message cannot hold it.
    const stackTrace = Array.from({ length: 3000 }, (_, i) =>
      String.fromCharCode(33 + ((i * 7919) % 90))
    ).join('');

    await executeChatOpsNote({
      incidentId: 'inc-1',
      actor: { id: 'user-1', name: 'Alice' },
      content: stackTrace,
      provider: 'SLACK',
    });

    expect(mocks.tx.incidentNote.create).toHaveBeenCalledWith({
      data: { incidentId: 'inc-1', userId: 'user-1', content: stackTrace },
    });
    const event = (mocks.tx.incidentEvent.create.mock.calls[0][0] as { data: { message: string } })
      .data;
    expect(Buffer.byteLength(event.message, 'utf8')).toBeLessThanOrEqual(1500);
    expect(event.message.startsWith('Note added via Slack ChatOps by Alice:\n')).toBe(true);
    expect(event.message.endsWith('…')).toBe(true);
  });

  it('writes a short note into the timeline unchanged', async () => {
    await executeChatOpsNote({
      incidentId: 'inc-1',
      actor: { id: 'user-1', name: 'Alice' },
      content: 'Restarted the worker',
      provider: 'MICROSOFT_TEAMS',
    });
    expect(mocks.tx.incidentEvent.create).toHaveBeenCalledWith({
      data: {
        incidentId: 'inc-1',
        type: 'COMMENT',
        message: 'Note added via Microsoft Teams ChatOps by Alice:\nRestarted the worker',
      },
    });
  });
});
