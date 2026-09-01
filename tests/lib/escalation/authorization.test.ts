import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolveUserActor: vi.fn(),
  executeEscalation: vi.fn(),
  emitAuditEvent: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    incident: { findUnique: vi.fn() },
    incidentEvent: { create: vi.fn() },
  },
}));

vi.mock('@/lib/authorization-actors', () => ({
  resolveUserActor: mocks.resolveUserActor,
}));

vi.mock('@/lib/audit', () => ({
  emitAuditEvent: mocks.emitAuditEvent,
}));

vi.mock('@/lib/escalation/index', () => ({
  executeEscalation: mocks.executeEscalation,
}));

import prisma from '@/lib/prisma';
import { AuthorizationError } from '@/lib/authorization';
import {
  authorizeIncidentEscalation,
  requestIncidentEscalation,
} from '@/lib/escalation/authorization';

function actor(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    role: 'USER',
    status: 'ACTIVE',
    teamIds: [],
    ...overrides,
  };
}

function incidentResource(overrides: Record<string, unknown> = {}) {
  return {
    assigneeId: null,
    teamId: null,
    visibility: 'PUBLIC',
    service: { teamId: null },
    watchers: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveUserActor.mockResolvedValue(actor());
  mocks.executeEscalation.mockResolvedValue({ outcome: 'STEP_EXECUTED', escalated: true });
  mocks.emitAuditEvent.mockResolvedValue(undefined);
  vi.mocked(prisma.incident.findUnique).mockResolvedValue(incidentResource() as never);
  vi.mocked(prisma.incidentEvent.create).mockResolvedValue({} as never);
});

describe('authorizeIncidentEscalation', () => {
  it('allows a responder with global operations authority', async () => {
    mocks.resolveUserActor.mockResolvedValue(actor({ role: 'RESPONDER' }));

    await expect(
      authorizeIncidentEscalation({ actorId: 'user-1', incidentId: 'inc-1' })
    ).resolves.toBeUndefined();
  });

  it('allows the incident’s assignee', async () => {
    vi.mocked(prisma.incident.findUnique).mockResolvedValue(
      incidentResource({ assigneeId: 'user-1' }) as never
    );

    await expect(
      authorizeIncidentEscalation({ actorId: 'user-1', incidentId: 'inc-1' })
    ).resolves.toBeUndefined();
  });

  it('allows a member of the service’s team', async () => {
    mocks.resolveUserActor.mockResolvedValue(actor({ teamIds: ['team-1'] }));
    vi.mocked(prisma.incident.findUnique).mockResolvedValue(
      incidentResource({ service: { teamId: 'team-1' } }) as never
    );

    await expect(
      authorizeIncidentEscalation({ actorId: 'user-1', incidentId: 'inc-1' })
    ).resolves.toBeUndefined();
  });

  it('refuses an unrelated user', async () => {
    await expect(
      authorizeIncidentEscalation({ actorId: 'user-1', incidentId: 'inc-1' })
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('refuses a user whose account is no longer active', async () => {
    mocks.resolveUserActor.mockResolvedValue(
      actor({ role: 'RESPONDER', status: 'DISABLED', teamIds: ['team-1'] })
    );

    await expect(
      authorizeIncidentEscalation({ actorId: 'user-1', incidentId: 'inc-1' })
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('refuses an actor that cannot be resolved', async () => {
    mocks.resolveUserActor.mockResolvedValue(null);

    await expect(
      authorizeIncidentEscalation({ actorId: 'ghost', incidentId: 'inc-1' })
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('refuses without revealing whether the incident exists', async () => {
    vi.mocked(prisma.incident.findUnique).mockResolvedValue(null as never);
    mocks.resolveUserActor.mockResolvedValue(actor({ role: 'ADMIN' }));

    const missing = await authorizeIncidentEscalation({
      actorId: 'user-1',
      incidentId: 'nope',
    }).catch((error: Error) => error.message);

    vi.mocked(prisma.incident.findUnique).mockResolvedValue(incidentResource() as never);
    mocks.resolveUserActor.mockResolvedValue(actor());
    const forbidden = await authorizeIncidentEscalation({
      actorId: 'user-1',
      incidentId: 'inc-1',
    }).catch((error: Error) => error.message);

    expect(missing).toBe(forbidden);
  });
});

describe('requestIncidentEscalation', () => {
  const request = {
    incidentId: 'inc-1',
    actor: { userId: 'user-1', name: 'Dana' },
    source: 'SLACK' as const,
  };

  it('authorizes, audits, and then escalates', async () => {
    mocks.resolveUserActor.mockResolvedValue(actor({ role: 'RESPONDER' }));
    vi.mocked(prisma.incident.findUnique)
      .mockResolvedValueOnce(incidentResource() as never)
      .mockResolvedValueOnce({ status: 'OPEN' } as never);

    const result = await requestIncidentEscalation(request);

    expect(result).toEqual({
      requested: true,
      execution: { outcome: 'STEP_EXECUTED', escalated: true },
    });
    expect(mocks.emitAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'incident.escalation.requested',
        target: { type: 'INCIDENT', id: 'inc-1' },
        actor: expect.objectContaining({ type: 'USER', id: 'user-1' }),
      })
    );
    expect(prisma.incidentEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'ESCALATED',
          message: 'Manual escalation requested by Dana via SLACK',
        }),
      })
    );
    // The engine is asked to advance the incident's current escalation, never a
    // caller-supplied generation.
    expect(mocks.executeEscalation).toHaveBeenCalledWith('inc-1');
  });

  it('never reaches the engine for an unauthorized actor', async () => {
    await expect(requestIncidentEscalation(request)).rejects.toBeInstanceOf(AuthorizationError);

    expect(mocks.executeEscalation).not.toHaveBeenCalled();
    expect(mocks.emitAuditEvent).not.toHaveBeenCalled();
    expect(prisma.incidentEvent.create).not.toHaveBeenCalled();
  });

  it.each(['ACKNOWLEDGED', 'RESOLVED', 'SNOOZED', 'SUPPRESSED'])(
    'refuses to page a new tier for a %s incident',
    async status => {
      mocks.resolveUserActor.mockResolvedValue(actor({ role: 'RESPONDER' }));
      vi.mocked(prisma.incident.findUnique)
        .mockResolvedValueOnce(incidentResource() as never)
        .mockResolvedValueOnce({ status } as never);

      await expect(requestIncidentEscalation(request)).resolves.toEqual({
        requested: false,
        reason: 'INCIDENT_NOT_ESCALATABLE',
      });
      expect(mocks.executeEscalation).not.toHaveBeenCalled();
    }
  );

  it('still escalates when the audit write fails', async () => {
    mocks.resolveUserActor.mockResolvedValue(actor({ role: 'RESPONDER' }));
    vi.mocked(prisma.incident.findUnique)
      .mockResolvedValueOnce(incidentResource() as never)
      .mockResolvedValueOnce({ status: 'OPEN' } as never);
    mocks.emitAuditEvent.mockRejectedValue(new Error('audit unavailable'));

    const result = await requestIncidentEscalation(request);

    expect(result).toMatchObject({ requested: true });
    expect(mocks.executeEscalation).toHaveBeenCalled();
  });
});
