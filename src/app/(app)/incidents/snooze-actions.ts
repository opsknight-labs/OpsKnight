'use server';

import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { assertResponderOrAbove, getCurrentUser } from '@/lib/rbac';
import { getUserTimeZone, formatDateTime } from '@/lib/timezone';
import { logger } from '@/lib/logger';
import { processAutoUnsnoozeInternal } from '@/lib/unsnooze';

export async function snoozeIncidentWithDuration(
  incidentId: string,
  durationMinutes: number,
  reason?: string
) {
  try {
    await assertResponderOrAbove();
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Unauthorized');
  }

  const incident = await prisma.incident.findUnique({
    where: { id: incidentId },
    select: { status: true },
  });

  if (!incident) {
    throw new Error('Incident not found');
  }

  if (incident.status === 'RESOLVED') {
    throw new Error('Cannot snooze an already resolved incident');
  }

  const snoozedUntil = new Date(Date.now() + durationMinutes * 60 * 1000);
  const user = await getCurrentUser();
  const userTimeZone = getUserTimeZone(user ?? undefined);

  try {
    await prisma.incident.update({
      where: { id: incidentId },
      data: {
        status: 'SNOOZED',
        snoozedUntil,
        snoozeReason: reason || null,
        escalationStatus: 'PAUSED',
        nextEscalationAt: null,
        events: {
          create: {
            type: 'STATUS_CHANGE',
            message: `Incident snoozed until ${formatDateTime(snoozedUntil, userTimeZone, { format: 'datetime' })}${reason ? ` (Reason: ${reason})` : ''}${user ? ` by ${user.name}` : ''}`,
          },
        },
      },
    });

    // Schedule auto-unsnooze job using PostgreSQL job queue
    try {
      const { scheduleAutoUnsnooze } = await import('@/lib/jobs/queue');
      await scheduleAutoUnsnooze(incidentId, snoozedUntil);
    } catch (error) {
      logger.error('Failed to schedule auto-unsnooze job', {
        component: 'snooze-actions',
        error,
        incidentId,
      });
      // Continue anyway - internal worker will pick it up via snoozedUntil field
    }

    revalidatePath(`/incidents/${incidentId}`);
    revalidatePath('/incidents');
    revalidatePath('/');
  } catch (error) {
    logger.error('Failed to snooze incident', {
      component: 'snooze-actions',
      error,
      incidentId,
      userId: user?.id,
    });
    throw new Error('Failed to snooze incident. Please try again.');
  }
}

export async function processAutoUnsnooze() {
  try {
    await assertResponderOrAbove();
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Unauthorized');
  }

  return processAutoUnsnoozeInternal();
}
