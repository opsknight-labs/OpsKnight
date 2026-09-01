import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { executeEscalation } from '@/lib/escalation';
import prisma from '@/lib/prisma';
import { scheduleEscalation } from '@/lib/jobs/queue';

vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    incident: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    incidentEvent: {
      create: vi.fn(),
    },
  },
}));

vi.mock('@/lib/jobs/queue', () => ({
  scheduleEscalation: vi.fn().mockResolvedValue('job-1'),
}));

describe('executeEscalation delay handling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('schedules the initial escalation when the first step has a delay', async () => {
    vi.mocked(prisma.incident.findUnique).mockResolvedValueOnce({
      id: 'inc-1',
      currentEscalationStep: null,
      nextEscalationAt: null,
      escalationStatus: null,
      service: {
        policy: {
          steps: [
            {
              delayMinutes: 5,
              targetType: 'USER',
              targetUserId: 'user-1',
              targetUser: { name: 'User One' },
              targetTeamId: null,
              targetTeam: null,
              targetScheduleId: null,
              targetSchedule: null,
              notifyOnlyTeamLead: false,
              notificationChannels: [],
            },
          ],
        },
      },
    } as any);

    const result = await executeEscalation('inc-1');

    expect(result).toEqual({
      outcome: 'STEP_SCHEDULED',
      escalated: false,
      reason: 'Escalation scheduled',
    });
    expect(prisma.incident.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'inc-1' },
        data: expect.objectContaining({
          escalationStatus: 'ESCALATING',
          currentEscalationStep: 0,
          nextEscalationAt: new Date('2026-01-01T00:05:00.000Z'),
          escalationProcessingAt: null,
        }),
      })
    );
    expect(prisma.incidentEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          incidentId: 'inc-1',
        }),
      })
    );
    expect(scheduleEscalation).toHaveBeenCalledWith('inc-1', 0, 5 * 60 * 1000);
  });

  it('does not reschedule when nextEscalationAt is already in the future', async () => {
    vi.mocked(prisma.incident.findUnique).mockResolvedValueOnce({
      id: 'inc-2',
      currentEscalationStep: 0,
      nextEscalationAt: new Date('2026-01-01T00:05:00.000Z'),
      escalationStatus: 'ESCALATING',
      service: {
        policy: {
          steps: [
            {
              delayMinutes: 5,
              targetType: 'USER',
              targetUserId: 'user-2',
              targetUser: { name: 'User Two' },
              targetTeamId: null,
              targetTeam: null,
              targetScheduleId: null,
              targetSchedule: null,
              notifyOnlyTeamLead: false,
              notificationChannels: [],
            },
          ],
        },
      },
    } as any);

    const result = await executeEscalation('inc-2');

    expect(result).toEqual({
      outcome: 'STEP_SCHEDULED',
      escalated: false,
      reason: 'Escalation scheduled',
    });
    expect(prisma.incident.update).not.toHaveBeenCalled();
    expect(prisma.incidentEvent.create).not.toHaveBeenCalled();
    expect(scheduleEscalation).not.toHaveBeenCalled();
  });
});
