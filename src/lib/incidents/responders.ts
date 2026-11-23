import 'server-only';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { redactNotificationError } from '@/lib/notification-operations';
import {
  resolveIncidentResponderRouting,
  responderPolicyInclude,
  type ResponderRouting,
} from '@/lib/escalation/routing';
import { getOnCallNow } from '@/lib/oncall-now';
import { formatDurationShort } from '@/lib/mobile-time';
import { INCIDENT_ROLES } from '@/lib/incidents/roles';
import type { ToneKey } from '@/components/patterns/status-tone';

/**
 * "Is anyone on it?" for the incident page: who was paged and how each page landed, where
 * escalation stands, and who is on call for the service. `buildRespondersView` is pure (plain rows
 * in, view model out); `loadIncidentResponders` is the thin, bounded, never-throwing DB read.
 */

const NOTIFICATION_LIMIT = 200;
const STEP_ATTEMPT_LIMIT = 50;
const USER_LIMIT = 100;
const ON_CALL_SCHEDULE_LIMIT = 3;
const REASON_MAX = 60;

export type DeliveryState = 'delivered' | 'sent' | 'pending' | 'unknown' | 'skipped' | 'failed';

// Best outcome wins: one delivered page on a channel means the channel reached them.
const STATE_RANK: Record<DeliveryState, number> = {
  delivered: 6,
  sent: 5,
  pending: 4,
  unknown: 3,
  skipped: 2,
  failed: 1,
};

const STATE_TONE: Record<DeliveryState, ToneKey> = {
  delivered: 'ok',
  sent: 'neutral',
  pending: 'elevated',
  unknown: 'neutral',
  skipped: 'neutral',
  failed: 'critical',
};

const CHANNEL_LABEL = new Map<string, string>(
  Object.entries({
    EMAIL: 'Email',
    SMS: 'SMS',
    VOICE: 'Voice',
    PUSH: 'Push',
    SLACK: 'Slack',
    WEBHOOK: 'Webhook',
    WHATSAPP: 'WhatsApp',
    MICROSOFT_TEAMS: 'Teams',
  })
);

const ACK_VIA_LABEL = new Map<string, string>(
  Object.entries({
    WEB: 'web',
    MOBILE: 'mobile',
    REST_API: 'API',
    BULK: 'bulk action',
    CHATOPS: 'chat',
    VOICE: 'voice call',
    PUSH: 'push',
    SMS: 'SMS',
    EVENT: 'event',
    SYSTEM: 'system',
  })
);

export type NotificationRow = {
  userId: string | null;
  channel: string;
  status: string;
  recipientType: string;
  recipientId: string | null;
  recipientDisplay: string | null;
  errorMsg: string | null;
  createdAt: Date;
  sentAt: Date | null;
  deliveredAt: Date | null;
  failedAt: Date | null;
  ackedAt: Date | null;
  ackedVia: string | null;
  escalationStepIndex: number | null;
};

export type StepAttemptRow = {
  stepIndex: number;
  resolvedUserIds: string[];
  outcome: string;
};

export type PersonRow = {
  id: string;
  name: string | null;
  avatarUrl: string | null;
  gender: string | null;
};

export type OnCallScheduleRow = {
  scheduleId: string;
  scheduleName: string;
  onCall: Array<{ userId: string; name: string | null; end: string }>;
  next: { userId: string; name: string | null; start: string } | null;
};

export type RespondersInput = {
  now: Date;
  incident: {
    status: string;
    acknowledgedAt: Date | null;
    acknowledgedById: string | null;
    acknowledgedVia: string | null;
    currentEscalationStep: number | null;
    nextEscalationAt: Date | null;
    escalationStatus: string | null;
  };
  notifications: NotificationRow[];
  stepAttempts: StepAttemptRow[];
  people: PersonRow[];
  roles: Array<{ roleKey: string; userId: string }>;
  routing: { type: string; stepLabels: string[] } | null;
  /** null: the viewer may not read schedules (section hidden). */
  onCall: { scheduleCount: number; schedules: OnCallScheduleRow[] } | null;
};

export type ChannelView = {
  channel: string;
  label: string;
  state: DeliveryState;
  tone: ToneKey;
  reason: string | null;
  at: string;
};

export type ResponderView = {
  key: string;
  kind: 'user' | 'destination';
  userId: string | null;
  name: string;
  avatarUrl: string | null;
  gender: string | null;
  role: string | null;
  via: string | null;
  firstPagedAt: string | null;
  firstPagedAgo: string | null;
  channels: ChannelView[];
  ack: { at: string; ago: string; via: string | null } | null;
  tone: ToneKey;
  summary: string;
};

export type EscalationView = {
  tone: ToneKey;
  label: string;
  progress: string | null;
  next: string | null;
};

export type OnCallView =
  | { kind: 'no-schedule' }
  | { kind: 'restricted' }
  | {
      kind: 'schedules';
      schedules: Array<{
        id: string;
        name: string;
        now: Array<{ userId: string; name: string; until: string; endsIn: string }>;
        next: { userId: string; name: string; start: string; startsIn: string } | null;
      }>;
    };

export type RespondersView = {
  people: ResponderView[];
  escalation: EscalationView;
  onCall: OnCallView | null;
};

export function deliveryState(status: string): DeliveryState {
  switch (status) {
    case 'DELIVERED':
      return 'delivered';
    case 'SENT':
      return 'sent';
    case 'PENDING':
      return 'pending';
    case 'FAILED':
      return 'failed';
    case 'SKIPPED':
      return 'skipped';
    default:
      return 'unknown';
  }
}

/** First sentence of the redacted provider error, clipped for a chip. */
export function shortReason(errorMsg: string | null): string | null {
  const redacted = redactNotificationError(errorMsg);
  if (!redacted) return null;
  const sentence = redacted
    .split(/(?<=\.)\s|\n/)[0]
    .trim()
    .replace(/\.$/, '');
  return sentence.length > REASON_MAX ? `${sentence.slice(0, REASON_MAX - 1)}…` : sentence;
}

const ago = (now: Date, at: Date) => `${formatDurationShort(at, now)} ago`;
const viaLabel = (via: string | null) =>
  via ? (ACK_VIA_LABEL.get(via) ?? via.toLowerCase()) : null;

function channelViews(rows: NotificationRow[]): ChannelView[] {
  const best = new Map<string, NotificationRow>();
  for (const row of rows) {
    const current = best.get(row.channel);
    const better =
      !current ||
      STATE_RANK[deliveryState(row.status)] > STATE_RANK[deliveryState(current.status)] ||
      // Same outcome: the latest attempt carries the freshest reason.
      (row.status === current.status && row.createdAt > current.createdAt);
    if (better) best.set(row.channel, row);
  }
  return [...best.values()]
    .map(row => {
      const state = deliveryState(row.status);
      return {
        channel: row.channel,
        label: CHANNEL_LABEL.get(row.channel) ?? row.channel,
        state,
        tone: STATE_TONE[deliveryState(row.status)],
        reason: state === 'failed' ? shortReason(row.errorMsg) : null,
        at: (row.deliveredAt ?? row.sentAt ?? row.failedAt ?? row.createdAt).toISOString(),
      };
    })
    .sort((a, b) => STATE_RANK[b.state] - STATE_RANK[a.state] || a.label.localeCompare(b.label));
}

function responderTone(ack: ResponderView['ack'], channels: ChannelView[]): ToneKey {
  if (ack) return 'ok';
  if (channels.length > 0 && channels.every(channel => channel.state === 'failed'))
    return 'critical';
  return 'elevated';
}

function responderSummary(ack: ResponderView['ack'], channels: ChannelView[]): string {
  if (ack) return `Acknowledged ${ack.ago}${ack.via ? ` via ${ack.via}` : ''}`;
  if (channels.length === 0) return 'Targeted, no page recorded';
  if (channels.every(channel => channel.state === 'failed')) return 'Every page failed';
  if (channels.some(channel => channel.state === 'delivered')) return 'Delivered, not acknowledged';
  return 'Not acknowledged';
}

function buildPeople(input: RespondersInput): ResponderView[] {
  const { now, incident } = input;
  const people = new Map(input.people.map(person => [person.id, person]));
  const roleByUser = new Map<string, string>();
  for (const role of input.roles) {
    const label = INCIDENT_ROLES.find(definition => definition.key === role.roleKey)?.shortLabel;
    if (label && !roleByUser.has(role.userId)) roleByUser.set(role.userId, label);
  }
  const stepLabel = (stepIndex: number | null | undefined) => {
    if (stepIndex == null) return null;
    const target = input.routing?.stepLabels.at(stepIndex);
    return `Step ${stepIndex + 1}${target ? ` · ${target}` : ''}`;
  };

  type Group = { kind: 'user' | 'destination'; id: string; rows: NotificationRow[] };
  const groups = new Map<string, Group>();
  const group = (key: string, kind: Group['kind'], id: string) => {
    const existing = groups.get(key);
    if (existing) return existing;
    const created: Group = { kind, id, rows: [] };
    groups.set(key, created);
    return created;
  };
  for (const row of input.notifications) {
    if (row.userId) group(`user:${row.userId}`, 'user', row.userId).rows.push(row);
    else {
      const id = `${row.recipientType}:${row.recipientId ?? row.recipientDisplay ?? row.channel}`;
      group(`dest:${id}`, 'destination', id).rows.push(row);
    }
  }
  // A step can resolve someone the delivery layer then sent nothing to: still part of the answer.
  const firstStepFor = new Map<string, number>();
  for (const attempt of [...input.stepAttempts].sort((a, b) => a.stepIndex - b.stepIndex)) {
    if (attempt.outcome !== 'NOTIFIED') continue;
    for (const userId of attempt.resolvedUserIds) {
      if (!firstStepFor.has(userId)) firstStepFor.set(userId, attempt.stepIndex);
      group(`user:${userId}`, 'user', userId);
    }
  }
  if (incident.acknowledgedAt && incident.acknowledgedById)
    group(`user:${incident.acknowledgedById}`, 'user', incident.acknowledgedById);

  const views = [...groups.entries()].map(([key, { kind, id, rows }]): ResponderView => {
    const firstPaged = rows.reduce<NotificationRow | null>(
      (first, row) => (!first || row.createdAt < first.createdAt ? row : first),
      null
    );
    const channels = channelViews(rows);
    const notificationAck = rows
      .filter(row => row.ackedAt)
      .sort((a, b) => a.ackedAt!.getTime() - b.ackedAt!.getTime())[0];
    const incidentAck =
      kind === 'user' && incident.acknowledgedById === id && incident.acknowledgedAt
        ? { at: incident.acknowledgedAt, via: incident.acknowledgedVia }
        : null;
    const ackSource =
      incidentAck ??
      (notificationAck ? { at: notificationAck.ackedAt!, via: notificationAck.ackedVia } : null);
    const ack = ackSource
      ? {
          at: ackSource.at.toISOString(),
          ago: ago(now, ackSource.at),
          via: viaLabel(ackSource.via),
        }
      : null;
    const person = kind === 'user' ? people.get(id) : undefined;
    const name =
      kind === 'user'
        ? (person?.name ?? 'Unknown user')
        : (firstPaged?.recipientDisplay ??
          CHANNEL_LABEL.get(firstPaged?.channel ?? '') ??
          'Destination');
    return {
      key,
      kind,
      userId: kind === 'user' ? id : null,
      name,
      avatarUrl: person?.avatarUrl ?? null,
      gender: person?.gender ?? null,
      role: kind === 'user' ? (roleByUser.get(id) ?? null) : null,
      via: stepLabel(firstPaged?.escalationStepIndex ?? firstStepFor.get(id)),
      firstPagedAt: firstPaged ? firstPaged.createdAt.toISOString() : null,
      firstPagedAgo: firstPaged ? ago(now, firstPaged.createdAt) : null,
      channels,
      ack,
      tone: responderTone(ack, channels),
      summary: responderSummary(ack, channels),
    };
  });

  // Whoever acknowledged leads; the rest in the order they were paged.
  return views.sort(
    (a, b) =>
      Number(Boolean(b.ack)) - Number(Boolean(a.ack)) ||
      (a.firstPagedAt ?? '￿').localeCompare(b.firstPagedAt ?? '￿') ||
      a.name.localeCompare(b.name)
  );
}

export function describeEscalation(input: RespondersInput): EscalationView {
  const { incident, routing, now } = input;
  const stepCount = routing?.stepLabels.length ?? 0;
  const lastPaged = input.stepAttempts
    .filter(attempt => attempt.outcome === 'NOTIFIED')
    .reduce((max, attempt) => Math.max(max, attempt.stepIndex), -1);
  const progress =
    lastPaged >= 0 ? `Step ${lastPaged + 1}${stepCount ? ` of ${stepCount}` : ''} paged` : null;

  if (routing?.type === 'NO_ESCALATION')
    return { tone: 'neutral', label: 'No escalation for this incident', progress, next: null };
  if (incident.status === 'RESOLVED')
    return { tone: 'neutral', label: 'Escalation stopped — resolved', progress, next: null };
  if (incident.status === 'ACKNOWLEDGED')
    return { tone: 'ok', label: 'Escalation stopped — acknowledged', progress, next: null };
  if (
    incident.status === 'SNOOZED' ||
    incident.status === 'SUPPRESSED' ||
    incident.escalationStatus === 'PAUSED'
  ) {
    const why =
      incident.status === 'SNOOZED'
        ? 'snoozed'
        : incident.status === 'SUPPRESSED'
          ? 'suppressed'
          : null;
    return { tone: 'elevated', label: `Paused${why ? ` — ${why}` : ''}`, progress, next: null };
  }
  if (incident.escalationStatus === 'FAILED')
    return {
      tone: 'critical',
      label: 'Escalation failed — no reachable responders',
      progress,
      next: null,
    };
  if (incident.escalationStatus === 'COMPLETED')
    return { tone: 'elevated', label: 'Max step reached — not acknowledged', progress, next: null };
  if (incident.escalationStatus === 'ESCALATING' && incident.currentEscalationStep != null) {
    const step = incident.currentEscalationStep;
    const target = routing?.stepLabels.at(step);
    const when =
      incident.nextEscalationAt && incident.nextEscalationAt > now
        ? `in ${formatDurationShort(now, incident.nextEscalationAt)}`
        : 'due now';
    return {
      tone: 'elevated',
      label: 'Escalating',
      progress,
      next: `Next: step ${step + 1}${target ? ` → ${target}` : ''} ${when}`,
    };
  }
  if (!routing || stepCount === 0)
    return { tone: 'neutral', label: 'No escalation policy', progress, next: null };
  return { tone: 'neutral', label: 'Not escalating', progress, next: null };
}

function describeOnCall(input: RespondersInput): OnCallView | null {
  const { onCall, now } = input;
  if (!onCall) return null;
  if (onCall.scheduleCount === 0) return { kind: 'no-schedule' };
  if (onCall.schedules.length === 0) return { kind: 'restricted' };
  return {
    kind: 'schedules',
    schedules: onCall.schedules.map(schedule => ({
      id: schedule.scheduleId,
      name: schedule.scheduleName,
      now: schedule.onCall.map(entry => ({
        userId: entry.userId,
        name: entry.name ?? 'Unknown user',
        until: entry.end,
        endsIn: `ends in ${formatDurationShort(now, entry.end)}`,
      })),
      next: schedule.next
        ? {
            userId: schedule.next.userId,
            name: schedule.next.name ?? 'Unknown user',
            start: schedule.next.start,
            startsIn: `starts in ${formatDurationShort(now, schedule.next.start)}`,
          }
        : null,
    })),
  };
}

export function buildRespondersView(input: RespondersInput): RespondersView {
  return {
    people: buildPeople(input),
    escalation: describeEscalation(input),
    onCall: describeOnCall(input),
  };
}

type PolicyStep = {
  targetType: string;
  targetUserId: string | null;
  targetTeamId: string | null;
  targetScheduleId: string | null;
  targetUser?: { name: string } | null;
  targetTeam?: { name: string } | null;
  targetSchedule?: { name: string } | null;
};

/** Step target names; pinned (snapshot) policies carry ids only, so those names are looked up. */
async function stepLabels(steps: PolicyStep[]): Promise<string[]> {
  const missing = (id: string | null, named: unknown) => (id && !named ? [id] : []);
  const userIds = steps.flatMap(s => missing(s.targetUserId, s.targetUser));
  const teamIds = steps.flatMap(s => missing(s.targetTeamId, s.targetTeam));
  const scheduleIds = steps.flatMap(s => missing(s.targetScheduleId, s.targetSchedule));
  const [users, teams, schedules] = await Promise.all([
    userIds.length
      ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
      : [],
    teamIds.length
      ? prisma.team.findMany({ where: { id: { in: teamIds } }, select: { id: true, name: true } })
      : [],
    scheduleIds.length
      ? prisma.onCallSchedule.findMany({
          where: { id: { in: scheduleIds } },
          select: { id: true, name: true },
        })
      : [],
  ]);
  const names = new Map([...users, ...teams, ...schedules].map(row => [row.id, row.name]));
  return steps.map(step => {
    if (step.targetType === 'USER')
      return step.targetUser?.name ?? names.get(step.targetUserId ?? '') ?? 'User';
    if (step.targetType === 'TEAM')
      return step.targetTeam?.name ?? names.get(step.targetTeamId ?? '') ?? 'Team';
    return (
      step.targetSchedule?.name ?? names.get(step.targetScheduleId ?? '') ?? 'On-call schedule'
    );
  });
}

/**
 * Reads the card's rows. The caller has already passed the incident view check
 * (assertCanViewIncident); `scheduleWhere` is the viewer's schedule read filter, or null when they
 * may not read schedules. Never throws: null means "render nothing".
 */
export async function loadIncidentResponders(input: {
  incidentId: string;
  viewerId: string;
  scheduleWhere: Prisma.OnCallScheduleWhereInput | null;
  now?: Date;
}): Promise<RespondersView | null> {
  const { incidentId } = input;
  const now = input.now ?? new Date();
  try {
    const incident = await prisma.incident.findUnique({
      where: { id: incidentId },
      select: {
        serviceId: true,
        status: true,
        acknowledgedAt: true,
        acknowledgedById: true,
        acknowledgedVia: true,
        currentEscalationStep: true,
        nextEscalationAt: true,
        escalationStatus: true,
        escalationGeneration: true,
        roleAssignments: { select: { roleKey: true, userId: true } },
        service: { select: { escalationPolicyId: true } },
        automationDecision: { select: { escalationPolicyId: true } },
      },
    });
    if (!incident) return null;

    const [notifications, stepAttempts, routing] = await Promise.all([
      prisma.notification.findMany({
        where: {
          incidentId,
          category: 'INCIDENT',
          // Pages only: stakeholder acknowledged/resolved updates are not "paging" someone.
          OR: [
            { escalationStepIndex: { not: null } },
            { eventType: { in: ['triggered', 'incident-triggered'] } },
          ],
        },
        select: {
          userId: true,
          channel: true,
          status: true,
          recipientType: true,
          recipientId: true,
          recipientDisplay: true,
          errorMsg: true,
          createdAt: true,
          sentAt: true,
          deliveredAt: true,
          failedAt: true,
          ackedAt: true,
          ackedVia: true,
          escalationStepIndex: true,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: NOTIFICATION_LIMIT,
      }),
      prisma.escalationStepAttempt.findMany({
        where: { incidentId, generation: incident.escalationGeneration },
        select: { stepIndex: true, resolvedUserIds: true, outcome: true },
        orderBy: { stepIndex: 'asc' },
        take: STEP_ATTEMPT_LIMIT,
      }),
      resolveIncidentResponderRouting(incidentId, incident.serviceId).catch(async error => {
        logger.warn('incident.responders.routing_unavailable', { incidentId, error });
        // Display only: fall back to the policy the page links (pinned id, else the service's) for
        // step names and on-call. The engine itself refuses this fallback.
        const policyId =
          incident.automationDecision?.escalationPolicyId ?? incident.service.escalationPolicyId;
        const policy = policyId
          ? await prisma.escalationPolicy
              .findUnique({ where: { id: policyId }, include: responderPolicyInclude })
              .catch(() => null)
          : null;
        return policy ? ({ type: 'DEFAULT_POLICY', policy } satisfies ResponderRouting) : null;
      }),
    ]);

    const steps = routing?.policy?.steps ?? [];
    const scheduleIds = [
      ...new Set(
        steps.flatMap(step =>
          step.targetType === 'SCHEDULE' && step.targetScheduleId ? [step.targetScheduleId] : []
        )
      ),
    ];
    const userIds = [
      ...new Set([
        ...notifications.flatMap(row => (row.userId ? [row.userId] : [])),
        ...stepAttempts.flatMap(attempt => attempt.resolvedUserIds),
        ...(incident.acknowledgedById ? [incident.acknowledgedById] : []),
      ]),
    ].slice(0, USER_LIMIT);

    const [labels, people, onCall] = await Promise.all([
      stepLabels(steps),
      prisma.user.findMany({
        where: { id: { in: userIds } },
        // Names and avatars only: contact details never reach this card.
        select: { id: true, name: true, avatarUrl: true, gender: true },
        take: USER_LIMIT,
      }),
      // No routing read: say nothing rather than "no schedule".
      !routing || !input.scheduleWhere
        ? null
        : scheduleIds.length
          ? getOnCallNow({
              userId: input.viewerId,
              readWhere: { AND: [input.scheduleWhere, { id: { in: scheduleIds } }] },
              scope: 'all',
              limit: ON_CALL_SCHEDULE_LIMIT,
              now,
            })
              .then(result => ({ scheduleCount: scheduleIds.length, schedules: result.schedules }))
              .catch(error => {
                logger.warn('incident.responders.on_call_unavailable', { incidentId, error });
                return null;
              })
          : { scheduleCount: 0, schedules: [] },
    ]);

    return buildRespondersView({
      now,
      incident,
      notifications,
      stepAttempts,
      people,
      roles: incident.roleAssignments,
      routing: routing ? { type: routing.type, stepLabels: labels } : null,
      onCall,
    });
  } catch (error) {
    logger.warn('incident.responders.unavailable', { incidentId, error });
    return null;
  }
}
