/**
 * User-Based Notification System (on-call style)
 *
 * Architecture:
 * - Users configure their notification preferences (email, SMS, push)
 * - System-level providers are configured via database (Settings → System → Notification Providers)
 * - Service-level: Only Slack webhook URL
 * - When sending notifications, check user preferences and system provider availability
 */

import prisma from './prisma';
import { sendNotification, NotificationChannel } from './notifications';
import { isChannelAvailable } from './notification-providers';
import { createInAppNotifications } from './in-app-notifications';
import { logger } from './logger';
import { filterChannelsForQuietHours } from './quiet-hours';
import {
  isRetryableNotificationOutcome,
  type NotificationDeliveryOutcome,
  type NotificationDeliveryResult,
  type NotificationEventType,
} from './notification-delivery';

export type IncidentNotificationIntent =
  | 'INCIDENT_UPDATED'
  | 'ASSIGNED_TO_USER'
  | 'ASSIGNED_TO_TEAM';

export type SendIncidentNotificationOptions = {
  intent?: IncidentNotificationIntent;
};

/**
 * Get user's enabled notification channels based on their preferences
 * and system provider availability
 *
 * Returns channels in priority order: PUSH → SMS → WhatsApp → EMAIL
 */
export async function getUserNotificationChannels(userId: string): Promise<NotificationChannel[]> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      emailNotificationsEnabled: true,
      smsNotificationsEnabled: true,
      pushNotificationsEnabled: true,
      whatsappNotificationsEnabled: true,
      phoneNumber: true,
      email: true,
    },
  });

  if (!user) {
    return []; // User not found
  }

  const channels: NotificationChannel[] = [];

  // Priority order: PUSH → SMS → WhatsApp → EMAIL
  // Push: Check user preference and system availability
  if (user.pushNotificationsEnabled && (await isChannelAvailable('PUSH'))) {
    channels.push('PUSH');
  }

  // SMS: Check user preference, phone number, and system availability
  if (user.smsNotificationsEnabled && user.phoneNumber && (await isChannelAvailable('SMS'))) {
    channels.push('SMS');
  }

  // WhatsApp: Check user preference and system availability (Twilio)
  if (user.whatsappNotificationsEnabled && user.phoneNumber) {
    const whatsappConfig = await import('./notification-providers').then(m =>
      m.getWhatsAppConfig()
    );
    if (whatsappConfig.enabled && whatsappConfig.provider === 'twilio') {
      channels.push('WHATSAPP');
    }
  }

  // Email: Check user preference and system availability
  if (user.emailNotificationsEnabled && (await isChannelAvailable('EMAIL'))) {
    channels.push('EMAIL');
  }

  // No fallback - respect user's notification preferences
  // If all notifications are disabled, return empty array
  return channels;
}

/**
 * Send notifications to a user based on their preferences
 * @param incidentId - The incident ID
 * @param userId - The user ID to notify
 * @param message - The notification message
 * @param escalationChannels - Optional: Override user preferences with escalation step channels
 */
// ... (imports)

/**
 * Send notifications to a user based on their preferences
 * @param incidentId - The incident ID
 * @param userId - The user ID to notify
 * @param message - The notification message
 * @param escalationChannels - Optional: Override user preferences with escalation step channels
 */
export async function sendUserNotification(
  incidentId: string,
  userId: string,
  message: string,
  escalationChannels?: NotificationChannel[],
  options: {
    excludedChannels?: NotificationChannel[];
    createInApp?: boolean;
    eventType?: NotificationEventType;
  } = {}
): Promise<{
  success: boolean;
  channelsUsed: NotificationChannel[];
  errors?: string[];
  suppressedByQuietHours?: boolean;
}> {
  // Create In-App Notification first. In-app remains available during quiet hours.
  if (options.createInApp !== false) {
    try {
      await createInAppNotifications({
        userIds: [userId],
        type: 'INCIDENT',
        title: 'Action Required', // Generic title for escalation/direct message
        message: message,
        entityType: 'INCIDENT',
        entityId: incidentId,
      });
    } catch (error) {
      logger.error('Failed to create In-App notification', { userId, incidentId, error });
    }
  }

  let channels: NotificationChannel[];
  const excludedChannels = new Set(options.excludedChannels ?? []);
  const userChannels = (await getUserNotificationChannels(userId)).filter(
    channel => !excludedChannels.has(channel)
  );

  // If escalation step specifies channels, use those (filtered by user preferences and availability)
  if (escalationChannels && escalationChannels.length > 0) {
    // Intersection: only use channels that are both in escalation step AND available for user
    channels = escalationChannels.filter(ch => userChannels.includes(ch));

    // If no intersection, fall back to user preferences
    if (channels.length === 0) {
      channels = userChannels;
    }
  } else {
    // Use user preferences
    channels = userChannels;
  }

  const errors: string[] = [];
  const channelsUsed: NotificationChannel[] = [];

  if (channels.length === 0) {
    // Even if no channels, In-App was created. Return success false for external channels only.
    return {
      success: false,
      channelsUsed: [],
      errors: ['User has not enabled any notification channels. In-App notification created.'],
    };
  }

  const [incident, recipient] = await Promise.all([
    prisma.incident.findUnique({ where: { id: incidentId }, select: { urgency: true } }),
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        timeZone: true,
        quietHoursEnabled: true,
        quietHoursStartMinutes: true,
        quietHoursEndMinutes: true,
        quietHoursWeekendAllDay: true,
      },
    }),
  ]);
  const isHighUrgency = incident?.urgency === 'HIGH';

  const quietHoursResult = filterChannelsForQuietHours(channels, incident?.urgency, recipient);
  channels = quietHoursResult.channels;
  const quietHoursBlockedChannels = quietHoursResult.blockedChannels;

  let primarySuccess = false;

  for (const channel of channels) {
    if (!isHighUrgency && primarySuccess) {
      break;
    }

    const result = await sendNotification(
      incidentId,
      userId,
      channel,
      message,
      undefined,
      options.eventType ?? 'triggered'
    );
    if (result.success) {
      channelsUsed.push(channel);
      logger.info(`[UserNotification] Successfully delivered via ${channel}`, {
        incidentId,
        userId,
      });

      primarySuccess = true;
    } else {
      errors.push(`${channel}: ${result.error || 'Failed'}`);
    }
  }

  // Fallback: If all primary specified channels failed, attempt delivery via user's other available channels.
  // Never reintroduce disruptive channels that quiet-hours filtering intentionally blocked.
  if (channelsUsed.length === 0 && userChannels.length > 0) {
    const fallbackChannels = userChannels.filter(
      ch => !channels.includes(ch) && !quietHoursBlockedChannels.has(ch)
    );
    for (const fbChannel of fallbackChannels) {
      const fbResult = await sendNotification(
        incidentId,
        userId,
        fbChannel,
        message,
        undefined,
        options.eventType ?? 'triggered'
      );
      if (fbResult.success) {
        channelsUsed.push(fbChannel);
        logger.warn(`[UserNotification] Fallback delivery succeeded via ${fbChannel}`, {
          incidentId,
          userId,
        });
        break;
      } else {
        errors.push(`Fallback ${fbChannel}: ${fbResult.error || 'Failed'}`);
      }
    }
  }

  // A deliberate quiet-hours suppression is a successful policy decision, not a
  // notification-provider failure. In-app was already created above.
  if (channelsUsed.length === 0 && errors.length === 0 && quietHoursBlockedChannels.size > 0) {
    logger.info('[UserNotification] External delivery suppressed by quiet hours', {
      incidentId,
      userId,
    });
    return {
      success: true,
      channelsUsed: [],
      suppressedByQuietHours: true,
    };
  }

  return {
    success: channelsUsed.length > 0,
    channelsUsed,
    errors: errors.length > 0 ? errors : undefined,
  };
}

/**
 * Send full incident notifications strategy (User prefs + Service integrations)
 * Replaces previous sendServiceNotifications
 */
export async function sendIncidentNotifications(
  incidentId: string,
  eventType: 'triggered' | 'acknowledged' | 'resolved' | 'updated',
  excludeUserIds: string[] = [],
  incident?: any, // eslint-disable-line @typescript-eslint/no-explicit-any
  options: SendIncidentNotificationOptions = {}
): Promise<NotificationDeliveryResult> {
  try {
    const incidentData =
      incident ||
      (await prisma.incident.findUnique({
        where: { id: incidentId },
        include: {
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
        },
      }));

    if (!incidentData || !incidentData.service) {
      return {
        success: false,
        outcome: 'PERMANENT_FAILURE',
        errors: ['Incident or service not found'],
      };
    }

    const incidentRecord = incidentData;

    const errors: string[] = [];
    const deliveryOutcomes: NotificationDeliveryOutcome[] = [];
    const intent = options.intent ?? 'INCIDENT_UPDATED';
    const assignedTeamUserIds = Array.isArray(incidentRecord.team?.members)
      ? incidentRecord.team.members.map((member: { userId: string }) => member.userId)
      : [];
    const inAppRecipients: string[] = [];

    if (intent === 'ASSIGNED_TO_USER') {
      if (incidentRecord.assigneeId) inAppRecipients.push(incidentRecord.assigneeId);
    } else if (intent === 'ASSIGNED_TO_TEAM') {
      inAppRecipients.push(...assignedTeamUserIds);
    } else {
      if (incidentRecord.assigneeId) inAppRecipients.push(incidentRecord.assigneeId);
      if (incidentRecord.watchers && Array.isArray(incidentRecord.watchers)) {
        inAppRecipients.push(...incidentRecord.watchers.map((w: { userId: string }) => w.userId));
      }
      if (incidentRecord.service.team) {
        inAppRecipients.push(
          ...incidentRecord.service.team.members.map((member: { userId: string }) => member.userId)
        );
      }
    }

    // Remove duplicates for In-App notifications
    const uniqueInAppRecipients = [...new Set(inAppRecipients)].filter(
      id => !excludeUserIds.includes(id)
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

    if (uniqueInAppRecipients.length > 0) {
      await createInAppNotifications({
        userIds: uniqueInAppRecipients,
        type: 'INCIDENT',
        title: eventTitle,
        message: eventMessage,
        entityType: 'INCIDENT',
        entityId: incidentRecord.id,
        // The durable outbox retries within a bounded few-minute window. This
        // suppresses duplicate retry copies without suppressing a later,
        // genuinely separate incident update.
        dedupeWindowMs: 10 * 60_000,
      });
    }

    // Determine External Recipients (Push, SMS, WhatsApp, Email)
    // 1. For 'triggered': if this function is called (i.e. service has no escalation policy),
    //    alert the whole team and assignee so someone responds to the new incident.
    // 2. For lifecycle events ('acknowledged', 'resolved', 'updated'):
    //    only send disruptive personal device alerts (Push/SMS/WhatsApp/Email) to the active
    //    Assignee and explicit Incident Watchers. Do NOT blast off-duty team members' personal phones.
    let externalRecipients: string[] = [];
    if (intent === 'ASSIGNED_TO_USER') {
      externalRecipients = incidentRecord.assigneeId ? [incidentRecord.assigneeId] : [];
    } else if (intent === 'ASSIGNED_TO_TEAM') {
      externalRecipients = assignedTeamUserIds;
    } else if (eventType === 'triggered') {
      externalRecipients = uniqueInAppRecipients;
    } else {
      const directRecipients: string[] = [];
      if (incidentRecord.assigneeId) {
        directRecipients.push(incidentRecord.assigneeId);
      }
      if (incidentRecord.watchers && Array.isArray(incidentRecord.watchers)) {
        directRecipients.push(...incidentRecord.watchers.map((w: { userId: string }) => w.userId));
      }
      externalRecipients = [...new Set(directRecipients)].filter(
        id => !excludeUserIds.includes(id)
      );
    }

    if (externalRecipients.length > 0) {
      // Batch fetch user notification preferences to avoid N+1 queries
      const users = await prisma.user.findMany({
        where: { id: { in: externalRecipients } },
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

      // Check channel availability once
      const [emailAvailable, smsAvailable, pushAvailable] = await Promise.all([
        isChannelAvailable('EMAIL'),
        isChannelAvailable('SMS'),
        isChannelAvailable('PUSH'),
      ]);

      // Check WhatsApp availability (requires Twilio)
      const whatsappConfig = await import('./notification-providers').then(m =>
        m.getWhatsAppConfig()
      );
      const whatsappAvailable = whatsappConfig.enabled && whatsappConfig.provider === 'twilio';

      // Create a map for quick lookup
      const userMap = new Map(users.map(u => [u.id, u]));

      // Send notifications to each recipient based on their preferences
      const message = eventMessage;
      const notificationPromises = externalRecipients.map(async userId => {
        const user = userMap.get(userId);
        if (!user) {
          return {
            userId,
            success: false,
            outcome: 'PERMANENT_FAILURE' as const,
            error: 'User not found',
          };
        }

        // Determine channels for this user
        // Priority order: PUSH → SMS → WhatsApp → EMAIL
        const channels: NotificationChannel[] = [];
        if (user.pushNotificationsEnabled && pushAvailable) {
          channels.push('PUSH');
        }
        if (user.smsNotificationsEnabled && user.phoneNumber && smsAvailable) {
          channels.push('SMS');
        }
        if (user.whatsappNotificationsEnabled && user.phoneNumber && whatsappAvailable) {
          channels.push('WHATSAPP');
        }
        if (user.emailNotificationsEnabled && emailAvailable) {
          channels.push('EMAIL');
        }

        if (channels.length === 0) {
          return {
            userId,
            success: true,
            outcome: 'SKIPPED' as const,
            channelsUsed: [] as NotificationChannel[],
          };
        }

        const quietHoursResult = filterChannelsForQuietHours(
          channels,
          incidentRecord.urgency,
          user
        );
        const deliveryChannels = quietHoursResult.channels;

        if (deliveryChannels.length === 0 && quietHoursResult.blockedChannels.size > 0) {
          logger.info('[IncidentNotification] External delivery suppressed by quiet hours', {
            incidentId,
            userId,
          });
          return {
            userId,
            success: true,
            outcome: 'SKIPPED' as const,
            channelsUsed: [] as NotificationChannel[],
            suppressedByQuietHours: true,
          };
        }

        const isHighUrgency = incidentRecord.urgency === 'HIGH';
        let primarySuccess = false;
        const successful: Array<{ channel: NotificationChannel }> = [];
        const failed: Array<{ channel: NotificationChannel; outcome: NotificationDeliveryOutcome; error?: string }> = [];

        for (const channel of deliveryChannels) {
          if (primarySuccess) {
            if (isHighUrgency && channel === 'EMAIL') {
              // Continue to send email
            } else {
              continue;
            }
          }

          const result = await sendNotification(
            incidentId,
            userId,
            channel,
            message,
            incidentRecord,
            eventType
          );

          if (result.success) {
            successful.push({ channel });
            logger.info(`[IncidentNotification] Successfully delivered via ${channel}`, {
              incidentId,
              userId,
            });

            if (channel !== 'EMAIL') {
              primarySuccess = true;
            }

            if (!isHighUrgency && primarySuccess) {
              break;
            }
          } else {
            failed.push({
              channel,
              outcome: result.outcome ?? 'RETRYABLE_FAILURE',
              error: result.error,
            });
          }
        }

        return {
          userId,
          success: successful.length > 0,
          outcome:
            successful.length > 0
              ? ('DELIVERED' as const)
              : failed.some(result => isRetryableNotificationOutcome(result.outcome))
                ? ('RETRYABLE_FAILURE' as const)
                : ('PERMANENT_FAILURE' as const),
          channelsUsed: successful.map(r => r.channel),
          errors: failed.map(result => `${result.channel}: ${result.error || 'Failed'}`),
        };
      });

      const notificationResults = await Promise.all(notificationPromises);

      for (const result of notificationResults) {
        deliveryOutcomes.push(result.outcome);
        if (!result.success) {
          errors.push(
            `User ${result.userId}: ${result.error || result.errors?.join(', ') || 'Failed'}`
          );
        }
      }
    }

    // Trigger Service Webhook Integrations (Slack/Generic/Teams)
    // This connects the "User Notification" flow to the "Service Integration" flow
    try {
      const { sendServiceNotifications: sendIntegrationNotifications } =
        await import('./service-notifications');
      const integrationResult = await sendIntegrationNotifications(incidentId, eventType);
      if (!integrationResult.success) {
        deliveryOutcomes.push('RETRYABLE_FAILURE');
        errors.push(
          `Service integrations: ${integrationResult.errors?.join(', ') || 'Delivery failed'}`
        );
      }
    } catch (err) {
      logger.error('Failed to send service integration notifications', {
        component: 'user-notifications',
        error: err,
        serviceId: incidentRecord.serviceId,
        incidentId: incidentRecord.id,
      });
      errors.push(`Service integrations: ${err instanceof Error ? err.message : String(err)}`);
      deliveryOutcomes.push('RETRYABLE_FAILURE');
    }

    if (errors.length > 0) {
      const outcome = deliveryOutcomes.some(isRetryableNotificationOutcome)
        ? 'RETRYABLE_FAILURE'
        : 'PERMANENT_FAILURE';
      return { success: false, outcome, errors };
    }

    return {
      success: true,
      outcome: deliveryOutcomes.includes('DELIVERED') ? 'DELIVERED' : 'SKIPPED',
    };
  } catch (error) {
    logger.error('Service notification error', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return {
      success: false,
      outcome: 'RETRYABLE_FAILURE',
      errors: [error instanceof Error ? error.message : 'Unknown error'],
    };
  }
}
