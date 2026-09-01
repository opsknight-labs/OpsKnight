import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    user: { findUnique: vi.fn() },
    team: { findUnique: vi.fn() },
    onCallSchedule: { findUnique: vi.fn() },
  },
}));

import prisma from '@/lib/prisma';
import {
  EscalationInfrastructureError,
  resolveEscalationTargetDetailed,
} from '@/lib/escalation/target-resolution';

const AT = new Date('2026-01-15T12:00:00.000Z');

function scheduleWithOverride(overrideUserStatus = 'ACTIVE') {
  return {
    name: 'Primary On-Call',
    timeZone: 'UTC',
    layers: [
      {
        id: 'layer-1',
        name: 'Layer 1',
        start: new Date('2026-01-01T00:00:00.000Z'),
        end: null,
        rotationLengthHours: 168,
        restrictions: null,
        users: [
          {
            userId: 'layer-user-1',
            position: 0,
            user: { name: 'Layer User', status: 'ACTIVE' },
          },
        ],
      },
    ],
    overrides: [
      {
        id: 'override-1',
        userId: 'override-user-1',
        replacesUserId: null,
        start: new Date('2026-01-15T00:00:00.000Z'),
        end: new Date('2026-01-16T00:00:00.000Z'),
        user: { name: 'Override User', status: overrideUserStatus },
      },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('USER targets', () => {
  it('resolves an active user', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      id: 'user-1',
      name: 'Alice',
      status: 'ACTIVE',
    } as never);

    await expect(
      resolveEscalationTargetDetailed({ targetType: 'USER', targetId: 'user-1' })
    ).resolves.toEqual({ outcome: 'RESOLVED', userIds: ['user-1'], targetName: 'Alice' });
  });

  it.each(['INVITED', 'DISABLED'])('rejects a %s user as an unusable target', async status => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      id: 'user-1',
      name: 'Alice',
      status,
    } as never);

    const resolution = await resolveEscalationTargetDetailed({
      targetType: 'USER',
      targetId: 'user-1',
    });

    expect(resolution.outcome).toBe('INVALID_TARGET');
  });

  it('rejects a deleted user as an unusable target', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null as never);

    const resolution = await resolveEscalationTargetDetailed({
      targetType: 'USER',
      targetId: 'gone',
    });

    expect(resolution.outcome).toBe('INVALID_TARGET');
  });

  it('throws a retryable infrastructure error instead of swallowing a database failure', async () => {
    vi.mocked(prisma.user.findUnique).mockRejectedValueOnce(new Error('connection terminated'));

    await expect(
      resolveEscalationTargetDetailed({ targetType: 'USER', targetId: 'user-1' })
    ).rejects.toBeInstanceOf(EscalationInfrastructureError);
  });
});

describe('TEAM targets', () => {
  it('resolves only active members that receive team notifications', async () => {
    vi.mocked(prisma.team.findUnique).mockResolvedValueOnce({
      name: 'Payments',
      teamLeadId: 'lead-1',
      members: [
        { userId: 'lead-1', user: { status: 'ACTIVE' } },
        { userId: 'member-1', user: { status: 'ACTIVE' } },
        { userId: 'invited-1', user: { status: 'INVITED' } },
        { userId: 'disabled-1', user: { status: 'DISABLED' } },
      ],
    } as never);

    await expect(
      resolveEscalationTargetDetailed({ targetType: 'TEAM', targetId: 'team-1' })
    ).resolves.toEqual({
      outcome: 'RESOLVED',
      userIds: ['lead-1', 'member-1'],
      targetName: 'Payments',
    });
  });

  it('deduplicates and orders recipients deterministically', async () => {
    vi.mocked(prisma.team.findUnique).mockResolvedValueOnce({
      name: 'Payments',
      teamLeadId: null,
      members: [
        { userId: 'zoe', user: { status: 'ACTIVE' } },
        { userId: 'adam', user: { status: 'ACTIVE' } },
        { userId: 'zoe', user: { status: 'ACTIVE' } },
      ],
    } as never);

    const resolution = await resolveEscalationTargetDetailed({
      targetType: 'TEAM',
      targetId: 'team-1',
    });

    expect(resolution).toMatchObject({ outcome: 'RESOLVED', userIds: ['adam', 'zoe'] });
  });

  it('reports no eligible responders for a team whose members are all inactive', async () => {
    vi.mocked(prisma.team.findUnique).mockResolvedValueOnce({
      name: 'Payments',
      teamLeadId: null,
      members: [{ userId: 'disabled-1', user: { status: 'DISABLED' } }],
    } as never);

    await expect(
      resolveEscalationTargetDetailed({ targetType: 'TEAM', targetId: 'team-1' })
    ).resolves.toEqual({ outcome: 'NO_ELIGIBLE_RESPONDERS', targetName: 'Payments' });
  });

  it('pages only the lead for a lead-only step', async () => {
    vi.mocked(prisma.team.findUnique).mockResolvedValueOnce({
      name: 'Payments',
      teamLeadId: 'lead-1',
      members: [
        { userId: 'lead-1', user: { status: 'ACTIVE' } },
        { userId: 'member-1', user: { status: 'ACTIVE' } },
      ],
    } as never);

    await expect(
      resolveEscalationTargetDetailed({
        targetType: 'TEAM',
        targetId: 'team-1',
        notifyOnlyTeamLead: true,
      })
    ).resolves.toMatchObject({ outcome: 'RESOLVED', userIds: ['lead-1'] });
  });

  it.each([
    ['the lead is disabled', 'lead-1', 'DISABLED'],
    ['the lead is only invited', 'lead-1', 'INVITED'],
  ])('never widens a lead-only step to the whole team when %s', async (_label, leadId, status) => {
    vi.mocked(prisma.team.findUnique).mockResolvedValueOnce({
      name: 'Payments',
      teamLeadId: leadId,
      members: [
        { userId: leadId, user: { status } },
        { userId: 'member-1', user: { status: 'ACTIVE' } },
      ],
    } as never);

    await expect(
      resolveEscalationTargetDetailed({
        targetType: 'TEAM',
        targetId: 'team-1',
        notifyOnlyTeamLead: true,
      })
    ).resolves.toEqual({ outcome: 'NO_ELIGIBLE_RESPONDERS', targetName: 'Payments' });
  });

  it('reports no eligible responders when a lead-only team has no lead', async () => {
    vi.mocked(prisma.team.findUnique).mockResolvedValueOnce({
      name: 'Payments',
      teamLeadId: null,
      members: [{ userId: 'member-1', user: { status: 'ACTIVE' } }],
    } as never);

    await expect(
      resolveEscalationTargetDetailed({
        targetType: 'TEAM',
        targetId: 'team-1',
        notifyOnlyTeamLead: true,
      })
    ).resolves.toEqual({ outcome: 'NO_ELIGIBLE_RESPONDERS', targetName: 'Payments' });
  });

  it('rejects a deleted team as an unusable target', async () => {
    vi.mocked(prisma.team.findUnique).mockResolvedValueOnce(null as never);

    const resolution = await resolveEscalationTargetDetailed({
      targetType: 'TEAM',
      targetId: 'gone',
    });

    expect(resolution.outcome).toBe('INVALID_TARGET');
  });

  it('throws a retryable infrastructure error on a database failure', async () => {
    vi.mocked(prisma.team.findUnique).mockRejectedValueOnce(new Error('deadlock detected'));

    await expect(
      resolveEscalationTargetDetailed({ targetType: 'TEAM', targetId: 'team-1' })
    ).rejects.toBeInstanceOf(EscalationInfrastructureError);
  });
});

describe('SCHEDULE targets', () => {
  it('resolves effective coverage at the execution instant', async () => {
    vi.mocked(prisma.onCallSchedule.findUnique).mockResolvedValueOnce(
      scheduleWithOverride() as never
    );

    const resolution = await resolveEscalationTargetDetailed({
      targetType: 'SCHEDULE',
      targetId: 'sch-1',
      at: AT,
    });

    expect(resolution).toMatchObject({ outcome: 'RESOLVED', targetName: 'Primary On-Call' });
    expect(resolution.outcome === 'RESOLVED' && resolution.userIds).toContain('override-user-1');
  });

  it('queries overrides scoped to the execution instant and active users only', async () => {
    vi.mocked(prisma.onCallSchedule.findUnique).mockResolvedValueOnce(
      scheduleWithOverride() as never
    );

    await resolveEscalationTargetDetailed({
      targetType: 'SCHEDULE',
      targetId: 'sch-1',
      at: AT,
    });

    const query = vi.mocked(prisma.onCallSchedule.findUnique).mock.calls[0][0] as any;
    expect(query.select.overrides.where).toEqual({
      start: { lte: AT },
      end: { gt: AT },
      user: { status: 'ACTIVE' },
    });
  });

  it('reports no eligible responders for a schedule with no layers or overrides', async () => {
    vi.mocked(prisma.onCallSchedule.findUnique).mockResolvedValueOnce({
      name: 'Empty',
      timeZone: 'UTC',
      layers: [],
      overrides: [],
    } as never);

    await expect(
      resolveEscalationTargetDetailed({ targetType: 'SCHEDULE', targetId: 'sch-1', at: AT })
    ).resolves.toEqual({ outcome: 'NO_ELIGIBLE_RESPONDERS', targetName: 'Empty' });
  });

  it('never falls back to the whole roster when coverage is a gap', async () => {
    const schedule = scheduleWithOverride();
    // A layer that has not started yet, and an override outside the instant.
    schedule.layers[0].start = new Date('2027-01-01T00:00:00.000Z');
    schedule.overrides[0].start = new Date('2026-01-20T00:00:00.000Z');
    schedule.overrides[0].end = new Date('2026-01-21T00:00:00.000Z');
    vi.mocked(prisma.onCallSchedule.findUnique).mockResolvedValueOnce(schedule as never);

    const resolution = await resolveEscalationTargetDetailed({
      targetType: 'SCHEDULE',
      targetId: 'sch-1',
      at: AT,
    });

    expect(resolution.outcome).toBe('NO_ELIGIBLE_RESPONDERS');
  });

  it('excludes inactive roster members from layer coverage', async () => {
    const schedule = scheduleWithOverride();
    schedule.overrides = [];
    schedule.layers[0].users[0].user.status = 'DISABLED';
    vi.mocked(prisma.onCallSchedule.findUnique).mockResolvedValueOnce(schedule as never);

    const resolution = await resolveEscalationTargetDetailed({
      targetType: 'SCHEDULE',
      targetId: 'sch-1',
      at: AT,
    });

    expect(resolution.outcome).toBe('NO_ELIGIBLE_RESPONDERS');
  });

  it('rejects a deleted schedule as an unusable target', async () => {
    vi.mocked(prisma.onCallSchedule.findUnique).mockResolvedValueOnce(null as never);

    const resolution = await resolveEscalationTargetDetailed({
      targetType: 'SCHEDULE',
      targetId: 'gone',
      at: AT,
    });

    expect(resolution.outcome).toBe('INVALID_TARGET');
  });

  it('throws a retryable infrastructure error on a database failure', async () => {
    vi.mocked(prisma.onCallSchedule.findUnique).mockRejectedValueOnce(
      new Error('could not serialize access')
    );

    await expect(
      resolveEscalationTargetDetailed({ targetType: 'SCHEDULE', targetId: 'sch-1', at: AT })
    ).rejects.toBeInstanceOf(EscalationInfrastructureError);
  });
});

describe('unsupported targets', () => {
  it('rejects an unknown target type', async () => {
    const resolution = await resolveEscalationTargetDetailed({
      targetType: 'WEBHOOK' as never,
      targetId: 'x',
    });

    expect(resolution.outcome).toBe('INVALID_TARGET');
  });
});
