import { IncidentStatus, Prisma } from '@prisma/client';
import type { IncidentLifecycleCommand, IncidentLifecycleSource } from './incidents/lifecycle';

export type EventOutboxAction = 'triggered' | 'resolved' | 'acknowledged';

export type EventSideEffect =
  | 'TRIGGER_WEBHOOK'
  | 'TRIGGER_ESCALATION_NOTIFICATIONS'
  | 'TRIGGER_SERVICE_NOTIFICATION'
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
  | 'LIFECYCLE_WAR_ROOM_ENSURE'
  | 'LIFECYCLE_WAR_ROOM_TOPIC'
  | 'LIFECYCLE_WAR_ROOM_ARCHIVE'
  | 'WAR_ROOM_MESSAGE'
  | 'WAR_ROOM_TOPIC'
  | 'WAR_ROOM_INVITE_USER'
  | 'WAR_ROOM_INVITE_TEAM'
  | 'INCIDENT_UPDATE_USER_NOTIFICATION'
  | 'INCIDENT_ASSIGNED_TO_USER_NOTIFICATION'
  | 'INCIDENT_ASSIGNED_TO_TEAM_NOTIFICATION'
  | 'INCIDENT_UPDATE_SERVICE_NOTIFICATION'
  | 'INCIDENT_UPDATE_WEBHOOK';

export type EventSideEffectLane =
  | 'WEBHOOK'
  | 'ESCALATION'
  | 'WAR_ROOM'
  | 'SLACK'
  | 'PERSONAL_NOTIFICATION'
  | 'SERVICE_NOTIFICATION'
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
  /** Incident generation/status captured in the same transaction as the outbox row. */
  escalationGeneration?: number;
  incidentStatus?: IncidentStatus;
  lifecycle?: LifecycleSideEffectContext;
  warRoom?: { message?: string; userId?: string; teamId?: string };
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
      return [
        'TRIGGER_WEBHOOK',
        'TRIGGER_ESCALATION_NOTIFICATIONS',
        'TRIGGER_SERVICE_NOTIFICATION',
        'TRIGGER_STATUS_PAGE',
        'TRIGGER_WAR_ROOM',
      ];
    case 'resolved':
    case 'acknowledged':
      return [];
  }
}

export function getIncidentCreationSideEffects(
  input: Pick<IncidentCreationOutboxInput, 'source'>
): readonly EventSideEffect[] {
  const effects: EventSideEffect[] = [
    'TRIGGER_ESCALATION_NOTIFICATIONS',
    'TRIGGER_SERVICE_NOTIFICATION',
    'TRIGGER_STATUS_PAGE',
    'TRIGGER_WAR_ROOM',
  ];
  if (input.source === 'REST_API') effects.unshift('TRIGGER_WEBHOOK');
  if (input.source === 'WEB' || input.source === 'MOBILE') effects.push('TRIGGER_JIRA');
  return effects;
}

export function getLifecycleSideEffects(
  input: Pick<LifecycleOutboxInput, 'command' | 'source' | 'status'>
): readonly EventSideEffect[] {
  const effects = new Set<EventSideEffect>();
  const responderLifecycle =
    input.status === 'ACKNOWLEDGED' || input.status === 'RESOLVED' || input.status === 'OPEN';
  if (responderLifecycle) {
    effects.add('LIFECYCLE_USER_NOTIFICATION');
    effects.add('LIFECYCLE_SERVICE_NOTIFICATION');
  }
  effects.add('LIFECYCLE_STATUS_PAGE');
  effects.add('LIFECYCLE_WEBHOOK');
  if (input.source === 'CHATOPS') {
    if (input.status === 'ACKNOWLEDGED') effects.add('LIFECYCLE_WAR_ROOM_TOPIC');
    if (input.status === 'RESOLVED') effects.add('LIFECYCLE_WAR_ROOM_ARCHIVE');
    return Array.from(effects);
  }
  if (input.status === 'RESOLVED') effects.add('LIFECYCLE_WAR_ROOM_ARCHIVE');
  else if (input.command === 'REOPEN') effects.add('LIFECYCLE_WAR_ROOM_ENSURE');
  else if (
    input.status === 'ACKNOWLEDGED' ||
    input.status === 'OPEN' ||
    input.status === 'SNOOZED' ||
    input.status === 'SUPPRESSED'
  )
    effects.add('LIFECYCLE_WAR_ROOM_SYNC');
  return Array.from(effects);
}

function getEventSideEffectLane(effect: EventSideEffect): EventSideEffectLane {
  switch (effect) {
    case 'TRIGGER_WEBHOOK':
    case 'RESOLVE_WEBHOOK':
    case 'LIFECYCLE_WEBHOOK':
    case 'INCIDENT_UPDATE_WEBHOOK':
      return 'WEBHOOK';
    // The initial escalation resolves the responder audience and materializes
    // personal channel intents. Keep later ACK/resolve fan-out behind it so a
    // fast lifecycle transition cannot overtake paging and lose the engaged
    // responder set. Service integrations use a different lane below.
    case 'TRIGGER_ESCALATION_NOTIFICATIONS':
      return 'PERSONAL_NOTIFICATION';
    case 'TRIGGER_WAR_ROOM':
    case 'RESOLVE_WAR_ROOM_ARCHIVE':
    case 'LIFECYCLE_WAR_ROOM_SYNC':
    case 'LIFECYCLE_WAR_ROOM_ENSURE':
    case 'LIFECYCLE_WAR_ROOM_TOPIC':
    case 'LIFECYCLE_WAR_ROOM_ARCHIVE':
    case 'WAR_ROOM_MESSAGE':
    case 'WAR_ROOM_TOPIC':
    case 'WAR_ROOM_INVITE_USER':
    case 'WAR_ROOM_INVITE_TEAM':
      return 'WAR_ROOM';
    case 'RESOLVE_SLACK':
    case 'ACK_SLACK':
      return 'SLACK';
    case 'LIFECYCLE_USER_NOTIFICATION':
    case 'INCIDENT_UPDATE_USER_NOTIFICATION':
    case 'INCIDENT_ASSIGNED_TO_USER_NOTIFICATION':
    case 'INCIDENT_ASSIGNED_TO_TEAM_NOTIFICATION':
      return 'PERSONAL_NOTIFICATION';
    case 'TRIGGER_SERVICE_NOTIFICATION':
    case 'LIFECYCLE_SERVICE_NOTIFICATION':
    case 'INCIDENT_UPDATE_SERVICE_NOTIFICATION':
      return 'SERVICE_NOTIFICATION';
    case 'TRIGGER_STATUS_PAGE':
    case 'LIFECYCLE_STATUS_PAGE':
      return 'STATUS_PAGE';
    case 'TRIGGER_JIRA':
      return 'INTEGRATION';
  }
}

async function databaseClock(tx: Prisma.TransactionClient): Promise<Date> {
  const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS "now"`;
  return clock?.now ?? new Date();
}
async function enqueueSideEffects(
  tx: Prisma.TransactionClient,
  incidentId: string,
  effects: readonly EventSideEffect[],
  lifecycle?: LifecycleSideEffectContext,
  warRoom?: EventSideEffectPayload['warRoom']
): Promise<void> {
  if (effects.length === 0) return;
  const [eventOrderAt, incidentSnapshot] = await Promise.all([
    databaseClock(tx),
    tx.incident.findUnique({
      where: { id: incidentId },
      select: { escalationGeneration: true, status: true },
    }),
  ]);
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
        escalationGeneration: incidentSnapshot?.escalationGeneration ?? 0,
        ...(incidentSnapshot?.status ? { incidentStatus: incidentSnapshot.status } : {}),
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
        ...(warRoom ? { warRoom } : {}),
      } satisfies EventSideEffectPayload & Prisma.InputJsonObject,
    })),
  });
}

export async function enqueueWarRoomSideEffects(
  tx: Prisma.TransactionClient,
  incidentId: string,
  effects: readonly {
    effect: Extract<
      EventSideEffect,
      'WAR_ROOM_MESSAGE' | 'WAR_ROOM_TOPIC' | 'WAR_ROOM_INVITE_USER' | 'WAR_ROOM_INVITE_TEAM'
    >;
    message?: string;
    userId?: string;
    teamId?: string;
  }[]
): Promise<void> {
  for (const item of effects) {
    await enqueueSideEffects(tx, incidentId, [item.effect], undefined, {
      ...(item.message ? { message: item.message } : {}),
      ...(item.userId ? { userId: item.userId } : {}),
      ...(item.teamId ? { teamId: item.teamId } : {}),
    });
  }
}

async function enqueueEscalationResume(
  tx: Prisma.TransactionClient,
  input: LifecycleOutboxInput
): Promise<void> {
  // One contract for every command that opens a new escalation run, so a
  // resumed page runs when it is due instead of waiting for a scanner to
  // notice. The escalation domain owns which step is now due.
  const { isEscalationResumeCommand, resumeEscalationExecution } =
    await import('./escalation/repository');
  if (!isEscalationResumeCommand(input.command)) return;

  await resumeEscalationExecution(tx, {
    incidentId: input.incidentId,
    reason: `Superseded by incident ${input.command.toLowerCase()}`,
  });
}

export async function enqueueEventSideEffects(
  tx: Prisma.TransactionClient,
  action: EventOutboxAction,
  incidentId: string
): Promise<void> {
  await enqueueSideEffects(tx, incidentId, getEventSideEffects(action));
}
export async function enqueueIncidentUpdateSideEffects(
  tx: Prisma.TransactionClient,
  incidentId: string,
  effects: readonly Extract<
    EventSideEffect,
    | 'INCIDENT_UPDATE_USER_NOTIFICATION'
    | 'INCIDENT_ASSIGNED_TO_USER_NOTIFICATION'
    | 'INCIDENT_ASSIGNED_TO_TEAM_NOTIFICATION'
    | 'INCIDENT_UPDATE_SERVICE_NOTIFICATION'
    | 'INCIDENT_UPDATE_WEBHOOK'
  >[]
): Promise<void> {
  await enqueueSideEffects(tx, incidentId, effects);
}
export async function enqueueIncidentCreationSideEffects(
  tx: Prisma.TransactionClient,
  input: IncidentCreationOutboxInput
): Promise<void> {
  await enqueueSideEffects(tx, input.incidentId, getIncidentCreationSideEffects(input));
}
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
  await enqueueEscalationResume(tx, input);
  if (input.command === 'SNOOZE' && input.snoozedUntil)
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
