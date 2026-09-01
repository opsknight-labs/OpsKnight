/**
 * Escalation Engine Tests
 *
 * Comprehensive test coverage for the escalation system including:
 * - resolveEscalationTarget() - user, team, schedule resolution
 * - executeEscalation() - step execution, delays, lock management
 * - processPendingEscalations() - batch processing, concurrency, error handling
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  resolveEscalationTarget,
  executeEscalation,
  processPendingEscalations,
} from '@/lib/escalation';
import prisma from '@/lib/prisma';

// Mock prisma
vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    incident: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    incidentEvent: {
      create: vi.fn(),
    },
    team: {
      findUnique: vi.fn(),
    },
    onCallSchedule: {
      findUnique: vi.fn(),
    },
  },
}));

// Mock user notifications
vi.mock('@/lib/user-notifications', () => ({
  sendUserNotification: vi.fn().mockResolvedValue({ success: true }),
}));

// Mock db-utils. The escalation repository commits through this, so the
// transaction client's writes are what these tests observe.
const txIncidentUpdate = vi.fn();
const txIncidentUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
// `executeEscalation` claims at the frozen system time used by these tests, so
// the reloaded lease must carry that same token or every commit reads as
// superseded.
vi.mock('@/lib/db-utils', () => ({
  runSerializableTransaction: vi.fn(async fn => {
    return fn({
      incident: {
        findUnique: vi.fn().mockResolvedValue({
          status: 'OPEN',
          assigneeId: null,
          teamId: null,
          escalationStatus: 'ESCALATING',
          escalationProcessingAt: new Date('2026-01-01T12:00:00.000Z'),
          currentEscalationStep: 0,
        }),
        updateMany: txIncidentUpdateMany,
        update: txIncidentUpdate,
      },
      incidentEvent: { create: vi.fn() },
      backgroundJob: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'job-next' }),
      },
    });
  }),
}));

describe('resolveEscalationTarget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('USER target type', () => {
    it('returns an active user', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
        id: 'user-123',
        name: 'Primary',
        status: 'ACTIVE',
      } as never);

      const result = await resolveEscalationTarget('USER', 'user-123');
      expect(result).toEqual(['user-123']);
    });

    it.each(['INVITED', 'DISABLED'])('never pages a %s user', async status => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
        id: 'user-123',
        name: 'Primary',
        status,
      } as never);

      expect(await resolveEscalationTarget('USER', 'user-123')).toEqual([]);
    });

    it('never pages a deleted user', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null);

      expect(await resolveEscalationTarget('USER', 'user-123')).toEqual([]);
    });

    it('surfaces a database failure instead of reporting an empty audience', async () => {
      vi.mocked(prisma.user.findUnique).mockRejectedValueOnce(new Error('connection reset'));

      await expect(resolveEscalationTarget('USER', 'user-123')).rejects.toThrow(
        'Failed to resolve escalation user target'
      );
    });
  });

  describe('TEAM target type', () => {
    it('returns all team members with notifications enabled', async () => {
      vi.mocked(prisma.team.findUnique).mockResolvedValueOnce({
        name: 'Payments',
        teamLeadId: 'lead-1',
        members: [
          { userId: 'user-1', user: { status: 'ACTIVE' } },
          { userId: 'user-2', user: { status: 'ACTIVE' } },
          { userId: 'lead-1', user: { status: 'ACTIVE' } },
          { userId: 'invited-1', user: { status: 'INVITED' } },
          { userId: 'disabled-1', user: { status: 'DISABLED' } },
        ],
      } as any);

      const result = await resolveEscalationTarget('TEAM', 'team-1');

      // Deterministically ordered, and only active responders.
      expect(result).toEqual(['lead-1', 'user-1', 'user-2']);
      expect(prisma.team.findUnique).toHaveBeenCalledWith({
        where: { id: 'team-1' },
        select: {
          name: true,
          teamLeadId: true,
          members: {
            where: { receiveTeamNotifications: true },
            select: {
              userId: true,
              user: { select: { status: true } },
            },
          },
        },
      });
    });

    it('returns only team lead when notifyOnlyTeamLead is true', async () => {
      vi.mocked(prisma.team.findUnique).mockResolvedValueOnce({
        name: 'Payments',
        teamLeadId: 'lead-1',
        members: [
          { userId: 'user-1', user: { status: 'ACTIVE' } },
          { userId: 'lead-1', user: { status: 'ACTIVE' } },
        ],
      } as any);

      const result = await resolveEscalationTarget('TEAM', 'team-1', new Date(), true);

      expect(result).toEqual(['lead-1']);
    });

    it('returns empty array when team not found', async () => {
      vi.mocked(prisma.team.findUnique).mockResolvedValueOnce(null);

      const result = await resolveEscalationTarget('TEAM', 'nonexistent');

      expect(result).toEqual([]);
    });

    it('returns empty array when team lead only but lead not in members', async () => {
      vi.mocked(prisma.team.findUnique).mockResolvedValueOnce({
        name: 'Payments',
        teamLeadId: 'lead-1',
        // Lead is not a member that receives team notifications.
        members: [{ userId: 'user-1', user: { status: 'ACTIVE' } }],
      } as any);

      const result = await resolveEscalationTarget('TEAM', 'team-1', new Date(), true);

      expect(result).toEqual([]);
    });
  });

  describe('SCHEDULE target type', () => {
    it('returns on-call users from schedule overrides', async () => {
      const atTime = new Date('2026-01-15T12:00:00.000Z');

      vi.mocked(prisma.onCallSchedule.findUnique).mockResolvedValueOnce({
        id: 'schedule-1',
        timeZone: 'UTC',
        layers: [
          {
            id: 'layer-1',
            name: 'Layer 1',
            start: new Date('2026-01-01T00:00:00.000Z'),
            end: null,
            rotationLengthHours: 168,
            restrictions: null,
            users: [{ userId: 'layer-user-1', user: { name: 'Layer User' }, position: 0 }],
          },
        ],
        overrides: [
          {
            id: 'override-1',
            userId: 'override-user-1',
            user: { name: 'Override User' },
            start: new Date('2026-01-15T00:00:00.000Z'),
            end: new Date('2026-01-16T00:00:00.000Z'),
            replacesUserId: null,
          },
        ],
      } as any);

      const result = await resolveEscalationTarget('SCHEDULE', 'schedule-1', atTime);

      expect(result).toContain('override-user-1');
    });

    it('returns empty array when schedule not found', async () => {
      vi.mocked(prisma.onCallSchedule.findUnique).mockResolvedValueOnce(null);

      const result = await resolveEscalationTarget('SCHEDULE', 'nonexistent');

      expect(result).toEqual([]);
    });

    it('returns empty array when schedule has no layers', async () => {
      vi.mocked(prisma.onCallSchedule.findUnique).mockResolvedValueOnce({
        id: 'schedule-1',
        timeZone: 'UTC',
        layers: [],
        overrides: [],
      } as any);

      const result = await resolveEscalationTarget('SCHEDULE', 'schedule-1');

      expect(result).toEqual([]);
    });
  });

  describe('Unknown target type', () => {
    it('returns empty array for unknown target type', async () => {
      const result = await resolveEscalationTarget('UNKNOWN' as any, 'id');
      expect(result).toEqual([]);
    });
  });
});

describe('executeEscalation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T12:00:00.000Z'));
    vi.clearAllMocks();
    vi.mocked(prisma.incident.updateMany).mockResolvedValue({ count: 1 } as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns early when incident not found', async () => {
    vi.mocked(prisma.incident.findUnique).mockResolvedValueOnce(null);

    const result = await executeEscalation('nonexistent');

    expect(result).toEqual({
      outcome: 'NO_INCIDENT',
      escalated: false,
      reason: 'Incident not found',
    });
    expect(prisma.incident.updateMany).not.toHaveBeenCalled();
  });

  it('returns early when no escalation policy configured', async () => {
    vi.mocked(prisma.incident.findUnique).mockResolvedValueOnce({
      id: 'inc-1',
      service: { policy: null },
    } as any);

    const result = await executeEscalation('inc-1');

    expect(result).toEqual({
      outcome: 'NO_POLICY',
      escalated: false,
      reason: 'No escalation policy configured',
    });
  });

  it('returns early when escalation already completed', async () => {
    vi.mocked(prisma.incident.findUnique).mockResolvedValueOnce({
      id: 'inc-1',
      escalationStatus: 'COMPLETED',
      service: {
        policy: {
          steps: [{ delayMinutes: 0, targetType: 'USER', targetUserId: 'user-1' }],
        },
      },
    } as any);

    const result = await executeEscalation('inc-1');

    expect(result).toEqual({
      outcome: 'COMPLETED',
      escalated: false,
      reason: 'Escalation already completed',
    });
  });

  it('marks escalation as completed when all steps exhausted', async () => {
    vi.mocked(prisma.incident.findUnique).mockResolvedValueOnce({
      id: 'inc-1',
      currentEscalationStep: 1, // Only 1 step, so step 1 is out of bounds
      escalationStatus: 'ESCALATING',
      service: {
        policy: {
          steps: [{ delayMinutes: 0, targetType: 'USER', targetUserId: 'user-1' }],
        },
      },
    } as any);

    const result = await executeEscalation('inc-1');

    expect(result).toEqual({
      outcome: 'COMPLETED',
      escalated: false,
      reason: 'All escalation steps exhausted',
    });
    // Terminal state is committed by the repository, inside a transaction.
    expect(txIncidentUpdateMany).toHaveBeenCalledWith({
      where: {
        id: 'inc-1',
        status: 'OPEN',
        escalationGeneration: 0,
        currentEscalationStep: 1,
      },
      data: {
        escalationStatus: 'COMPLETED',
        nextEscalationAt: null,
        currentEscalationStep: null,
        escalationProcessingAt: null,
      },
    });
  });

  it('returns in-progress when lock cannot be acquired', async () => {
    vi.mocked(prisma.incident.findUnique).mockResolvedValueOnce({
      id: 'inc-1',
      currentEscalationStep: 0,
      nextEscalationAt: new Date('2026-01-01T11:00:00.000Z'), // In the past
      escalationStatus: 'ESCALATING',
      service: {
        policy: {
          steps: [
            {
              delayMinutes: 0,
              targetType: 'USER',
              targetUserId: 'user-1',
              targetUser: { name: 'User 1' },
              notificationChannels: [],
            },
          ],
        },
      },
    } as never);

    // Lock acquisition fails, and the incident is still a live escalation, so
    // this is a competing worker rather than a superseded generation.
    vi.mocked(prisma.incident.updateMany).mockResolvedValueOnce({ count: 0 } as any);
    vi.mocked(prisma.incident.findUnique).mockResolvedValueOnce({
      status: 'OPEN',
      escalationStatus: 'ESCALATING',
      escalationGeneration: 0,
    } as never);

    const result = await executeEscalation('inc-1');

    expect(result).toEqual({
      outcome: 'ALREADY_CLAIMED',
      escalated: false,
      reason: 'Escalation already in progress',
    });
  });

  it('handles invalid target configuration gracefully', async () => {
    vi.mocked(prisma.incident.findUnique).mockResolvedValueOnce({
      id: 'inc-1',
      currentEscalationStep: 0,
      nextEscalationAt: new Date('2026-01-01T11:00:00.000Z'),
      escalationStatus: 'ESCALATING',
      service: {
        policy: {
          steps: [
            {
              delayMinutes: 0,
              targetType: 'USER',
              targetUserId: null, // Invalid - no target ID
              targetTeamId: null,
              targetScheduleId: null,
              notificationChannels: [],
            },
          ],
        },
      },
    } as any);

    vi.mocked(prisma.incident.updateMany).mockResolvedValueOnce({ count: 1 } as any);

    const result = await executeEscalation('inc-1');

    expect(result).toEqual({
      outcome: 'INVALID_TARGET',
      escalated: false,
      reason: 'USER step has no target ID configured',
      stepIndex: 0,
    });
  });
});

describe('processPendingEscalations', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T12:00:00.000Z'));
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns zero counts when no incidents pending', async () => {
    vi.mocked(prisma.incident.findMany).mockResolvedValueOnce([]);

    const result = await processPendingEscalations();

    expect(result).toEqual({
      processed: 0,
      total: 0,
      errors: undefined,
    });
  });

  it('processes incidents in batches', async () => {
    const incidents = Array.from({ length: 10 }, (_, i) => ({
      id: `inc-${i}`,
      currentEscalationStep: 0,
      escalationStatus: 'ESCALATING',
    }));

    vi.mocked(prisma.incident.findMany).mockResolvedValueOnce(incidents as any);

    const executor = vi.fn().mockResolvedValue({ outcome: 'STEP_EXECUTED', escalated: true });

    const result = await processPendingEscalations(executor);

    expect(executor).toHaveBeenCalledTimes(10);
    expect(result.processed).toBe(10);
    expect(result.total).toBe(10);
  });

  it('handles executor errors gracefully', async () => {
    const incidents = [
      { id: 'inc-1', currentEscalationStep: 0, escalationStatus: 'ESCALATING' },
      { id: 'inc-2', currentEscalationStep: 0, escalationStatus: 'ESCALATING' },
    ];

    vi.mocked(prisma.incident.findMany).mockResolvedValueOnce(incidents as any);

    const executor = vi
      .fn()
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce({ outcome: 'STEP_EXECUTED', escalated: true });

    const result = await processPendingEscalations(executor);

    expect(result.processed).toBe(1);
    expect(result.total).toBe(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors![0]).toContain('Network error');
  });

  it('marks benign failures as completed without errors', async () => {
    const incidents = [{ id: 'inc-1', currentEscalationStep: 0, escalationStatus: 'ESCALATING' }];

    vi.mocked(prisma.incident.findMany).mockResolvedValueOnce(incidents as any);

    const executor = vi.fn().mockResolvedValue({
      outcome: 'COMPLETED',
      escalated: false,
      reason: 'already completed',
    });

    const result = await processPendingEscalations(executor);

    expect(result.processed).toBe(0);
    expect(result.total).toBe(1);
    expect(result.errors).toBeUndefined();
    // Should not call update for an authoritative terminal outcome
    expect(prisma.incident.update).not.toHaveBeenCalled();
  });

  it('handles retryable errors gracefully', async () => {
    const incidents = [
      {
        id: 'inc-1',
        currentEscalationStep: 0,
        escalationStatus: 'ESCALATING',
        escalationGeneration: 7,
      },
    ];

    vi.mocked(prisma.incident.findMany).mockResolvedValueOnce(incidents as any);

    const executor = vi.fn().mockRejectedValue(new Error('Serialization failure'));

    const result = await processPendingEscalations(executor);

    expect(result.errors).toHaveLength(1);
    // Error should be recorded
    expect(result.errors![0]).toContain('Serialization failure');
    expect(prisma.incident.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'inc-1',
        status: 'OPEN',
        escalationGeneration: 7,
        currentEscalationStep: 0,
      },
      data: { escalationProcessingAt: null },
    });
  });

  it('uses provided step index from incident', async () => {
    const incidents = [{ id: 'inc-1', currentEscalationStep: 3, escalationStatus: 'ESCALATING' }];

    vi.mocked(prisma.incident.findMany).mockResolvedValueOnce(incidents as any);

    const executor = vi.fn().mockResolvedValue({ outcome: 'STEP_EXECUTED', escalated: true });

    await processPendingEscalations(executor);

    expect(executor).toHaveBeenCalledWith('inc-1', 3);
  });

  it('defaults to step 0 when currentEscalationStep is null', async () => {
    const incidents = [
      { id: 'inc-1', currentEscalationStep: null, escalationStatus: 'ESCALATING' },
    ];

    vi.mocked(prisma.incident.findMany).mockResolvedValueOnce(incidents as any);

    const executor = vi.fn().mockResolvedValue({ outcome: 'STEP_EXECUTED', escalated: true });

    await processPendingEscalations(executor);

    expect(executor).toHaveBeenCalledWith('inc-1', 0);
  });
});
