import prisma from '@/lib/prisma';
import { logger } from './logger';
import { getActiveOnCallShifts } from './oncall-shifts';
import { createInAppNotifications } from './in-app-notifications';
import { activeIncidentStatuses } from './incident-status';
import { getBaseUrl } from './env-validation';
import { generateShiftReminderEmailHTML, generateShiftHandoffEmailHTML } from './email';
import { enqueueCentralNotification } from './notification-control-plane';

export interface ShiftHandoffResult {
  remindersSent: number;
  rotationsProcessed: number;
  incidentsReassigned: number;
}

function shiftsBySchedule(shifts: Awaited<ReturnType<typeof getActiveOnCallShifts>>) {
  const grouped = new Map<string, typeof shifts>();
  for (const shift of shifts) {
    const existing = grouped.get(shift.scheduleId) ?? [];
    existing.push(shift);
    grouped.set(shift.scheduleId, existing);
  }
  return grouped;
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

    const currentBySchedule = shiftsBySchedule(currentShifts);

    for (const shift of upcomingShifts) {
      const currentUserIds = new Set(
        (currentBySchedule.get(shift.scheduleId) ?? []).map(current => current.userId)
      );
      // Only remind if the responder is taking over or shift is starting
      if (!currentUserIds.has(shift.userId)) {
        const minutesUntilStart = Math.max(
          1,
          Math.round((shift.start.getTime() - now.getTime()) / 60000)
        );

        // Deduplicate in-app notification within the last 45 minutes
        const recentNotification =
          typeof prisma.inAppNotification?.findFirst === 'function'
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
          // Send Shift Reminder Email if user has an email
          if (shift.user.email) {
            try {
              const baseUrl = getBaseUrl();
              const scheduleUrl = `${baseUrl}/schedules/${shift.scheduleId}`;
              const subject = `⏰ [Upcoming Shift] You are on-call for "${shift.schedule.name}" in ~${minutesUntilStart}m`;
              const html = generateShiftReminderEmailHTML({
                userName: shift.user.name || 'Team Member',
                scheduleName: shift.schedule.name,
                scheduleUrl,
                shiftStart: shift.start,
                shiftEnd: shift.end,
                timeZone: shift.user.timeZone || 'UTC',
                minutesUntilStart,
              });
              const text = `Upcoming On-Call Shift: You are scheduled to go on-call for "${shift.schedule.name}" in approximately ${minutesUntilStart} minutes.\n\nSchedule: ${scheduleUrl}`;

              await enqueueCentralNotification(
                {
                  category: 'SYSTEM',
                  channel: 'EMAIL',
                  recipientType: 'USER',
                  recipientId: shift.userId,
                  recipientAddress: shift.user.email,
                  userId: shift.userId,
                  templateKey: 'oncall-shift-reminder',
                  sourceType: 'ON_CALL_SCHEDULE',
                  sourceId: shift.scheduleId,
                  eventKey: `${shift.scheduleId}-${shift.userId}-${shift.start.getTime()}`,
                  displayMessage: `Upcoming shift reminder for ${shift.schedule.name}`,
                  priority: 2,
                  payload: {
                    kind: 'EMAIL',
                    to: shift.user.email,
                    subject,
                    html,
                    text,
                  },
                },
                { dispatchImmediately: true }
              );
            } catch (emailErr) {
              logger.warn('[OnCall Handoff] Failed to send shift reminder email', {
                error: emailErr,
                userId: shift.userId,
                scheduleId: shift.scheduleId,
              });
            }
          }

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

    const pastBySchedule = shiftsBySchedule(pastShifts);
    const currentBySchedule = shiftsBySchedule(currentShifts);

    for (const [scheduleId, scheduleCurrentShifts] of currentBySchedule) {
      const schedulePastShifts = pastBySchedule.get(scheduleId) ?? [];
      const pastUserIds = new Set(schedulePastShifts.map(shift => shift.userId));
      const currentUserIds = new Set(scheduleCurrentShifts.map(shift => shift.userId));
      const outgoingUserIds = new Set(
        [...pastUserIds].filter(userId => !currentUserIds.has(userId))
      );
      const incomingShifts = scheduleCurrentShifts.filter(shift => !pastUserIds.has(shift.userId));
      const incomingShift = incomingShifts[0];

      if (outgoingUserIds.size > 0 && incomingShift) {
        result.rotationsProcessed++;
        logger.info('[OnCall Handoff] Shift rotation detected', {
          scheduleId,
          scheduleName: incomingShift.schedule.name,
          outgoingUserIds: [...outgoingUserIds],
          incomingUserIds: incomingShifts.map(shift => shift.userId),
        });

        // Find services linked to this schedule through escalation policies
        const policies = await prisma.escalationPolicy.findMany({
          where: {
            steps: {
              some: {
                targetType: 'SCHEDULE',
                targetScheduleId: scheduleId,
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
          // Find active (triggered or acknowledged) incidents on these services
          const activeIncidents = await prisma.incident.findMany({
            where: {
              serviceId: { in: serviceIds },
              status: { in: activeIncidentStatuses() },
            },
            select: { id: true, title: true, status: true, assigneeId: true },
          });

          // Only hand off incidents owned by responders who actually left this schedule.
          const incidentsToReassign = activeIncidents.filter(
            incident => incident.assigneeId && outgoingUserIds.has(incident.assigneeId)
          );

          for (const incident of incidentsToReassign) {
            // Reassign to incoming responder
            await prisma.incident.update({
              where: { id: incident.id },
              data: { assigneeId: incomingShift.userId },
            });

            if (typeof prisma.incidentEvent?.create === 'function') {
              await prisma.incidentEvent.create({
                data: {
                  incidentId: incident.id,
                  type: 'ASSIGNMENT',
                  message: `Shift rotation handoff: auto-reassigned to incoming responder (${incomingShift.user.name || incomingShift.userId}) for schedule "${incomingShift.schedule.name}".`,
                },
              });
            }
            result.incidentsReassigned++;
          }

          // Send handoff summary digest to incoming responder only if incidents were reassigned
          if (incidentsToReassign.length > 0) {
            await createInAppNotifications({
              userIds: [incomingShift.userId],
              type: 'INCIDENT',
              title: 'Shift Handoff: Active Incidents',
              message: `You took over on-call for "${incomingShift.schedule.name}" with ${incidentsToReassign.length} active incident(s).`,
              entityType: 'SCHEDULE',
              entityId: scheduleId,
            });

            // Send Shift Handoff Summary Email to incoming responder
            if (incomingShift.user.email) {
              try {
                const baseUrl = getBaseUrl();
                const scheduleUrl = `${baseUrl}/schedules/${scheduleId}`;
                const subject = `🔄 [Shift Handoff] You are now On-Call for "${incomingShift.schedule.name}" (${incidentsToReassign.length} active incidents)`;
                const html = generateShiftHandoffEmailHTML({
                  userName: incomingShift.user.name || 'Team Member',
                  scheduleName: incomingShift.schedule.name,
                  scheduleUrl,
                  activeIncidents: incidentsToReassign.map(inc => ({
                    id: inc.id,
                    title: inc.title,
                    status: inc.status,
                    incidentUrl: `${baseUrl}/incidents/${inc.id}`,
                  })),
                  timeZone: incomingShift.user.timeZone || 'UTC',
                });
                const text = `Shift Handoff: You are now on-call for "${incomingShift.schedule.name}" with ${incidentsToReassign.length} active incident(s).\n\nSchedule: ${scheduleUrl}`;

                await enqueueCentralNotification(
                  {
                    category: 'SYSTEM',
                    channel: 'EMAIL',
                    recipientType: 'USER',
                    recipientId: incomingShift.userId,
                    recipientAddress: incomingShift.user.email,
                    userId: incomingShift.userId,
                    templateKey: 'oncall-shift-handoff',
                    sourceType: 'ON_CALL_SCHEDULE',
                    sourceId: scheduleId,
                    eventKey: `${scheduleId}-${incomingShift.userId}-${incomingShift.start.getTime()}-handoff`,
                    displayMessage: `Shift handoff digest for ${incomingShift.schedule.name}`,
                    priority: 2,
                    payload: {
                      kind: 'EMAIL',
                      to: incomingShift.user.email,
                      subject,
                      html,
                      text,
                    },
                  },
                  { dispatchImmediately: true }
                );
              } catch (emailErr) {
                logger.warn('[OnCall Handoff] Failed to send shift handoff email', {
                  error: emailErr,
                  userId: incomingShift.userId,
                  scheduleId,
                });
              }
            }
          }
        }
      }
    }
  } catch (error) {
    logger.error('[OnCall Handoff] Error processing shift rotations', { error });
  }

  return result;
}
