import { Prisma } from '@prisma/client';

export type EventOutboxAction = 'triggered' | 'resolved' | 'acknowledged';

export type EventSideEffect =
  | 'TRIGGER_WEBHOOK'
  | 'TRIGGER_ESCALATION_NOTIFICATIONS'
  | 'TRIGGER_WAR_ROOM'
  | 'RESOLVE_WEBHOOK'
  | 'RESOLVE_SLACK'
  | 'RESOLVE_WAR_ROOM_ARCHIVE'
  | 'ACK_SLACK';

export type EventSideEffectLane = 'WEBHOOK' | 'ESCALATION' | 'WAR_ROOM' | 'SLACK';

export interface EventSideEffectPayload {
  task: 'EVENT_SIDE_EFFECT';
  effect: EventSideEffect;
  lane: EventSideEffectLane;
  incidentId: string;
  eventOrderAt: string;
}

export function getEventSideEffects(action: EventOutboxAction): readonly EventSideEffect[] {
  switch (action) {
    case 'triggered':
      return ['TRIGGER_WEBHOOK', 'TRIGGER_ESCALATION_NOTIFICATIONS', 'TRIGGER_WAR_ROOM'];
    case 'resolved':
      return ['RESOLVE_WEBHOOK', 'RESOLVE_SLACK', 'RESOLVE_WAR_ROOM_ARCHIVE'];
    case 'acknowledged':
      return ['ACK_SLACK'];
  }
}

function getEventSideEffectLane(effect: EventSideEffect): EventSideEffectLane {
  switch (effect) {
    case 'TRIGGER_WEBHOOK':
    case 'RESOLVE_WEBHOOK':
      return 'WEBHOOK';
    case 'TRIGGER_ESCALATION_NOTIFICATIONS':
      return 'ESCALATION';
    case 'TRIGGER_WAR_ROOM':
    case 'RESOLVE_WAR_ROOM_ARCHIVE':
      return 'WAR_ROOM';
    case 'RESOLVE_SLACK':
    case 'ACK_SLACK':
      return 'SLACK';
  }
}

/**
 * Persist event side-effects in the same database transaction as the incident
 * state change. The existing SCHEDULED_TASK job type is intentionally used as
 * the durable internal outbox envelope so self-hosted installs do not require
 * Redis, Kafka, or another queueing service.
 *
 * A PostgreSQL clock timestamp is captured after the event's advisory lock is
 * acquired. Workers use this value to preserve lifecycle order within a single
 * incident/lane (for example created webhook before resolved webhook), while
 * independent lanes remain free to execute concurrently.
 */
export async function enqueueEventSideEffects(
  tx: Prisma.TransactionClient,
  action: EventOutboxAction,
  incidentId: string
): Promise<void> {
  const effects = getEventSideEffects(action);
  if (effects.length === 0) return;

  const [databaseClock] = await tx.$queryRaw<Array<{ now: Date }>>`
    SELECT clock_timestamp() AS "now"
  `;
  const eventOrderAt = databaseClock?.now ?? new Date();
  const eventOrderAtIso = eventOrderAt.toISOString();

  await tx.backgroundJob.createMany({
    data: effects.map(effect => ({
      type: 'SCHEDULED_TASK',
      status: 'PENDING',
      scheduledAt: eventOrderAt,
      maxAttempts: 5,
      payload: {
        task: 'EVENT_SIDE_EFFECT',
        effect,
        lane: getEventSideEffectLane(effect),
        incidentId,
        eventOrderAt: eventOrderAtIso,
      } satisfies EventSideEffectPayload,
    })),
  });
}
