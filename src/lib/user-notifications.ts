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
import { isChannelAvailable, getEmailConfig } from './notification-providers';
import { createInAppNotifications } from './in-app-notifications';
import { logger } from './logger';

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
  escalationChannels?: NotificationChannel[]
): Promise<{ success: boolean; channelsUsed: NotificationChannel[]; errors?: string[] }> {
  // Create In-App Notification first
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

  let channels: NotificationChannel[];
  // ... rest of function
  const userChannels = await getUserNotificationChannels(userId);

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
    prisma.user.findUnique({ where: { id: userId }, select: { timeZone: true } }),
  ]);
  const isHighUrgency = incident?.urgency === 'HIGH';
  if (incident?.urgency === 'LOW') {
    const localParts = new Intl.DateTimeFormat('en-US', {
      timeZone: recipient?.timeZone || 'UTC',
      weekday: 'short',
      hour: 'numeric',
      hourCycle: 'h23',
    }).formatToParts(new Date());
    const weekday = localParts.find(part => part.type === 'weekday')?.value;
    const hour = Number(localParts.find(part => part.type === 'hour')?.value || 0) % 24;
    const offHours = weekday === 'Sat' || weekday === 'Sun' || hour < 8 || hour >= 18;
    if (offHours) {
      channels = channels.filter(channel => !['PUSH', 'SMS', 'WHATSAPP'].includes(channel));
    }
  }

  let primarySuccess = false;

  for (const channel of channels) {
    if (!isHighUrgency && primarySuccess) {
      break;
    }

    const result = await sendNotification(incidentId, userId, channel, message);
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

  // Fallback: If all primary specified channels failed, attempt delivery via user's other available channels
  if (channelsUsed.length === 0 && userChannels.length > 0) {
    const fallbackChannels = userChannels.filter(ch => !channels.includes(ch));
    for (const fbChannel of fallbackChannels) {
      const fbResult = await sendNotification(incidentId, userId, fbChannel, message);
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
  incident?: any // eslint-disable-line @typescript-eslint/no-explicit-any
): Promise<{ success: boolean; errors?: string[] }> {
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
          assignee: true,
        },
      }));

    if (!incidentData || !incidentData.service) {
      // Use incidentData instead of incident
      return { success: false, errors: ['Incident or service not found'] };
    }

    // Use incidentData for the rest of the function
    const incidentRecord = incidentData;

    const errors: string[] = [];
    const recipients: string[] = [];

    // Add assignee if exists
    if (incidentRecord.assigneeId) {
      recipients.push(incidentRecord.assigneeId);
    }

    // Add service team members if team exists
    if (incidentRecord.service.team) {
      const teamUserIds = incidentRecord.service.team.members.map(
        (m: { userId: string }) => m.userId
      );
      recipients.push(...teamUserIds);
    }

    // Remove duplicates
    const uniqueRecipients = [...new Set(recipients)].filter(id => !excludeUserIds.includes(id));

    const eventTitle =
      eventType === 'triggered'
        ? 'New Incident'
        : eventType === 'acknowledged'
          ? 'Incident Acknowledged'
          : eventType === 'resolved'
            ? 'Incident Resolved'
            : 'Incident Updated';
    const eventMessage = `[${incidentRecord.service.name}] ${incidentRecord.title}`;

    if (uniqueRecipients.length > 0) {
      await createInAppNotifications({
        userIds: uniqueRecipients,
        type: 'INCIDENT',
        title: eventTitle,
        message: eventMessage,
        entityType: 'INCIDENT',
        entityId: incidentRecord.id,
      });
    }

    if (uniqueRecipients.length > 0) {
      // Batch fetch user notification preferences to avoid N+1 queries
      const users = await prisma.user.findMany({
        where: { id: { in: uniqueRecipients } },
        select: {
          id: true,
          emailNotificationsEnabled: true,
          smsNotificationsEnabled: true,
          pushNotificationsEnabled: true,
          whatsappNotificationsEnabled: true,
          phoneNumber: true,
          email: true,
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
      const message = `[${incidentRecord.service.name}] Incident ${eventType}: ${incidentRecord.title}`;
      const notificationPromises = uniqueRecipients.map(async userId => {
        const user = userMap.get(userId);
        if (!user) {
          return { userId, success: false, error: 'User not found' };
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
            success: false,
            error:
              'User has not enabled any notification channels. Please configure notification preferences in Settings.',
          };
        }

        const isHighUrgency = incidentRecord.urgency === 'HIGH';
        let primarySuccess = false;
        const successful = [];
        const failed = [];

        for (const channel of channels) {
          if (primarySuccess) {
            if (isHighUrgency && channel === 'EMAIL') {
              // Continue to send email
            } else {
              continue;
            }
          }

          const result = await sendNotification(incidentId, userId, channel, message);

          if (result.success) {
            successful.push({ channel, result });
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
            failed.push({ channel, result });
          }
        }

        return {
          userId,
          success: successful.length > 0,
          channelsUsed: successful.map(r => r.channel),
          errors: failed.map(r => `${r.channel}: ${r.result.error || 'Failed'}`),
        };
      });

      const notificationResults = await Promise.all(notificationPromises);

      for (const result of notificationResults) {
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
      await sendIntegrationNotifications(incidentId, eventType);
    } catch (err) {
      logger.error('Failed to send service integration notifications', {
        component: 'user-notifications',
        error: err,
        serviceId: incidentRecord.serviceId,
        incidentId: incidentRecord.id,
      });
      // Don't block the response, just log it
    }

    return {
      success: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
    };
  } catch (error) {
    logger.error('Service notification error', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return { success: false, errors: [error instanceof Error ? error.message : 'Unknown error'] };
  }
}
