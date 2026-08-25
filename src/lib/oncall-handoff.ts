import prisma from '@/lib/prisma';
import { logger } from './logger';
import { getActiveOnCallShifts } from './oncall-shifts';
import { createInAppNotifications } from './in-app-notifications';

export interface ShiftHandoffResult {
  remindersSent: number;
  rotationsProcessed: number;
  incidentsReassigned: number;
}

/**
 * Dispatches advance reminders to incoming responders (e.g. 60m and 15m prior to shift start)
 */
export async function processUpcomingShiftReminders(
  now: Date = new Date(),
  lookaheadMinutes: number = 60
): Promise<number> {
  let remindersSent = 0;
  try {
    const futureTime = new Date(now.getTime() + lookaheadMinutes * 60 * 1000);
    const upcomingShifts = await getActiveOnCallShifts(futureTime);
    const currentShifts = await getActiveOnCallShifts(now);

    const currentOnCallMap = new Map<string, string>();
    for (const shift of currentShifts) {
      currentOnCallMap.set(shift.scheduleId, shift.userId);
    }

    for (const shift of upcomingShifts) {
      const currentUserId = currentOnCallMap.get(shift.scheduleId);
      // Only remind if the responder is taking over or shift is starting
      if (currentUserId !== shift.userId) {
        const minutesUntilStart = Math.max(1, Math.round((shift.start.getTime() - now.getTime()) / 60000));

        // Deduplicate in-app notification within the last 45 minutes
        const recentNotification = typeof prisma.inAppNotification?.findFirst === 'function'
          ? await prisma.inAppNotification.findFirst({
              where: {
                userId: shift.userId,
                type: 'SCHEDULE',
                entityId: shift.scheduleId,
                createdAt: { gte: new Date(now.getTime() - 45 * 60 * 1000) },
              },
            })
          : null;

        if (!recentNotification) {
          await createInAppNotifications({
            userIds: [shift.userId],
            type: 'SCHEDULE',
            title: 'Upcoming On-Call Shift',
            message: `You are scheduled to go on-call for "${shift.schedule.name}" in approximately ${minutesUntilStart} minute(s).`,
            entityType: 'SCHEDULE',
            entityId: shift.scheduleId,
          });
          remindersSent++;
        }
      }
    }
  } catch (error) {
    logger.error('[OnCall Handoff] Error processing upcoming shift reminders', { error });
  }
  return remindersSent;
}

/**
 * Detects completed shift rotations, re-assigns unacknowledged incidents, and logs timeline handoff events
 */
export async function processShiftRotations(now: Date = new Date()): Promise<ShiftHandoffResult> {
  const result: ShiftHandoffResult = {
    remindersSent: 0,
    rotationsProcessed: 0,
    incidentsReassigned: 0,
  };

  try {
    const pastTime = new Date(now.getTime() - 5 * 60 * 1000); // 5m lookback
    const pastShifts = await getActiveOnCallShifts(pastTime);
    const currentShifts = await getActiveOnCallShifts(now);

    const pastUserMap = new Map<string, string>();
    for (const shift of pastShifts) {
      pastUserMap.set(shift.scheduleId, shift.userId);
    }

    for (const currentShift of currentShifts) {
      const outgoingUserId = pastUserMap.get(currentShift.scheduleId);
      if (outgoingUserId && outgoingUserId !== currentShift.userId) {
        result.rotationsProcessed++;
        logger.info('[OnCall Handoff] Shift rotation detected', {
          scheduleId: currentShift.scheduleId,
          scheduleName: currentShift.schedule.name,
          outgoingUserId,
          incomingUserId: currentShift.userId,
        });

        // Find services linked to this schedule through escalation policies
        const policies = await prisma.escalationPolicy.findMany({
          where: {
            steps: {
              some: {
                targetType: 'SCHEDULE',
                targetScheduleId: currentShift.scheduleId,
              },
            },
          },
          select: {
            id: true,
            services: { select: { id: true } },
          },
        });

        const serviceIds = policies.flatMap(p => p.services.map(s => s.id));
        if (serviceIds.length > 0) {
          // Find active, unacknowledged or open incidents on these services
          const activeIncidents = await prisma.incident.findMany({
            where: {
              serviceId: { in: serviceIds },
              status: { in: ['OPEN', 'ACKNOWLEDGED'] },
            },
            select: { id: true, title: true, status: true, assigneeId: true },
          });

          for (const incident of activeIncidents) {
            // Reassign to incoming responder
            await prisma.incident.update({
              where: { id: incident.id },
              data: { assigneeId: currentShift.userId },
            });

            if (typeof prisma.incidentEvent?.create === 'function') {
              await prisma.incidentEvent.create({
                data: {
                  incidentId: incident.id,
                  type: 'ASSIGNMENT',
                  message: `Shift rotation handoff: auto-reassigned to incoming responder (${currentShift.user.name || currentShift.userId}) for schedule "${currentShift.schedule.name}".`,
                },
              });
            }
            result.incidentsReassigned++;
          }

          // Send handoff summary digest to incoming responder
          if (activeIncidents.length > 0) {
            await createInAppNotifications({
              userIds: [currentShift.userId],
              type: 'INCIDENT',
              title: 'Shift Handoff: Active Incidents',
              message: `You took over on-call for "${currentShift.schedule.name}" with ${activeIncidents.length} active incident(s).`,
              entityType: 'SCHEDULE',
              entityId: currentShift.scheduleId,
            });
          }
        }
      }
    }
  } catch (error) {
    logger.error('[OnCall Handoff] Error processing shift rotations', { error });
  }

  return result;
}
