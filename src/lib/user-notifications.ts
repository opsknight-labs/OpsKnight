/**
 * User notification policy and fan-out.
 *
 * Correctness rules:
 * - every user-enabled channel is attempted independently;
 * - each recipient/channel attempt is a durable Notification intent;
 * - persisted intent failures are retried only by notification-retry.ts;
 * - service integrations are owned by their own outbox effect and can never
 *   cause personal notifications to replay;
 * - lifecycle audience is resolved once into durable per-user intents.
 */

import prisma from './prisma';
import type { IncidentStatus, Prisma } from '@prisma/client';
import { sendNotification, type NotificationChannel } from './notifications';
import { isChannelAvailable } from './notification-providers';
import { createInAppNotifications } from './in-app-notifications';
import { logger } from './logger';
import { filterChannelsForQuietHours } from './quiet-hours';
import type {
  NotificationDeliveryOutcome,
  NotificationDeliveryResult,
  NotificationEventType,
} from './notification-delivery';
import { notificationEventKey } from './notification-identity';

export type IncidentNotificationIntent =
  | 'INCIDENT_UPDATED'
  | 'ASSIGNED_TO_USER'
  | 'ASSIGNED_TO_TEAM';

export type SendIncidentNotificationOptions = {
  intent?: IncidentNotificationIntent;
  /** Committed lifecycle generation carried by the outbox payload. */
  eventAt?: Date;
  status?: IncidentStatus;
};

export type UserNotificationDisposition = NotificationDeliveryOutcome;

type IncidentNotificationResult = NotificationDeliveryResult & {
  disposition: UserNotificationDisposition;
};

const incidentNotificationInclude = {
  service: {
    include: {
      team: {
        include: {
          members: {
            include: { user: true },
          },
        },
      },
    },
  },
  team: { include: { members: true } },
  assignee: true,
  watchers: true,
} satisfies Prisma.IncidentInclude;

type IncidentNotificationRecord = Prisma.IncidentGetPayload<{
  include: typeof incidentNotificationInclude;
}>;

type ChannelAttempt = {
  channel: NotificationChannel;
  success: boolean;
  outcome: NotificationDeliveryOutcome;
  notificationId?: string;
  error?: string;
  skipped?: boolean;
};

function summarizeChannelAttempts(attempts: ChannelAttempt[]): {
  success: boolean;
  outcome: NotificationDeliveryOutcome;
  channelsUsed: NotificationChannel[];
  errors?: string[];
} {
  const channelsUsed = attempts
    .filter(item => item.outcome === 'DELIVERED')
    .map(item => item.channel);
  const unpersistedFailures = attempts.filter(item => !item.success && !item.notificationId);
  const persistedFailures = attempts.filter(item => !item.success && item.notificationId);
  const errors = attempts
    .filter(item => !item.success)
    .map(item => `${item.channel}: ${item.error || 'Delivery failed'}`);

  if (attempts.some(item => item.outcome === 'QUEUED')) {
    return {
      success: true,
      outcome: 'QUEUED',
      channelsUsed,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  if (unpersistedFailures.length > 0) {
    const permanentOnly = unpersistedFailures.every(item => item.outcome === 'PERMANENT_FAILURE');
    return {
      success: false,
      outcome: permanentOnly ? 'PERMANENT_FAILURE' : 'RETRYABLE_FAILURE',
      channelsUsed,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  if (persistedFailures.length > 0) {
    const retryQueued = persistedFailures.some(
      item =>
        item.outcome === 'RETRYABLE_FAILURE' ||
        item.outcome === 'CIRCUIT_OPEN' ||
        item.outcome === 'QUEUED'
    );
    return {
      success: true,
      outcome: retryQueued ? 'QUEUED' : 'PERMANENT_FAILURE',
      channelsUsed,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  if (channelsUsed.length > 0) {
    return { success: true, outcome: 'DELIVERED', channelsUsed };
  }

  return { success: true, outcome: 'SKIPPED', channelsUsed: [] };
}

/** Return every user-enabled and currently available external channel. */
export async function getUserNotificationChannels(userId: string): Promise<NotificationChannel[]> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      status: true,
      emailNotificationsEnabled: true,
      smsNotificationsEnabled: true,
      pushNotificationsEnabled: true,
      whatsappNotificationsEnabled: true,
      phoneNumber: true,
      email: true,
    },
  });

  if (!user || user.status !== 'ACTIVE') return [];

  const channels: NotificationChannel[] = [];
  const [pushAvailable, smsAvailable, emailAvailable, whatsappConfig] = await Promise.all([
    isChannelAvailable('PUSH'),
    isChannelAvailable('SMS'),
    isChannelAvailable('EMAIL'),
    import('./notification-providers').then(module => module.getWhatsAppConfig()),
  ]);

  if (user.pushNotificationsEnabled && pushAvailable) channels.push('PUSH');
  if (user.smsNotificationsEnabled && user.phoneNumber && smsAvailable) channels.push('SMS');
  if (
    user.whatsappNotificationsEnabled &&
    user.phoneNumber &&
    whatsappConfig.enabled &&
    whatsappConfig.provider === 'twilio'
  ) {
    channels.push('WHATSAPP');
  }
  if (user.emailNotificationsEnabled && user.email && emailAvailable) channels.push('EMAIL');

  return channels;
}

/**
 * Direct/escalation notification. All selected user-enabled channels are
 * independent intents; success on one never suppresses another.
 */
export async function sendUserNotification(
  incidentId: string,
  userId: string,
  message: string,
  escalationChannels?: NotificationChannel[],
  options: {
    createInApp?: boolean;
    eventType?: NotificationEventType;
  } = {}
): Promise<{
  success: boolean;
  disposition: UserNotificationDisposition;
  channelsUsed: NotificationChannel[];
  errors?: string[];
  suppressedByQuietHours?: boolean;
  suppressedByPreference?: boolean;
}> {
  const eventType = options.eventType ?? 'triggered';
  const [incident, recipient, userChannels] = await Promise.all([
    prisma.incident.findUnique({
      where: { id: incidentId },
      select: {
        id: true,
        urgency: true,
        createdAt: true,
        updatedAt: true,
        acknowledgedAt: true,
        resolvedAt: true,
        currentEscalationStep: true,
        nextEscalationAt: true,
        escalationStatus: true,
      },
    }),
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        status: true,
        timeZone: true,
        quietHoursEnabled: true,
        quietHoursStartMinutes: true,
        quietHoursEndMinutes: true,
        quietHoursWeekendAllDay: true,
      },
    }),
    getUserNotificationChannels(userId),
  ]);

  if (!incident || !recipient || recipient.status !== 'ACTIVE') {
    return {
      success: true,
      disposition: 'SKIPPED',
      channelsUsed: [],
      suppressedByPreference: true,
    };
  }

  const eventKey = notificationEventKey({
    incident,
    eventType,
    purpose: 'DIRECT_OR_ESCALATION',
    message,
  });

  if (options.createInApp !== false) {
    try {
      await createInAppNotifications({
        userIds: [userId],
        type: 'INCIDENT',
        title: 'Action Required',
        message,
        entityType: 'INCIDENT',
        entityId: incidentId,
        dedupeKey: eventKey,
      });
    } catch (error) {
      logger.error('Failed to create In-App notification', { userId, incidentId, error });
    }
  }

  let channels = userChannels;
  if (escalationChannels && escalationChannels.length > 0) {
    const selected = escalationChannels.filter(channel => userChannels.includes(channel));
    channels = selected.length > 0 ? selected : userChannels;
  }

  if (channels.length === 0) {
    return {
      success: true,
      disposition: 'SKIPPED',
      channelsUsed: [],
      suppressedByPreference: true,
    };
  }

  const quietHoursResult = filterChannelsForQuietHours(channels, incident.urgency, recipient);
  channels = quietHoursResult.channels;

  if (channels.length === 0 && quietHoursResult.blockedChannels.size > 0) {
    logger.info('[UserNotification] External delivery suppressed by quiet hours', {
      incidentId,
      userId,
    });
    return {
      success: true,
      disposition: 'SKIPPED',
      channelsUsed: [],
      suppressedByQuietHours: true,
    };
  }

  const attempts = await Promise.all(
    channels.map(async channel => {
      const result = await sendNotification(
        incidentId,
        userId,
        channel,
        message,
        undefined,
        eventType
      );
      if (result.outcome === 'DELIVERED') {
        logger.info(`[UserNotification] Successfully delivered via ${channel}`, {
          incidentId,
          userId,
        });
      }
      return { channel, ...result } satisfies ChannelAttempt;
    })
  );
  const summary = summarizeChannelAttempts(attempts);

  return {
    success: summary.success,
    disposition: summary.outcome,
    channelsUsed: summary.channelsUsed,
    errors: summary.errors,
  };
}

async function previouslyEngagedResponderIds(incidentId: string): Promise<string[]> {
  if (typeof prisma.notification?.findMany !== 'function') return [];
  const rows = await prisma.notification.findMany({
    where: {
      incidentId,
      eventType: 'triggered',
      status: { in: ['PENDING', 'SENT', 'DELIVERED', 'FAILED'] },
    },
    select: { userId: true },
  });
  return [...new Set(rows.map(row => row.userId))];
}

/** Personal lifecycle fan-out. Service integrations are deliberately separate. */
export async function sendIncidentNotifications(
  incidentId: string,
  eventType: 'triggered' | 'acknowledged' | 'resolved' | 'updated',
  excludeUserIds: string[] = [],
  incident?: unknown,
  options: SendIncidentNotificationOptions = {}
): Promise<IncidentNotificationResult> {
  try {
    const incidentData: IncidentNotificationRecord | null = incident
      ? (incident as IncidentNotificationRecord)
      : await prisma.incident.findUnique({
          where: { id: incidentId },
          include: incidentNotificationInclude,
        });

    if (!incidentData || !incidentData.service) {
      return {
        success: false,
        outcome: 'PERMANENT_FAILURE',
        disposition: 'PERMANENT_FAILURE',
        errors: ['Incident or service not found'],
      };
    }

    const incidentRecord = incidentData;
    if (eventType === 'triggered' && incidentRecord.status !== 'OPEN') {
      logger.info('user_notifications.triggered_aborted_non_open_state', {
        incidentId,
        currentStatus: incidentRecord.status,
      });
      return { success: true, outcome: 'SKIPPED', disposition: 'SKIPPED' };
    }

    const intent = options.intent ?? 'INCIDENT_UPDATED';
    const assignedTeamUserIds = Array.isArray(incidentRecord.team?.members)
      ? incidentRecord.team.members
          .filter(member => member.receiveTeamNotifications !== false)
          .map(member => member.userId)
      : [];

    const inAppRecipients: string[] = [];
    if (intent === 'ASSIGNED_TO_USER') {
      if (incidentRecord.assigneeId) inAppRecipients.push(incidentRecord.assigneeId);
    } else if (intent === 'ASSIGNED_TO_TEAM') {
      inAppRecipients.push(...assignedTeamUserIds);
    } else {
      if (incidentRecord.assigneeId) inAppRecipients.push(incidentRecord.assigneeId);
      inAppRecipients.push(...assignedTeamUserIds);
      if (incidentRecord.watchers) {
        inAppRecipients.push(...incidentRecord.watchers.map(watcher => watcher.userId));
      }
      if (incidentRecord.service.team) {
        inAppRecipients.push(
          ...incidentRecord.service.team.members
            .filter(member => member.receiveTeamNotifications !== false)
            .map(member => member.userId)
        );
      }
    }

    const uniqueInAppRecipients = [...new Set(inAppRecipients)].filter(
      userId => !excludeUserIds.includes(userId)
    );
    const eventTitle =
      intent === 'ASSIGNED_TO_USER'
        ? 'Incident Assigned to You'
        : intent === 'ASSIGNED_TO_TEAM'
          ? 'Incident Assigned to Your Team'
          : eventType === 'triggered'
            ? 'New Incident'
            : eventType === 'acknowledged'
              ? 'Incident Acknowledged'
              : eventType === 'resolved'
                ? 'Incident Resolved'
                : 'Incident Updated';
    const eventMessage =
      intent === 'ASSIGNED_TO_USER'
        ? `[${incidentRecord.service.name}] ${incidentRecord.title} has been assigned to you`
        : intent === 'ASSIGNED_TO_TEAM'
          ? `[${incidentRecord.service.name}] ${incidentRecord.title} has been assigned to your team`
          : `[${incidentRecord.service.name}] ${incidentRecord.title}`;
    const notificationIncident = options.eventAt
      ? {
          ...incidentRecord,
          status: options.status ?? incidentRecord.status,
          updatedAt: options.eventAt,
          acknowledgedAt:
            eventType === 'acknowledged' ? options.eventAt : incidentRecord.acknowledgedAt,
          resolvedAt:
            eventType === 'resolved'
              ? options.eventAt
              : options.status === 'OPEN'
                ? null
                : incidentRecord.resolvedAt,
        }
      : incidentRecord;
    const eventKey = notificationEventKey({
      incident: notificationIncident,
      eventType,
      purpose: intent,
      message: eventMessage,
    });

    if (uniqueInAppRecipients.length > 0) {
      await createInAppNotifications({
        userIds: uniqueInAppRecipients,
        type: 'INCIDENT',
        title: eventTitle,
        message: eventMessage,
        entityType: 'INCIDENT',
        entityId: incidentRecord.id,
        dedupeKey: eventKey,
      });
    }

    let externalRecipients: string[] = [];
    if (intent === 'ASSIGNED_TO_USER') {
      externalRecipients = incidentRecord.assigneeId ? [incidentRecord.assigneeId] : [];
    } else if (intent === 'ASSIGNED_TO_TEAM') {
      externalRecipients = assignedTeamUserIds;
    } else if (eventType === 'triggered') {
      externalRecipients = uniqueInAppRecipients;
    } else {
      const engaged = [
        ...(incidentRecord.assigneeId ? [incidentRecord.assigneeId] : []),
        ...assignedTeamUserIds,
        ...(incidentRecord.watchers?.map(watcher => watcher.userId) ?? []),
      ];
      if (eventType === 'acknowledged' || eventType === 'resolved') {
        engaged.push(...(await previouslyEngagedResponderIds(incidentId)));
      }
      externalRecipients = [...new Set(engaged)].filter(userId => !excludeUserIds.includes(userId));
    }

    if (externalRecipients.length === 0) {
      return { success: true, outcome: 'SKIPPED', disposition: 'SKIPPED' };
    }

    const users = await prisma.user.findMany({
      where: { id: { in: externalRecipients }, status: 'ACTIVE' },
      select: {
        id: true,
        emailNotificationsEnabled: true,
        smsNotificationsEnabled: true,
        pushNotificationsEnabled: true,
        whatsappNotificationsEnabled: true,
        phoneNumber: true,
        email: true,
        timeZone: true,
        quietHoursEnabled: true,
        quietHoursStartMinutes: true,
        quietHoursEndMinutes: true,
        quietHoursWeekendAllDay: true,
      },
    });

    const [emailAvailable, smsAvailable, pushAvailable, whatsappConfig] = await Promise.all([
      isChannelAvailable('EMAIL'),
      isChannelAvailable('SMS'),
      isChannelAvailable('PUSH'),
      import('./notification-providers').then(module => module.getWhatsAppConfig()),
    ]);
    const whatsappAvailable = whatsappConfig.enabled && whatsappConfig.provider === 'twilio';
    const userMap = new Map(users.map(user => [user.id, user]));

    const recipientResults = await Promise.all(
      externalRecipients.map(async userId => {
        const user = userMap.get(userId);
        if (!user) {
          return { userId, success: true, outcome: 'SKIPPED' as const, channelsUsed: [] };
        }

        const channels: NotificationChannel[] = [];
        if (user.pushNotificationsEnabled && pushAvailable) channels.push('PUSH');
        if (user.smsNotificationsEnabled && user.phoneNumber && smsAvailable) channels.push('SMS');
        if (user.whatsappNotificationsEnabled && user.phoneNumber && whatsappAvailable) {
          channels.push('WHATSAPP');
        }
        if (user.emailNotificationsEnabled && user.email && emailAvailable) channels.push('EMAIL');
        if (channels.length === 0) {
          return { userId, success: true, outcome: 'SKIPPED' as const, channelsUsed: [] };
        }

        const quietHoursResult = filterChannelsForQuietHours(
          channels,
          incidentRecord.urgency,
          user
        );
        if (quietHoursResult.channels.length === 0 && quietHoursResult.blockedChannels.size > 0) {
          return { userId, success: true, outcome: 'SKIPPED' as const, channelsUsed: [] };
        }

        const attempts = await Promise.all(
          quietHoursResult.channels.map(async channel => {
            const result = await sendNotification(
              incidentId,
              userId,
              channel,
              eventMessage,
              notificationIncident,
              eventType
            );
            return { channel, ...result } satisfies ChannelAttempt;
          })
        );
        return { userId, ...summarizeChannelAttempts(attempts) };
      })
    );

    const errors = recipientResults.flatMap(
      result => result.errors?.map(error => `User ${result.userId}: ${error}`) ?? []
    );
    const unpersistedFailure = recipientResults.find(result => !result.success);
    if (unpersistedFailure) {
      const outcome = unpersistedFailure.outcome;
      return {
        success: false,
        outcome,
        disposition: outcome,
        errors: errors.length > 0 ? errors : undefined,
      };
    }

    const outcome: NotificationDeliveryOutcome = recipientResults.some(
      result => result.outcome === 'QUEUED'
    )
      ? 'QUEUED'
      : recipientResults.some(result => result.outcome === 'PERMANENT_FAILURE')
        ? 'PERMANENT_FAILURE'
        : recipientResults.some(result => result.outcome === 'DELIVERED')
          ? 'DELIVERED'
          : 'SKIPPED';

    return {
      success: true,
      outcome,
      disposition: outcome,
      errors: errors.length > 0 ? errors : undefined,
    };
  } catch (error) {
    logger.error('User notification error', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return {
      success: false,
      outcome: 'RETRYABLE_FAILURE',
      disposition: 'RETRYABLE_FAILURE',
      errors: [error instanceof Error ? error.message : 'Unknown error'],
    };
  }
}
