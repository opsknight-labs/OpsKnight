'use server';

import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { assertResponderOrAbove, getCurrentUser } from '@/lib/rbac';
import { getUserTimeZone, formatDateTime } from '@/lib/timezone';
import { logger } from '@/lib/logger';
import {
  executeIncidentLifecycleBatch,
  executeIncidentLifecycleTargetBatch,
  type IncidentLifecycleCommand,
  type IncidentLifecycleResult,
} from '@/lib/incidents/lifecycle';
import { enqueueIncidentUpdateSideEffects } from '@/lib/event-outbox';

type BulkLifecycleStatus = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' | 'SNOOZED' | 'SUPPRESSED';

function changedIncidentIds(results: readonly IncidentLifecycleResult[]): string[] {
  return results.filter(result => result.changed).map(result => result.incidentId);
}

type BulkLifecycleActor = { id: string; name?: string };

async function runBulkLifecycleCommand(
  incidentIds: string[],
  command: IncidentLifecycleCommand,
  actor: BulkLifecycleActor,
  eventMessage: string,
  extra: Partial<{
    snoozedUntil: Date;
    snoozeReason: string | null;
  }> = {}
): Promise<string[]> {
  const results = await executeIncidentLifecycleBatch(
    incidentIds.map(incidentId => ({
      incidentId,
      command,
      source: 'BULK' as const,
      actor,
      eventMessage,
      ...extra,
    }))
  );
  return changedIncidentIds(results);
}

async function runBulkLifecycleTarget(
  incidentIds: string[],
  status: BulkLifecycleStatus,
  actor: BulkLifecycleActor,
  eventMessage: string
): Promise<string[]> {
  const results = await executeIncidentLifecycleTargetBatch(
    incidentIds.map(incidentId => ({
      incidentId,
      status,
      source: 'BULK' as const,
      actor,
      eventMessage,
    }))
  );
  return changedIncidentIds(results);
}

export async function bulkAcknowledge(incidentIds: string[]) {
  if (!incidentIds || incidentIds.length === 0) {
    return { success: false, error: 'No incidents selected' };
  }

  try {
    await assertResponderOrAbove();
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unauthorized' };
  }

  try {
    const user = await getCurrentUser();
    const changedIds = await runBulkLifecycleCommand(
      incidentIds,
      'ACKNOWLEDGE',
      { id: user.id, name: user.name ?? undefined },
      `Bulk acknowledged${user ? ` by ${user.name}` : ''}`
    );

    // Notifications, status-page delivery and webhooks are durable lifecycle
    // outbox jobs committed with the batch transaction.
    revalidatePath('/incidents');
    revalidatePath('/');
    return { success: true, count: changedIds.length };
  } catch (error) {
    logger.error('Bulk acknowledge failed', { component: 'bulk-actions', error, incidentIds });
    return { success: false, error: 'Failed to acknowledge incidents' };
  }
}

export async function bulkResolve(incidentIds: string[]) {
  if (!incidentIds || incidentIds.length === 0) {
    return { success: false, error: 'No incidents selected' };
  }

  try {
    await assertResponderOrAbove();
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unauthorized' };
  }

  try {
    const user = await getCurrentUser();
    const changedIds = await runBulkLifecycleCommand(
      incidentIds,
      'RESOLVE',
      { id: user.id, name: user.name ?? undefined },
      `Bulk resolved${user ? ` by ${user.name}` : ''}`
    );

    revalidatePath('/incidents');
    revalidatePath('/');
    return { success: true, count: changedIds.length };
  } catch (error) {
    logger.error('Bulk resolve failed', { component: 'bulk-actions', error, incidentIds });
    return { success: false, error: 'Failed to resolve incidents' };
  }
}

export async function bulkReassign(incidentIds: string[], assigneeId: string) {
  if (!incidentIds || incidentIds.length === 0) {
    return { success: false, error: 'No incidents selected' };
  }

  if (!assigneeId) {
    return { success: false, error: 'Assignee is required' };
  }

  try {
    await assertResponderOrAbove();
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unauthorized' };
  }

  try {
    const assignee = await prisma.user.findUnique({ where: { id: assigneeId } });
    if (!assignee) {
      return { success: false, error: 'Assignee not found' };
    }

    const user = await getCurrentUser();
    await prisma.$transaction(async tx => {
      await tx.incident.updateMany({
        where: { id: { in: incidentIds } },
        data: { assigneeId, teamId: null },
      });
      await tx.incidentEvent.createMany({
        data: incidentIds.map(incidentId => ({
          incidentId,
          message: `Bulk reassigned to ${assignee.name}${user ? ` by ${user.name}` : ''}`,
        })),
      });
      await Promise.all(
        incidentIds.map(incidentId =>
          enqueueIncidentUpdateSideEffects(tx, incidentId, [
            'INCIDENT_ASSIGNED_TO_USER_NOTIFICATION',
            'INCIDENT_UPDATE_WEBHOOK',
          ])
        )
      );
    });

    revalidatePath('/incidents');
    return { success: true, count: incidentIds.length };
  } catch (error) {
    logger.error('Bulk reassign failed', {
      component: 'bulk-actions',
      error,
      incidentIds,
      assigneeId,
    });
    return { success: false, error: 'Failed to reassign incidents' };
  }
}

export async function bulkUpdatePriority(incidentIds: string[], priority: string) {
  if (!incidentIds || incidentIds.length === 0) {
    return { success: false, error: 'No incidents selected' };
  }

  try {
    await assertResponderOrAbove();
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unauthorized' };
  }

  try {
    const user = await getCurrentUser();
    await prisma.$transaction(async tx => {
      await tx.incident.updateMany({
        where: { id: { in: incidentIds } },
        data: { priority: priority || null },
      });
      await tx.incidentEvent.createMany({
        data: incidentIds.map(incidentId => ({
          incidentId,
          message: `Bulk priority updated to ${priority || 'Auto'}${user ? ` by ${user.name}` : ''}`,
        })),
      });
    });

    revalidatePath('/incidents');
    return { success: true, count: incidentIds.length };
  } catch (error) {
    logger.error('Bulk priority update failed', {
      component: 'bulk-actions',
      error,
      incidentIds,
      priority,
    });
    return { success: false, error: 'Failed to update priority' };
  }
}

export async function bulkSnooze(
  incidentIds: string[],
  durationMinutes: number,
  reason: string | null
) {
  if (!incidentIds || incidentIds.length === 0) {
    return { success: false, error: 'No incidents selected' };
  }

  try {
    await assertResponderOrAbove();
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unauthorized' };
  }

  try {
    const user = await getCurrentUser();
    const snoozedUntil = new Date(Date.now() + durationMinutes * 60 * 1000);
    const userTimeZone = getUserTimeZone(user ?? undefined);
    const changedIds = await runBulkLifecycleCommand(
      incidentIds,
      'SNOOZE',
      { id: user.id, name: user.name ?? undefined },
      `Bulk snoozed until ${formatDateTime(snoozedUntil, userTimeZone, { format: 'datetime' })}${reason ? `: ${reason}` : ''}${user ? ` by ${user.name}` : ''}`,
      { snoozedUntil, snoozeReason: reason }
    );

    revalidatePath('/incidents');
    return { success: true, count: changedIds.length };
  } catch (error) {
    logger.error('Bulk snooze failed', {
      component: 'bulk-actions',
      error,
      incidentIds,
      durationMinutes,
    });
    return { success: false, error: 'Failed to snooze incidents' };
  }
}

export async function bulkUnsnooze(incidentIds: string[]) {
  if (!incidentIds || incidentIds.length === 0) {
    return { success: false, error: 'No incidents selected' };
  }

  try {
    await assertResponderOrAbove();
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unauthorized' };
  }

  try {
    const user = await getCurrentUser();
    const changedIds = await runBulkLifecycleCommand(
      incidentIds,
      'UNSNOOZE',
      { id: user.id, name: user.name ?? undefined },
      `Bulk unsnoozed${user ? ` by ${user.name}` : ''}`
    );

    revalidatePath('/incidents');
    return { success: true, count: changedIds.length };
  } catch (error) {
    logger.error('Bulk unsnooze failed', { component: 'bulk-actions', error, incidentIds });
    return { success: false, error: 'Failed to unsnooze incidents' };
  }
}

export async function bulkSuppress(incidentIds: string[]) {
  if (!incidentIds || incidentIds.length === 0) {
    return { success: false, error: 'No incidents selected' };
  }

  try {
    await assertResponderOrAbove();
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unauthorized' };
  }

  try {
    const user = await getCurrentUser();
    const changedIds = await runBulkLifecycleCommand(
      incidentIds,
      'SUPPRESS',
      { id: user.id, name: user.name ?? undefined },
      `Bulk suppressed${user ? ` by ${user.name}` : ''}`
    );

    revalidatePath('/incidents');
    return { success: true, count: changedIds.length };
  } catch (error) {
    logger.error('Bulk suppress failed', { component: 'bulk-actions', error, incidentIds });
    return { success: false, error: 'Failed to suppress incidents' };
  }
}

export async function bulkUnsuppress(incidentIds: string[]) {
  if (!incidentIds || incidentIds.length === 0) {
    return { success: false, error: 'No incidents selected' };
  }

  try {
    await assertResponderOrAbove();
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unauthorized' };
  }

  try {
    const user = await getCurrentUser();
    const changedIds = await runBulkLifecycleCommand(
      incidentIds,
      'UNSUPPRESS',
      { id: user.id, name: user.name ?? undefined },
      `Bulk unsuppressed${user ? ` by ${user.name}` : ''}`
    );

    revalidatePath('/incidents');
    return { success: true, count: changedIds.length };
  } catch (error) {
    logger.error('Bulk unsuppress failed', { component: 'bulk-actions', error, incidentIds });
    return { success: false, error: 'Failed to unsuppress incidents' };
  }
}

export async function bulkUpdateUrgency(incidentIds: string[], urgency: 'HIGH' | 'MEDIUM' | 'LOW') {
  if (!incidentIds || incidentIds.length === 0) {
    return { success: false, error: 'No incidents selected' };
  }

  try {
    await assertResponderOrAbove();
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unauthorized' };
  }

  try {
    const user = await getCurrentUser();
    const updatedCount = await prisma.$transaction(async tx => {
      const updated = await tx.incident.updateMany({
        where: { id: { in: incidentIds } },
        data: { urgency },
      });
      await tx.incidentEvent.createMany({
        data: incidentIds.map(incidentId => ({
          incidentId,
          message: `Bulk urgency updated to ${urgency}${user ? ` by ${user.name}` : ''}`,
        })),
      });
      return updated.count;
    });

    revalidatePath('/incidents');
    return { success: true, count: updatedCount };
  } catch (error) {
    logger.error('Bulk urgency update failed', {
      component: 'bulk-actions',
      error,
      incidentIds,
      urgency,
    });
    return { success: false, error: 'Failed to update urgency' };
  }
}

export async function bulkUpdateStatus(incidentIds: string[], status: BulkLifecycleStatus) {
  if (!incidentIds || incidentIds.length === 0) {
    return { success: false, error: 'No incidents selected' };
  }

  try {
    await assertResponderOrAbove();
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unauthorized' };
  }

  try {
    const user = await getCurrentUser();
    const changedIds = await runBulkLifecycleTarget(
      incidentIds,
      status,
      { id: user.id, name: user.name ?? undefined },
      `Bulk status updated to ${status}${user ? ` by ${user.name}` : ''}`
    );

    revalidatePath('/incidents');
    return { success: true, count: changedIds.length };
  } catch (error) {
    logger.error('Bulk status update failed', {
      component: 'bulk-actions',
      error,
      incidentIds,
      status,
    });
    return { success: false, error: 'Failed to update status' };
  }
}
