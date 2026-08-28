'use server';

import { revalidatePath } from 'next/cache';
import { assertResponderOrAbove, getCurrentUser } from '@/lib/rbac';
import { getUserTimeZone, formatDateTime } from '@/lib/timezone';
import { logger } from '@/lib/logger';
import { processAutoUnsnoozeInternal } from '@/lib/unsnooze';
import { executeIncidentLifecycleCommand } from '@/lib/incidents/lifecycle';

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

  if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
    throw new Error('Snooze duration must be a positive number of minutes.');
  }

  const snoozedUntil = new Date(Date.now() + durationMinutes * 60 * 1000);
  const user = await getCurrentUser();
  const userTimeZone = getUserTimeZone(user ?? undefined);
  const normalizedReason = reason?.trim() || null;

  try {
    const result = await executeIncidentLifecycleCommand({
      incidentId,
      command: 'SNOOZE',
      source: 'WEB',
      actor: { id: user.id, name: user.name ?? undefined },
      snoozedUntil,
      snoozeReason: normalizedReason,
      eventMessage: `Incident snoozed until ${formatDateTime(snoozedUntil, userTimeZone, { format: 'datetime' })}${normalizedReason ? ` (Reason: ${normalizedReason})` : ''}${user ? ` by ${user.name}` : ''}`,
    });

    // Schedule only after a committed lifecycle change. PostgreSQL job delivery
    // remains best-effort because the cron sweep also observes snoozedUntil.
    if (result.changed) {
      try {
        const { scheduleAutoUnsnooze } = await import('@/lib/jobs/queue');
        await scheduleAutoUnsnooze(incidentId, snoozedUntil);
      } catch (error) {
        logger.error('Failed to schedule auto-unsnooze job', {
          component: 'snooze-actions',
          error,
          incidentId,
        });
      }
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
    throw error;
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
