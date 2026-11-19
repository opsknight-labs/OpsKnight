import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processShiftRotations } from '@/lib/oncall-handoff';
import type { DynamicOnCallShift } from '@/lib/oncall-shifts';

// Mock prisma
vi.mock('@/lib/prisma', () => ({
  default: {
    escalationPolicy: {
      findMany: vi.fn(),
    },
    incident: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    incidentEvent: {
      create: vi.fn(),
    },
    inAppNotification: {
      findFirst: vi.fn(),
      createMany: vi.fn(),
    },
  },
}));

// Mock oncall-shifts
vi.mock('@/lib/oncall-shifts', () => ({
  getActiveOnCallShifts: vi.fn(),
}));

// Mock logger
vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock in-app-notifications
vi.mock('@/lib/in-app-notifications', () => ({
  createInAppNotifications: vi.fn().mockResolvedValue([]),
}));

describe('oncall-handoff', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { default: prisma } = await import('@/lib/prisma');
    vi.mocked(prisma.incident.updateMany).mockResolvedValue({ count: 1 });
  });

  describe('processShiftRotations', () => {
    it('reassigns active incidents when shift rotates and incident is assigned to outgoing user', async () => {
      const { default: prisma } = await import('@/lib/prisma');
      const { getActiveOnCallShifts } = await import('@/lib/oncall-shifts');

      const now = new Date('2026-08-26T06:31:00Z');

      // Past shift (5m ago) was User A, current shift is User B
      vi.mocked(getActiveOnCallShifts).mockImplementation(async (time: Date = new Date()) => {
        if (time.getTime() < now.getTime()) {
          return [
            {
              id: 'shift-1',
              scheduleId: 'sched-1',
              userId: 'user-a',
              schedule: { id: 'sched-1', name: 'Devops Schedule' },
              user: { id: 'user-a', name: 'User A' },
              start: new Date(now.getTime() - 60 * 60 * 1000),
              end: now,
            } as unknown as DynamicOnCallShift,
          ];
        }
        return [
          {
            id: 'shift-2',
            scheduleId: 'sched-1',
            userId: 'user-b',
            schedule: { id: 'sched-1', name: 'Devops Schedule' },
            user: { id: 'user-b', name: 'User B' },
            start: now,
            end: new Date(now.getTime() + 60 * 60 * 1000),
          } as unknown as DynamicOnCallShift,
        ];
      });

      vi.mocked(prisma.escalationPolicy.findMany).mockResolvedValue([
        { id: 'ep-1', services: [{ id: 'svc-1' }] },
      ] as unknown as Awaited<ReturnType<typeof prisma.escalationPolicy.findMany>>);

      vi.mocked(prisma.incident.findMany).mockResolvedValue([
        { id: 'inc-1', title: 'Open issue', status: 'OPEN', assigneeId: 'user-a' },
      ] as unknown as Awaited<ReturnType<typeof prisma.incident.findMany>>);

      const result = await processShiftRotations(now);

      expect(result.rotationsProcessed).toBe(1);
      expect(result.incidentsReassigned).toBe(1);
      expect(prisma.incident.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { serviceId: { in: ['svc-1'] }, status: 'OPEN' },
        })
      );
      expect(prisma.incident.updateMany).toHaveBeenCalledWith({
        where: { id: 'inc-1', status: 'OPEN', assigneeId: 'user-a' },
        data: { assigneeId: 'user-b' },
      });
      expect(prisma.incidentEvent.create).toHaveBeenCalledTimes(1);
    });

    it('does NOT create duplicate reassignment or timeline events if incident is already assigned to incoming responder', async () => {
      const { default: prisma } = await import('@/lib/prisma');
      const { getActiveOnCallShifts } = await import('@/lib/oncall-shifts');

      const now = new Date('2026-08-26T06:33:00Z');

      // Cron running 2 minutes later: shift rotation lookback still sees transition, but incident is already User B
      vi.mocked(getActiveOnCallShifts).mockImplementation(async (time: Date = new Date()) => {
        if (time.getTime() < now.getTime()) {
          return [
            {
              id: 'shift-1',
              scheduleId: 'sched-1',
              userId: 'user-a',
              schedule: { id: 'sched-1', name: 'Devops Schedule' },
              user: { id: 'user-a', name: 'User A' },
              start: new Date(now.getTime() - 60 * 60 * 1000),
              end: new Date(now.getTime() - 2 * 60 * 1000),
            } as unknown as DynamicOnCallShift,
          ];
        }
        return [
          {
            id: 'shift-2',
            scheduleId: 'sched-1',
            userId: 'user-b',
            schedule: { id: 'sched-1', name: 'Devops Schedule' },
            user: { id: 'user-b', name: 'User B' },
            start: new Date(now.getTime() - 2 * 60 * 1000),
            end: new Date(now.getTime() + 60 * 60 * 1000),
          } as unknown as DynamicOnCallShift,
        ];
      });

      vi.mocked(prisma.escalationPolicy.findMany).mockResolvedValue([
        { id: 'ep-1', services: [{ id: 'svc-1' }] },
      ] as unknown as Awaited<ReturnType<typeof prisma.escalationPolicy.findMany>>);

      // Incident is already assigned to user-b
      vi.mocked(prisma.incident.findMany).mockResolvedValue([
        { id: 'inc-1', title: 'Open issue', status: 'OPEN', assigneeId: 'user-b' },
      ] as unknown as Awaited<ReturnType<typeof prisma.incident.findMany>>);

      const result = await processShiftRotations(now);

      expect(result.rotationsProcessed).toBe(1);
      expect(result.incidentsReassigned).toBe(0);
      expect(prisma.incident.updateMany).not.toHaveBeenCalled();
      expect(prisma.incidentEvent.create).not.toHaveBeenCalled();
    });

    it('keeps additive responders stable and only hands off incidents owned by an outgoing responder', async () => {
      const { default: prisma } = await import('@/lib/prisma');
      const { getActiveOnCallShifts } = await import('@/lib/oncall-shifts');
      const now = new Date('2026-08-26T06:31:00Z');
      const shift = (userId: string): DynamicOnCallShift => ({
        id: `shift-${userId}`,
        scheduleId: 'sched-1',
        userId,
        schedule: { id: 'sched-1', name: 'Devops Schedule' },
        user: { id: userId, name: userId },
        start: new Date(now.getTime() - 60 * 60 * 1000),
        end: new Date(now.getTime() + 60 * 60 * 1000),
      });

      vi.mocked(getActiveOnCallShifts).mockImplementation(async time =>
        (time ?? new Date()).getTime() < now.getTime()
          ? [shift('outgoing-primary'), shift('additive')]
          : [shift('incoming-primary'), shift('additive')]
      );
      vi.mocked(prisma.escalationPolicy.findMany).mockResolvedValue([
        { id: 'ep-1', services: [{ id: 'svc-1' }] },
      ] as unknown as Awaited<ReturnType<typeof prisma.escalationPolicy.findMany>>);
      vi.mocked(prisma.incident.findMany).mockResolvedValue([
        { id: 'inc-outgoing', title: 'Move me', status: 'OPEN', assigneeId: 'outgoing-primary' },
        { id: 'inc-additive', title: 'Keep me', status: 'OPEN', assigneeId: 'additive' },
      ] as unknown as Awaited<ReturnType<typeof prisma.incident.findMany>>);

      const result = await processShiftRotations(now);

      expect(result.rotationsProcessed).toBe(1);
      expect(result.incidentsReassigned).toBe(1);
      expect(prisma.incident.updateMany).toHaveBeenCalledTimes(1);
      expect(prisma.incident.updateMany).toHaveBeenCalledWith({
        where: { id: 'inc-outgoing', status: 'OPEN', assigneeId: 'outgoing-primary' },
        data: { assigneeId: 'incoming-primary' },
      });
    });

    it('skips an incident acknowledged or reassigned between the read and the write', async () => {
      const { default: prisma } = await import('@/lib/prisma');
      const { getActiveOnCallShifts } = await import('@/lib/oncall-shifts');
      const now = new Date('2026-08-26T06:31:00Z');
      const shift = (userId: string): DynamicOnCallShift => ({
        id: `shift-${userId}`,
        scheduleId: 'sched-1',
        userId,
        schedule: { id: 'sched-1', name: 'Devops Schedule' },
        user: { id: userId, name: userId },
        start: now,
        end: now,
      });
      vi.mocked(getActiveOnCallShifts).mockImplementation(async time =>
        (time ?? new Date()).getTime() < now.getTime() ? [shift('user-a')] : [shift('user-b')]
      );
      vi.mocked(prisma.escalationPolicy.findMany).mockResolvedValue([
        { id: 'ep-1', services: [{ id: 'svc-1' }] },
      ] as unknown as Awaited<ReturnType<typeof prisma.escalationPolicy.findMany>>);
      vi.mocked(prisma.incident.findMany).mockResolvedValue([
        { id: 'inc-1', title: 'Raced', status: 'OPEN', assigneeId: 'user-a' },
      ] as unknown as Awaited<ReturnType<typeof prisma.incident.findMany>>);
      vi.mocked(prisma.incident.updateMany).mockResolvedValue({ count: 0 });

      const result = await processShiftRotations(now);

      expect(result.incidentsReassigned).toBe(0);
      expect(prisma.incidentEvent.create).not.toHaveBeenCalled();
    });
  });
});
