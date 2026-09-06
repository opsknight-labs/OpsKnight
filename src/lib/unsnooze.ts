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
 * Worker-safe one-incident adapter. The lifecycle transaction already persists
 * the timeline entry and durable side-effect work before it commits.
 */
export async function processAutoUnsnoozeIncidentInternal(
  incidentId: string,
  now: Date = new Date()
): Promise<AutoUnsnoozeResult> {
  return attemptAutoUnsnoozeInternal(incidentId, now);
}

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
