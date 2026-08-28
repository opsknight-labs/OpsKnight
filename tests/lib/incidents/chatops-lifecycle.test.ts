import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/lib/errors';
import {
  chatOpsLifecycleErrorMessage,
  executeChatOpsLifecycleCommand,
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
  },
}));

vi.mock('@/lib/db-utils', () => ({
  runSerializableTransaction: vi.fn(async callback => callback(mocks.tx)),
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

  it('allows scoped USER acknowledgement when the incident is assigned to the actor', async () => {
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

    await expect(
      executeChatOpsLifecycleCommand({
        incidentId: 'inc-1',
        command: 'ACKNOWLEDGE',
        actor: { id: 'user-1', name: 'Alice' },
      })
    ).resolves.toBeDefined();

    expect(applyIncidentLifecycleCommand).toHaveBeenCalledTimes(1);
  });

  it('requires manage permission for resolve even when the USER can access the incident', async () => {
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

    await expect(
      executeChatOpsLifecycleCommand({
        incidentId: 'inc-1',
        command: 'RESOLVE',
        actor: { id: 'user-1', name: 'Alice' },
      })
    ).rejects.toMatchObject({ code: 'INCIDENT_MODIFY_DENIED' });

    expect(applyIncidentLifecycleCommand).not.toHaveBeenCalled();
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
});
