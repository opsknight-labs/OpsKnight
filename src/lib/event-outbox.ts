import { IncidentStatus, Prisma } from '@prisma/client';
import type { IncidentLifecycleCommand, IncidentLifecycleSource } from './incidents/lifecycle';

export type EventOutboxAction = 'triggered' | 'resolved' | 'acknowledged';

export type EventSideEffect =
  | 'TRIGGER_WEBHOOK'
  | 'TRIGGER_ESCALATION_NOTIFICATIONS'
  | 'TRIGGER_WAR_ROOM'
  | 'TRIGGER_STATUS_PAGE'
  | 'TRIGGER_JIRA'
  | 'RESOLVE_WEBHOOK'
  | 'RESOLVE_SLACK'
  | 'RESOLVE_WAR_ROOM_ARCHIVE'
  | 'ACK_SLACK'
  | 'LIFECYCLE_USER_NOTIFICATION'
  | 'LIFECYCLE_SERVICE_NOTIFICATION'
  | 'LIFECYCLE_STATUS_PAGE'
  | 'LIFECYCLE_WEBHOOK'
  | 'LIFECYCLE_WAR_ROOM_SYNC'
  | 'LIFECYCLE_WAR_ROOM_TOPIC'
  | 'LIFECYCLE_WAR_ROOM_ARCHIVE';

export type EventSideEffectLane =
  | 'WEBHOOK'
  | 'ESCALATION'
  | 'WAR_ROOM'
  | 'SLACK'
  | 'NOTIFICATION'
  | 'STATUS_PAGE'
  | 'INTEGRATION';

export interface LifecycleSideEffectContext {
  command: IncidentLifecycleCommand;
  source: IncidentLifecycleSource;
  previousStatus: IncidentStatus;
  status: IncidentStatus;
  transitionAt: string;
  snoozedUntil: string | null;
}

export interface EventSideEffectPayload {
  task: 'EVENT_SIDE_EFFECT';
  effect: EventSideEffect;
  lane: EventSideEffectLane;
  incidentId: string;
  eventOrderAt: string;
  lifecycle?: LifecycleSideEffectContext;
}

export interface LifecycleOutboxInput {
  incidentId: string;
  command: IncidentLifecycleCommand;
  source: IncidentLifecycleSource;
  previousStatus: IncidentStatus;
  status: IncidentStatus;
  transitionAt: Date;
  snoozedUntil?: Date | null;
}

export interface IncidentCreationOutboxInput {
  incidentId: string;
  source: 'WEB' | 'MOBILE' | 'REST_API';
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

/**
 * Manual/mobile and REST creation historically had slightly different external
 * effects. Persist those effects atomically with the new incident while keeping
 * event-ingestion trigger behavior unchanged.
 */
export function getIncidentCreationSideEffects(
  input: Pick<IncidentCreationOutboxInput, 'source'>
): readonly EventSideEffect[] {
  const effects: EventSideEffect[] = [
    'TRIGGER_ESCALATION_NOTIFICATIONS',
    'TRIGGER_STATUS_PAGE',
    'TRIGGER_WAR_ROOM',
  ];

  // REST historically emitted the public incident.created status-page webhook.
  if (input.source === 'REST_API') effects.unshift('TRIGGER_WEBHOOK');

  // Interactive creation historically owned Jira auto-create. Keep it durable,
  // but do not silently add Jira automation to the REST API contract.
  if (input.source === 'WEB' || input.source === 'MOBILE') effects.push('TRIGGER_JIRA');

  return effects;
}

/**
 * Preserve the side-effect semantics each adapter had before lifecycle
 * centralization while making delivery durable. The domain engine owns when a
 * transition happened; this mapping owns which external systems should hear
 * about that committed transition.
 */
export function getLifecycleSideEffects(
  input: Pick<LifecycleOutboxInput, 'command' | 'source' | 'status'>
): readonly EventSideEffect[] {
  const effects = new Set<EventSideEffect>();

  // Event ingestion already persists its ACK/RESOLVE effects through the same
  // EVENT_SIDE_EFFECT envelope in events.ts. Keep that existing owner until the
  // creation/trigger outbox is generalized so event jobs are not duplicated.
  if (input.source === 'EVENT') return [];

  if (input.source === 'WEB' || input.source === 'MOBILE') {
    effects.add('LIFECYCLE_STATUS_PAGE');
    effects.add('LIFECYCLE_WEBHOOK');

    if (input.status === 'ACKNOWLEDGED' || input.status === 'RESOLVED' || input.status === 'OPEN') {
      effects.add('LIFECYCLE_USER_NOTIFICATION');
    }

    if (input.status === 'RESOLVED') {
      effects.add('LIFECYCLE_WAR_ROOM_ARCHIVE');
    } else {
      effects.add('LIFECYCLE_WAR_ROOM_SYNC');
    }
    return Array.from(effects);
  }

  if (input.source === 'BULK') {
    effects.add('LIFECYCLE_WEBHOOK');
    if (input.status === 'ACKNOWLEDGED' || input.status === 'RESOLVED' || input.status === 'OPEN') {
      effects.add('LIFECYCLE_USER_NOTIFICATION');
    }
    if (input.status === 'ACKNOWLEDGED' || input.status === 'RESOLVED') {
      effects.add('LIFECYCLE_STATUS_PAGE');
    }
    if (input.status === 'RESOLVED') effects.add('LIFECYCLE_WAR_ROOM_ARCHIVE');
    return Array.from(effects);
  }

  if (input.source === 'REST_API') {
    effects.add('LIFECYCLE_SERVICE_NOTIFICATION');
    effects.add('LIFECYCLE_WEBHOOK');
    if (input.status === 'ACKNOWLEDGED' || input.status === 'RESOLVED' || input.status === 'OPEN') {
      effects.add('LIFECYCLE_STATUS_PAGE');
    }
    return Array.from(effects);
  }

  if (input.source === 'CHATOPS') {
    if (
      input.status === 'ACKNOWLEDGED' ||
      input.status === 'RESOLVED' ||
      input.status === 'SNOOZED'
    ) {
      effects.add('LIFECYCLE_USER_NOTIFICATION');
    }
    if (input.status === 'ACKNOWLEDGED') effects.add('LIFECYCLE_WAR_ROOM_TOPIC');
    if (input.status === 'RESOLVED') effects.add('LIFECYCLE_WAR_ROOM_ARCHIVE');
    return Array.from(effects);
  }

  if (input.source === 'SYSTEM' && input.status === 'OPEN') {
    effects.add('LIFECYCLE_USER_NOTIFICATION');
    effects.add('LIFECYCLE_STATUS_PAGE');
    effects.add('LIFECYCLE_WEBHOOK');
  }

  return Array.from(effects);
}

function getEventSideEffectLane(effect: EventSideEffect): EventSideEffectLane {
  switch (effect) {
    case 'TRIGGER_WEBHOOK':
    case 'RESOLVE_WEBHOOK':
    case 'LIFECYCLE_WEBHOOK':
      return 'WEBHOOK';
    case 'TRIGGER_ESCALATION_NOTIFICATIONS':
      return 'ESCALATION';
    case 'TRIGGER_WAR_ROOM':
    case 'RESOLVE_WAR_ROOM_ARCHIVE':
    case 'LIFECYCLE_WAR_ROOM_SYNC':
    case 'LIFECYCLE_WAR_ROOM_TOPIC':
    case 'LIFECYCLE_WAR_ROOM_ARCHIVE':
      return 'WAR_ROOM';
    case 'RESOLVE_SLACK':
    case 'ACK_SLACK':
      return 'SLACK';
    case 'LIFECYCLE_USER_NOTIFICATION':
    case 'LIFECYCLE_SERVICE_NOTIFICATION':
      return 'NOTIFICATION';
    case 'TRIGGER_STATUS_PAGE':
    case 'LIFECYCLE_STATUS_PAGE':
      return 'STATUS_PAGE';
    case 'TRIGGER_JIRA':
      return 'INTEGRATION';
  }
}

async function databaseClock(tx: Prisma.TransactionClient): Promise<Date> {
  const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`
    SELECT clock_timestamp() AS "now"
  `;
  return clock?.now ?? new Date();
}

async function enqueueSideEffects(
  tx: Prisma.TransactionClient,
  incidentId: string,
  effects: readonly EventSideEffect[],
  lifecycle?: LifecycleSideEffectContext
): Promise<void> {
  if (effects.length === 0) return;

  const eventOrderAt = await databaseClock(tx);
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
        ...(lifecycle
          ? {
              lifecycle: {
                command: lifecycle.command,
                source: lifecycle.source,
                previousStatus: lifecycle.previousStatus,
                status: lifecycle.status,
                transitionAt: lifecycle.transitionAt,
                snoozedUntil: lifecycle.snoozedUntil,
              },
            }
          : {}),
      } satisfies EventSideEffectPayload & Prisma.InputJsonObject,
    })),
  });
}

/**
 * Persist event-ingestion side-effects in the same database transaction as the
 * incident state change/creation. The existing SCHEDULED_TASK job type is the
 * durable internal outbox envelope, so self-hosted installs need no extra
 * queueing infrastructure.
 */
export async function enqueueEventSideEffects(
  tx: Prisma.TransactionClient,
  action: EventOutboxAction,
  incidentId: string
): Promise<void> {
  await enqueueSideEffects(tx, incidentId, getEventSideEffects(action));
}

/**
 * Persist manual/mobile/REST creation side effects in the same transaction as
 * the incident row and creation timeline entry.
 */
export async function enqueueIncidentCreationSideEffects(
  tx: Prisma.TransactionClient,
  input: IncidentCreationOutboxInput
): Promise<void> {
  await enqueueSideEffects(tx, input.incidentId, getIncidentCreationSideEffects(input));
}

/**
 * Persist lifecycle side-effects atomically with a real lifecycle transition.
 * Idempotent lifecycle no-ops never call this function, so retries do not
 * create duplicate outbox work.
 *
 * Finite snoozes also persist their AUTO_UNSNOOZE timer in the same transaction
 * rather than relying on a post-commit scheduling call. The cron sweep remains
 * a safety net for old/missing jobs.
 */
export async function enqueueLifecycleSideEffects(
  tx: Prisma.TransactionClient,
  input: LifecycleOutboxInput
): Promise<void> {
  const lifecycle: LifecycleSideEffectContext = {
    command: input.command,
    source: input.source,
    previousStatus: input.previousStatus,
    status: input.status,
    transitionAt: input.transitionAt.toISOString(),
    snoozedUntil: input.snoozedUntil?.toISOString() ?? null,
  };

  await enqueueSideEffects(tx, input.incidentId, getLifecycleSideEffects(input), lifecycle);

  if (input.command === 'SNOOZE' && input.snoozedUntil) {
    await tx.backgroundJob.create({
      data: {
        type: 'AUTO_UNSNOOZE',
        status: 'PENDING',
        scheduledAt: input.snoozedUntil,
        maxAttempts: 3,
        payload: { incidentId: input.incidentId },
      },
    });
  }
}
