'use server';

import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { assertResponderOrAbove, getCurrentAuthorizationActor, getCurrentUser } from '@/lib/rbac';
import { incidentReadWhere } from '@/lib/authorization-filters';
import { getUserTimeZone, formatDateTime } from '@/lib/timezone';
import { logger } from '@/lib/logger';
import { isAppError } from '@/lib/errors';
import { reconcileIncidentEngagementAfterUrgencyChange } from '@/lib/incidents/engagement-reconciliation';
import { runSerializableTransaction } from '@/lib/db-utils';
import { assignIncidentDomainCommand } from '@/lib/incidents/assignment';
import { AuthorizationError, CAPABILITIES, isPageableRole } from '@/lib/authorization';
import {
  executeIncidentLifecycleBatch,
  executeIncidentLifecycleTargetBatch,
  type IncidentLifecycleCommand,
  type IncidentLifecycleResult,
} from '@/lib/incidents/lifecycle';
import { isIncidentPriority } from '@/lib/incidents/priority';
import { applyIncidentPriorityChange } from '@/lib/incidents/priority-command';
import { requireResolutionNote } from '@/lib/incidents/resolution-note';

const MAX_BULK_SELECTION = 100;

type BulkLifecycleStatus = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' | 'SNOOZED' | 'SUPPRESSED';

function changedIncidentIds(results: readonly IncidentLifecycleResult[]): string[] {
  return results.filter(result => result.changed).map(result => result.incidentId);
}

type BulkLifecycleActor = { id: string; name?: string };

// The batch is one transaction, so a refused incident rolls back the whole selection.
// Say why (and that nothing changed) instead of a fixed string.
function bulkFailureMessage(error: unknown, fallback: string): string {
  if (isAppError(error) && error.exposure === 'public') {
    return `${error.userMessage} No incidents were changed.`;
  }
  return fallback;
}

/**
 * Operations.manage alone does not say which incidents a person may read (custom roles separate
 * the two), so a bulk selection is held to the same scope as the list it was made from.
 */
async function assertCanActOnIncidents(incidentIds: string[]): Promise<void> {
  await assertResponderOrAbove();
  const readable = incidentReadWhere(await getCurrentAuthorizationActor());
  if (Object.keys(readable).length === 0) return;
  const unique = [...new Set(incidentIds)];
  const visible = await prisma.incident.count({ where: { AND: [{ id: { in: unique } }, readable] } });
  if (visible !== unique.length) {
    throw new AuthorizationError(
      'Unauthorized. You cannot act on one or more of the selected incidents.',
      CAPABILITIES.INCIDENT_READ_SCOPED
    );
  }
}

async function runBulkLifecycleCommand(
  incidentIds: string[],
  command: IncidentLifecycleCommand,
  actor: BulkLifecycleActor,
  eventMessage: string,
  extra: Partial<{
    snoozedUntil: Date;
    snoozeReason: string | null;
    resolutionNote: string;
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
    await assertCanActOnIncidents(incidentIds);
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
    return { success: false, error: bulkFailureMessage(error, 'Failed to acknowledge incidents') };
  }
}

export async function bulkResolve(incidentIds: string[], resolution: string) {
  if (!incidentIds || incidentIds.length === 0) {
    return { success: false, error: 'No incidents selected' };
  }

  try {
    await assertCanActOnIncidents(incidentIds);
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unauthorized' };
  }

  // The same mandatory note the single-incident resolve requires.
  let resolutionNote: string;
  try {
    resolutionNote = requireResolutionNote(resolution);
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Invalid note' };
  }

  try {
    const user = await getCurrentUser();
    const changedIds = await runBulkLifecycleCommand(
      incidentIds,
      'RESOLVE',
      { id: user.id, name: user.name ?? undefined },
      `Bulk resolved${user ? ` by ${user.name}` : ''}`,
      { resolutionNote }
    );

    revalidatePath('/incidents');
    revalidatePath('/');
    return { success: true, count: changedIds.length };
  } catch (error) {
    logger.error('Bulk resolve failed', { component: 'bulk-actions', error, incidentIds });
    return { success: false, error: bulkFailureMessage(error, 'Failed to resolve incidents') };
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
    await assertCanActOnIncidents(incidentIds);
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unauthorized' };
  }

  try {
    const assignee = await prisma.user.findFirst({ where: { id: assigneeId, status: 'ACTIVE' } });
    if (!assignee) {
      return { success: false, error: 'Assignee not found' };
    }
    if (!isPageableRole(assignee.role)) {
      return { success: false, error: 'Stakeholders cannot be assigned to incidents.' };
    }

    const uniqueIds = [...new Set(incidentIds)];
    if (uniqueIds.length > MAX_BULK_SELECTION) {
      return {
        success: false,
        error: `Select at most ${MAX_BULK_SELECTION} incidents to reassign at once.`,
      };
    }

    const user = await getCurrentUser();
    // The same command as a single reassign: assignment event, notification, war room and
    // retries on write conflicts. Resolved incidents are closed work, so they are left alone.
    const reassigned = await runSerializableTransaction(async tx => {
      const open = await tx.incident.findMany({
        where: { id: { in: uniqueIds }, status: { not: 'RESOLVED' } },
        select: { id: true },
      });
      for (const { id } of open) {
        await assignIncidentDomainCommand(
          { incidentId: id, assigneeId, actor: { id: user.id, name: user.name ?? undefined } },
          tx
        );
      }
      return open.length;
    });

    revalidatePath('/incidents');
    return { success: true, count: reassigned };
  } catch (error) {
    logger.error('Bulk reassign failed', {
      component: 'bulk-actions',
      error,
      incidentIds,
      assigneeId,
    });
    return { success: false, error: bulkFailureMessage(error, 'Failed to reassign incidents') };
  }
}

export async function bulkUpdatePriority(incidentIds: string[], priority: string) {
  if (!incidentIds || incidentIds.length === 0) {
    return { success: false, error: 'No incidents selected' };
  }

  try {
    await assertCanActOnIncidents(incidentIds);
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unauthorized' };
  }

  // Escalation conditions match the exact P1-P5 strings; empty clears the priority ("Auto").
  if (priority && !isIncidentPriority(priority)) {
    return { success: false, error: 'Priority must be one of P1, P2, P3, P4 or P5' };
  }
  const nextPriority = isIncidentPriority(priority) ? priority : null;

  try {
    const uniqueIds = [...new Set(incidentIds)];
    if (uniqueIds.length > MAX_BULK_SELECTION) {
      return {
        success: false,
        error: `Select at most ${MAX_BULK_SELECTION} incidents to update at once.`,
      };
    }

    const user = await getCurrentUser();
    // Same command as the incident page control: P1-P5 or cleared, timeline event and war-room message.
    const updated = await prisma.$transaction(async tx => {
      const existing = await tx.incident.findMany({
        where: { id: { in: uniqueIds } },
        select: { id: true },
      });
      for (const { id } of existing) {
        await applyIncidentPriorityChange(tx, {
          incidentId: id,
          priority: nextPriority,
          eventMessage: `Bulk priority updated to ${nextPriority ?? 'Auto'}${user ? ` by ${user.name}` : ''}`,
        });
      }
      return existing.length;
    });

    revalidatePath('/incidents');
    return { success: true, count: updated };
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
    await assertCanActOnIncidents(incidentIds);
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
    return { success: false, error: bulkFailureMessage(error, 'Failed to snooze incidents') };
  }
}

export async function bulkUnsnooze(incidentIds: string[]) {
  if (!incidentIds || incidentIds.length === 0) {
    return { success: false, error: 'No incidents selected' };
  }

  try {
    await assertCanActOnIncidents(incidentIds);
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
    return { success: false, error: bulkFailureMessage(error, 'Failed to unsnooze incidents') };
  }
}

export async function bulkSuppress(incidentIds: string[]) {
  if (!incidentIds || incidentIds.length === 0) {
    return { success: false, error: 'No incidents selected' };
  }

  try {
    await assertCanActOnIncidents(incidentIds);
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
    return { success: false, error: bulkFailureMessage(error, 'Failed to suppress incidents') };
  }
}

export async function bulkUnsuppress(incidentIds: string[]) {
  if (!incidentIds || incidentIds.length === 0) {
    return { success: false, error: 'No incidents selected' };
  }

  try {
    await assertCanActOnIncidents(incidentIds);
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
    return { success: false, error: bulkFailureMessage(error, 'Failed to unsuppress incidents') };
  }
}

export async function bulkUpdateUrgency(incidentIds: string[], urgency: 'HIGH' | 'MEDIUM' | 'LOW') {
  if (!incidentIds || incidentIds.length === 0) {
    return { success: false, error: 'No incidents selected' };
  }

  try {
    await assertCanActOnIncidents(incidentIds);
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unauthorized' };
  }

  try {
    const user = await getCurrentUser();
    const updatedCount = await prisma.$transaction(async tx => {
      const current = await tx.incident.findMany({
        where: { id: { in: incidentIds } },
        select: { id: true, urgency: true },
      });
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
      for (const incident of current)
        await reconcileIncidentEngagementAfterUrgencyChange(tx, {
          incidentId: incident.id,
          previousUrgency: incident.urgency,
          urgency,
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
  if (status === 'RESOLVED') {
    return { success: false, error: 'Use Resolve to close incidents: it asks for a resolution note.' };
  }

  try {
    await assertCanActOnIncidents(incidentIds);
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
    return { success: false, error: bulkFailureMessage(error, 'Failed to update status') };
  }
}
