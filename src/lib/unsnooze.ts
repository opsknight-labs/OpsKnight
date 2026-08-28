import 'server-only';

import prisma from '@/lib/prisma';
import { runSerializableTransaction } from '@/lib/db-utils';
import { logger } from '@/lib/logger';
import { applyIncidentLifecycleCommand } from '@/lib/incidents/lifecycle';

export type AutoUnsnoozeResult =
  | { outcome: 'changed' }
  | { outcome: 'not_due'; snoozedUntil: Date }
  | { outcome: 'noop' };

const AUTO_UNSNOOZE_EVENT_MESSAGE = 'Incident auto-unsnoozed (snooze duration expired)';

async function dispatchAutoUnsnoozeSideEffects(incidentId: string): Promise<void> {
  try {
    const updatedIncident = await prisma.incident.findUnique({
      where: { id: incidentId },
      include: {
        service: { select: { id: true, name: true } },
        assignee: {
          select: { id: true, name: true, email: true, avatarUrl: true, gender: true },
        },
      },
    });

    // A concurrent operator may have changed the incident again after the
    // lifecycle transaction committed. Do not emit stale OPEN side effects.
    if (!updatedIncident || updatedIncident.status !== 'OPEN') return;

    const { sendIncidentNotifications } = await import('@/lib/user-notifications');
    const { notifyStatusPageSubscribers } = await import('@/lib/status-page-notifications');
    const { triggerWebhooksForService } = await import('@/lib/status-page-webhooks');

    await Promise.all([
      sendIncidentNotifications(incidentId, 'updated'),
      notifyStatusPageSubscribers(incidentId, 'investigating'),
      triggerWebhooksForService(updatedIncident.serviceId, 'incident.updated', {
        id: updatedIncident.id,
        title: updatedIncident.title,
        description: updatedIncident.description,
        status: updatedIncident.status,
        urgency: updatedIncident.urgency,
        priority: updatedIncident.priority,
        service: updatedIncident.service,
        assignee: updatedIncident.assignee,
        createdAt: updatedIncident.createdAt.toISOString(),
        acknowledgedAt: updatedIncident.acknowledgedAt?.toISOString() || null,
        resolvedAt: updatedIncident.resolvedAt?.toISOString() || null,
      }),
    ]);
  } catch (error) {
    logger.error('Failed to notify after auto-unsnooze', {
      component: 'unsnooze',
      incidentId,
      error,
    });
  }
}

/**
 * Attempts one system-driven unsnooze.
 *
 * The expiry check and lifecycle transition intentionally run inside the same
 * serializable transaction. If an operator extends the snooze concurrently,
 * PostgreSQL forces the transaction to retry and the fresh deadline is
 * observed instead of reopening the incident from stale state.
 */
export async function attemptAutoUnsnoozeInternal(
  incidentId: string,
  now: Date = new Date()
): Promise<AutoUnsnoozeResult> {
  return runSerializableTransaction(async tx => {
    const current = await tx.incident.findUnique({
      where: { id: incidentId },
      select: { status: true, snoozedUntil: true },
    });

    if (!current || current.status !== 'SNOOZED' || !current.snoozedUntil) {
      return { outcome: 'noop' };
    }

    if (current.snoozedUntil.getTime() > now.getTime()) {
      return { outcome: 'not_due', snoozedUntil: current.snoozedUntil };
    }

    const result = await applyIncidentLifecycleCommand(tx, {
      incidentId,
      command: 'UNSNOOZE',
      source: 'SYSTEM',
      expectedStatus: 'SNOOZED',
      eventMessage: AUTO_UNSNOOZE_EVENT_MESSAGE,
      now,
    });

    return result.changed ? { outcome: 'changed' } : { outcome: 'noop' };
  });
}

/**
 * Worker-safe one-incident adapter. Side effects are emitted only after a real
 * lifecycle transition and never for idempotent retries or stale jobs.
 */
export async function processAutoUnsnoozeIncidentInternal(
  incidentId: string,
  now: Date = new Date()
): Promise<AutoUnsnoozeResult> {
  const result = await attemptAutoUnsnoozeInternal(incidentId, now);
  if (result.outcome === 'changed') {
    await dispatchAutoUnsnoozeSideEffects(incidentId);
  }
  return result;
}

/**
 * Process expired incident snoozes (background cron safe - no request headers required).
 */
export async function processAutoUnsnoozeInternal(): Promise<{ processed: number }> {
  const now = new Date();
  const incidentsToUnsnooze = await prisma.incident.findMany({
    where: {
      status: 'SNOOZED',
      snoozedUntil: { lte: now },
    },
    select: { id: true },
  });

  let processed = 0;
  for (const incident of incidentsToUnsnooze) {
    try {
      const result = await processAutoUnsnoozeIncidentInternal(incident.id, now);
      if (result.outcome === 'changed') processed += 1;
    } catch (error) {
      logger.error('Failed to unsnooze incident', {
        component: 'unsnooze',
        incidentId: incident.id,
        error,
      });
    }
  }

  return { processed };
}
