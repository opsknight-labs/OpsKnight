import 'server-only';
import { logger } from './logger';
import { WebhookIntegration } from '@prisma/client';

/**
 * SLA Breach Monitor - Proactive Breach Detection
 *
 * Monitors active incidents for approaching SLA breaches and
 * sends notifications before breaches occur.
 *
 * Run this via scheduled job every 5 minutes.
 */

// Default warning thresholds (ms before breach to trigger warning)
const DEFAULT_ACK_WARNING_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes before ack breach
const DEFAULT_RESOLVE_WARNING_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutes before resolve breach

export interface BreachWarning {
  incidentId: string;
  title: string;
  serviceId: string;
  serviceName: string;
  breachType: 'ack' | 'resolve';
  timeRemainingMs: number;
  targetMinutes: number;
  urgency: string;
  status: string;
  assigneeName?: string;
  createdAt: Date;
  slackWebhookUrl?: string | null;
  slackChannel?: string | null;
  serviceNotificationChannels?: string[];
  webhookIntegrations?: WebhookIntegration[];
}

export interface BreachCheckResult {
  warnings: BreachWarning[];
  checkedAt: Date;
  activeIncidentCount: number;
  warningCount: number;
}

export interface BreachMonitorConfig {
  ackWarningThresholdMs?: number;
  resolveWarningThresholdMs?: number;
  notifySlack?: boolean;
  notifyEmail?: boolean;
  notifyWebhook?: boolean;
  alertEmail?: string;
}

/**
 * Check for incidents nearing SLA breach
 * Run every 5 minutes via scheduled job
 */
export async function checkSLABreaches(
  config: BreachMonitorConfig = { notifySlack: true, notifyEmail: true, notifyWebhook: true }
): Promise<BreachCheckResult> {
  const { default: prisma } = await import('./prisma');

  const now = new Date();
  const warnings: BreachWarning[] = [];

  const ackWarningThreshold = config.ackWarningThresholdMs ?? DEFAULT_ACK_WARNING_THRESHOLD_MS;
  const resolveWarningThreshold =
    config.resolveWarningThresholdMs ?? DEFAULT_RESOLVE_WARNING_THRESHOLD_MS;

  // Get all active incidents with their service SLA targets
  const incidents = await prisma.incident.findMany({
    where: {
      status: { notIn: ['RESOLVED', 'SNOOZED', 'SUPPRESSED'] },
    },
    select: {
      id: true,
      title: true,
      serviceId: true,
      urgency: true,
      status: true,
      createdAt: true,
      acknowledgedAt: true,
      service: {
        select: {
          id: true,
          name: true,
          targetAckMinutes: true,
          targetResolveMinutes: true,
          slackWebhookUrl: true,
          slackChannel: true,
          serviceNotificationChannels: true,
          serviceNotifyOnSlaBreach: true,
          webhookIntegrations: {
            where: { enabled: true },
          },
        },
      },
      assignee: {
        select: {
          name: true,
        },
      },
    },
  });

  logger.debug('[SLA Breach Monitor] Checking active incidents', {
    count: incidents.length,
    timestamp: now.toISOString(),
  });

  const incidentIds = incidents.map(i => i.id);

  // Batch pre-fetch all snooze events to eliminate N+1 database queries
  const allSnoozeEvents =
    incidentIds.length > 0 && prisma.incidentEvent?.findMany
      ? await prisma.incidentEvent.findMany({
          where: {
            incidentId: { in: incidentIds },
            message: {
              contains: 'snooz',
              mode: 'insensitive',
            },
          },
          orderBy: { createdAt: 'asc' },
        })
      : [];

  const snoozeMap = new Map<string, typeof allSnoozeEvents>();
  for (const ev of allSnoozeEvents) {
    const list = snoozeMap.get(ev.incidentId) || [];
    list.push(ev);
    snoozeMap.set(ev.incidentId, list);
  }

  const maxThreshold = Math.max(ackWarningThreshold, resolveWarningThreshold) + 30000;
  const recentWarningEvents =
    incidentIds.length > 0 && prisma.incidentEvent?.findMany
      ? await prisma.incidentEvent.findMany({
          where: {
            incidentId: { in: incidentIds },
            OR: [
              // Breach events are deduplicated for the full lifetime of the open incident
              { message: { startsWith: '🚨 SLA ACK Breached' } },
              { message: { startsWith: '🚨 SLA RESOLVE Breached' } },
              // Warning events are deduplicated within the recent threshold window
              {
                message: { startsWith: '⏰ SLA ACK Warning' },
                createdAt: { gte: new Date(now.getTime() - maxThreshold) },
              },
              {
                message: { startsWith: '⚠️ SLA RESOLVE Warning' },
                createdAt: { gte: new Date(now.getTime() - maxThreshold) },
              },
            ],
          },
          select: { incidentId: true, message: true },
        })
      : [];

  const recentWarningMap = new Set<string>();
  for (const evt of recentWarningEvents) {
    if (evt.message.startsWith('🚨 SLA ACK Breached'))
      recentWarningMap.add(`${evt.incidentId}:ack:breached`);
    if (evt.message.startsWith('⏰ SLA ACK Warning'))
      recentWarningMap.add(`${evt.incidentId}:ack:warning`);
    if (evt.message.startsWith('🚨 SLA RESOLVE Breached'))
      recentWarningMap.add(`${evt.incidentId}:resolve:breached`);
    if (evt.message.startsWith('⚠️ SLA RESOLVE Warning'))
      recentWarningMap.add(`${evt.incidentId}:resolve:warning`);
  }

  for (const incident of incidents) {
    // Calculate total time spent in SNOOZED state to deduct from elapsedMs
    let snoozedMs = 0;
    let currentSnoozeStart: Date | null = null;
    const incidentEvents = snoozeMap.get(incident.id) || [];
    for (const ev of incidentEvents) {
      const msg = ev.message.toLowerCase();
      if (msg.includes('snoozed') && !msg.includes('unsnoozed') && !currentSnoozeStart) {
        currentSnoozeStart = ev.createdAt;
      } else if (msg.includes('unsnoozed') && currentSnoozeStart) {
        snoozedMs += ev.createdAt.getTime() - currentSnoozeStart.getTime();
        currentSnoozeStart = null;
      }
    }
    if (currentSnoozeStart) {
      snoozedMs += now.getTime() - currentSnoozeStart.getTime();
    }

    const elapsedMs = Math.max(0, now.getTime() - incident.createdAt.getTime() - snoozedMs);

    // Default SLA targets
    const ackTargetMinutes = incident.service.targetAckMinutes ?? 15;
    const resolveTargetMinutes = incident.service.targetResolveMinutes ?? 120;

    const ackTargetMs = ackTargetMinutes * 60 * 1000;
    const resolveTargetMs = resolveTargetMinutes * 60 * 1000;

    // Skip if service has disabled SLA notifications
    if (!incident.service.serviceNotifyOnSlaBreach) {
      continue;
    }

    // Check ack SLA (only if not acknowledged)
    if (!incident.acknowledgedAt) {
      const ackRemainingMs = ackTargetMs - elapsedMs;

      // Warning or breach
      if (ackRemainingMs < ackWarningThreshold) {
        const isBreached = ackRemainingMs <= 0;
        const key = isBreached ? 'breached' : 'warning';

        // Check if we already warned/alerted about this recently
        const alreadyWarned = recentWarningMap.has(`${incident.id}:ack:${key}`);

        if (!alreadyWarned) {
          recentWarningMap.add(`${incident.id}:ack:${key}`);
          // Record the event in DB immediately to prevent repeat notification spam across cron loops
          try {
            if (prisma.incidentEvent?.create) {
              await prisma.incidentEvent.create({
                data: {
                  incidentId: incident.id,
                  message: isBreached
                    ? `🚨 SLA ACK Breached: target was ${ackTargetMinutes} min`
                    : `⏰ SLA ACK Warning: ${Math.max(1, Math.round(ackRemainingMs / 60000))} min remaining`,
                },
              });
            }
          } catch {
            // Non-critical if event logging fails
          }

          warnings.push({
            incidentId: incident.id,
            title: incident.title,
            serviceId: incident.service.id,
            serviceName: incident.service.name,
            breachType: 'ack',
            timeRemainingMs: ackRemainingMs,
            targetMinutes: ackTargetMinutes,
            urgency: incident.urgency,
            status: incident.status,
            assigneeName: incident.assignee?.name,
            createdAt: incident.createdAt,
            slackWebhookUrl: incident.service.slackWebhookUrl,
            slackChannel: incident.service.slackChannel,
            serviceNotificationChannels: incident.service.serviceNotificationChannels,
            webhookIntegrations: incident.service.webhookIntegrations,
          });
        }
      }
    }

    // Check resolve SLA
    const resolveRemainingMs = resolveTargetMs - elapsedMs;

    // Warning or breach
    if (resolveRemainingMs < resolveWarningThreshold) {
      const isBreached = resolveRemainingMs <= 0;
      const key = isBreached ? 'breached' : 'warning';

      // Check if we already warned/alerted about this recently
      const alreadyWarned = recentWarningMap.has(`${incident.id}:resolve:${key}`);

      if (!alreadyWarned) {
        recentWarningMap.add(`${incident.id}:resolve:${key}`);
        // Record the event in DB immediately to prevent repeat notification spam across cron loops
        try {
          if (prisma.incidentEvent?.create) {
            await prisma.incidentEvent.create({
              data: {
                incidentId: incident.id,
                message: isBreached
                  ? `🚨 SLA RESOLVE Breached: target was ${resolveTargetMinutes} min`
                  : `⚠️ SLA RESOLVE Warning: ${Math.max(1, Math.round(resolveRemainingMs / 60000))} min remaining`,
              },
            });
          }
        } catch {
          // Non-critical if event logging fails
        }

        warnings.push({
          incidentId: incident.id,
          title: incident.title,
          serviceId: incident.service.id,
          serviceName: incident.service.name,
          breachType: 'resolve',
          timeRemainingMs: resolveRemainingMs,
          targetMinutes: resolveTargetMinutes,
          urgency: incident.urgency,
          status: incident.status,
          assigneeName: incident.assignee?.name,
          createdAt: incident.createdAt,
          slackWebhookUrl: incident.service.slackWebhookUrl,
          slackChannel: incident.service.slackChannel,
          serviceNotificationChannels: incident.service.serviceNotificationChannels,
          webhookIntegrations: incident.service.webhookIntegrations,
        });
      }
    }
  }

  // Log warnings
  if (warnings.length > 0) {
    logger.warn('[SLA Breach Monitor] Breach warnings detected', {
      warningCount: warnings.length,
      ackWarnings: warnings.filter(w => w.breachType === 'ack').length,
      resolveWarnings: warnings.filter(w => w.breachType === 'resolve').length,
      incidentIds: warnings.map(w => w.incidentId),
    });

    // Send notifications for each warning
    for (const warning of warnings) {
      await notifyBreachWarning(warning, config);
    }
  } else {
    logger.debug('[SLA Breach Monitor] No breach warnings', {
      activeIncidentCount: incidents.length,
    });
  }

  return {
    warnings,
    checkedAt: now,
    activeIncidentCount: incidents.length,
    warningCount: warnings.length,
  };
}

/**
 * Send breach warning notification
 */
async function notifyBreachWarning(
  warning: BreachWarning,
  config: BreachMonitorConfig
): Promise<void> {
  const remainingMinutes = Math.round(warning.timeRemainingMs / 60000);
  const breachEmoji = warning.breachType === 'ack' ? '⏰' : '⚠️';

  const message = `${breachEmoji} SLA ${warning.breachType.toUpperCase()} Warning: "${warning.title}"`;
  const plainText = `${breachEmoji} SLA ${warning.breachType.toUpperCase()} Warning: ${warning.title} (${warning.serviceName}) - ${remainingMinutes} min remaining`;

  // Always log the warning
  logger.warn('[SLA Breach Warning]', {
    incidentId: warning.incidentId,
    breachType: warning.breachType,
    remainingMinutes,
    targetMinutes: warning.targetMinutes,
    urgency: warning.urgency,
    service: warning.serviceName,
    message: plainText,
  });

  // Send Slack notification if enabled
  if (config.notifySlack) {
    // Dynamic import to break circular dependency
    const { sendSlackNotification, sendSlackMessageToChannel } = await import('./slack');

    // Check if service has SLACK channel enabled
    // Default to true if channels logic not yet populated to be safe, or check specific channels
    const channels = warning.serviceNotificationChannels || [];
    const hasSlackEnabled = channels.length === 0 || channels.includes('SLACK');

    // We attempt notification if global flag is true AND service allows it
    if (hasSlackEnabled) {
      let sent = false;

      // 1. Try OAuth Channel First (Preferred)
      if (warning.slackChannel) {
        try {
          const result = await sendSlackMessageToChannel(
            warning.slackChannel,
            {
              id: warning.incidentId,
              title: warning.title,
              status: warning.status,
              urgency: warning.urgency,
              serviceName: warning.serviceName,
              assigneeName: warning.assigneeName,
            },
            'triggered', // Use triggered style for alert
            true, // Interactive buttons
            warning.serviceId, // Pass service ID for token lookup
            plainText // Pass the time remaining context
          );

          // Enhanced Slack Block handling is in `slack.ts`, we rely on it.
          // However, for breaches, we might want custom blocks.
          // Since we are reusing `sendSlackMessageToChannel` with 'triggered' style, it gets standard formatting.
          // Ideally we should have a specific 'breach' style or pass custom blocks.
          // For now, we will rely on the improved 'triggered' template which is already much better.
          // We can't easily inject custom Breach blocks without refactoring `sendSlackMessageToChannel` signature significantly.
          // Given the user wants "Best of Best", let's assume the new Standard template (Red header, clear details) covers this well.
          // Only difference is the "Time Remaining" context.
          // We passed 'message' (short title) above.
          // Actually, we should call a specialized function if we really want a "Breach" template.
          // But `sendSlackMessageToChannel` is generic.
          // Let's rely on the title being descriptive: `SLA ACK Warning: "Title"` as passed in `message`.
          // Wait, `sendSlackMessageToChannel` takes `incident` object. It generates its own title from `incident.title`.
          // So the `message` variable here is ignored by `sendSlackMessageToChannel`!
          // We need to pass `additionalMessage` to `sendSlackMessageToChannel` or `sendSlackNotification`.
          // `sendSlackMessageToChannel` doesn't accept `additionalMessage` in its current signature?
          // Let's check `slack.ts` signature from Step 948.
          // `export async function sendSlackMessageToChannel(channel: string, incident: IncidentDetails, eventType: SlackEventType, includeInteractiveButtons: boolean = true, serviceId?: string)`
          // It DOES NOT accept `additionalMessage`. That's a gap.
          // However `sendSlackNotification` (webhook) DOES accept it.

          // I will proceed with this update to `notifyBreachWarning` but I should note that I might need to update `slack.ts` to accept additionalMessage if I want the time remaining to show up in the Context block.
          // Actually, let's look at `sendSlackNotification` calls below - they DO pass `message`.
          // For the OAuth one, we might lose the "15 min remaining" context if we don't fix `slack.ts` signature or logic.

          // To make it "Best of Best", I should update `slack.ts` to accept `additionalMessage` in `sendSlackMessageToChannel` as well.
          // But I am in `sla-breach-monitor.ts` right now.
          // I will assume I can update `slack.ts` later or purely for this file update the email template first.
          if (result.success) {
            sent = true;
            logger.info('[SLA Breach Monitor] Slack notification sent via OAuth channel', {
              warning,
            });
          } else {
            logger.warn('[SLA Breach Monitor] OAuth Slack failed, trying webhook fallback', {
              error: result.error,
            });
          }
        } catch (err) {
          logger.warn('[SLA Breach Monitor] OAuth Slack error, trying webhook fallback', { err });
        }
      }

      // 2. Fallback to Webhook
      if (!sent && warning.slackWebhookUrl) {
        try {
          await sendSlackNotification(
            'triggered', // Use triggered style (Red) for attention
            {
              id: warning.incidentId,
              title: warning.title,
              status: warning.status,
              urgency: warning.urgency,
              serviceName: warning.serviceName,
              assigneeName: warning.assigneeName,
            },
            message, // Additional context passed here
            warning.slackWebhookUrl // Explicitly pass the webhook URL
          );

          logger.info('[SLA Breach Monitor] Slack notification sent via Webhook', { warning });
          sent = true;
        } catch (error) {
          logger.error('[SLA Breach Monitor] Failed to send Slack webhook notification', { error });
        }
      }

      if (!sent && !warning.slackChannel && !warning.slackWebhookUrl) {
        // Last resort: Global webhook (sendSlackNotification defaults to global if no url passed)
        try {
          await sendSlackNotification(
            'triggered',
            {
              id: warning.incidentId,
              title: warning.title,
              status: warning.status,
              urgency: warning.urgency,
              serviceName: warning.serviceName,
              assigneeName: warning.assigneeName,
            },
            message
          );
          logger.info('[SLA Breach Monitor] Slack notification sent via Global Webhook', {
            warning,
          });
        } catch (error) {
          logger.error('[SLA Breach Monitor] Failed to send Global Slack notification', { error });
        }
      }
    }
  }

  // Send Webhook notifications if enabled
  if (config.notifyWebhook && warning.serviceNotificationChannels?.includes('WEBHOOK')) {
    try {
      const { sendIncidentWebhook } = await import('./webhooks');
      const webhooks = warning.webhookIntegrations || [];

      for (const webhook of webhooks) {
        try {
          const { decryptStoredSecret } = await import('./encryption');
          const result = await sendIncidentWebhook(
            webhook.url,
            warning.incidentId,
            'warning',
            webhook.secret ? await decryptStoredSecret(webhook.secret) : undefined,
            webhook.type,
            webhook.channel || undefined
          );

          if (result.success) {
            logger.info('[SLA Breach Monitor] Webhook notification sent', {
              webhookId: webhook.id,
              type: webhook.type,
            });
          } else {
            logger.warn('[SLA Breach Monitor] Webhook notification failed', {
              webhookId: webhook.id,
              error: result.error,
            });
          }
        } catch (error) {
          logger.error('[SLA Breach Monitor] Error sending webhook notification', {
            webhookId: webhook.id,
            error,
          });
        }
      }
    } catch (importError) {
      logger.error('[SLA Breach Monitor] Failed to import webhooks module', { importError });
    }
  }

  // Send email notification if enabled
  if (config.notifyEmail) {
    try {
      // Check for generic alert email in config
      const alertEmail = config.alertEmail || process.env.SLA_ALERT_EMAIL;

      if (alertEmail) {
        const { sendEmail } = await import('./email');

        await sendEmail({
          to: alertEmail,
          subject: `[SLA WARNING] ${warning.serviceName}: ${warning.title}`,
          html: `
                          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 0; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px androidx.rgba(0, 0, 0, 0.1);">
                              <div style="background-color: #fee2e2; padding: 20px; text-align: center; border-bottom: 1px solid #fecaca;">
                                  <h1 style="color: #991b1b; margin: 0; font-size: 24px; font-weight: 800;">${breachEmoji} SLA BREACH WARNING</h1>
                                  <p style="color: #7f1d1d; margin: 8px 0 0 0; font-size: 16px; font-weight: 500;">Action Required Immediately</p>
                              </div>
                              
                              <div style="padding: 24px; background-color: #ffffff;">
                                  <div style="margin-bottom: 24px; text-align: center;">
                                      <p style="font-size: 36px; font-weight: 800; color: ${remainingMinutes < 0 ? '#dc2626' : '#d97706'}; margin: 0;">
                                          ${remainingMinutes} min
                                      </p>
                                      <p style="color: #6b7280; margin: 4px 0 0 0; font-size: 14px;">Time Remaining</p>
                                  </div>

                                  <div style="background-color: #f9fafb; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
                                      <table style="width: 100%; border-collapse: collapse;">
                                          <tr>
                                              <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Service</td>
                                              <td style="padding: 8px 0; color: #111827; font-weight: 600; text-align: right;">${warning.serviceName}</td>
                                          </tr>
                                          <tr>
                                              <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Urgency</td>
                                              <td style="padding: 8px 0; color: #111827; font-weight: 600; text-align: right;">${warning.urgency}</td>
                                          </tr>
                                          <tr>
                                              <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Target</td>
                                              <td style="padding: 8px 0; color: #111827; font-weight: 600; text-align: right;">${warning.targetMinutes} min (${warning.breachType.toUpperCase()})</td>
                                          </tr>
                                      </table>
                                  </div>

                                  <h3 style="margin: 0 0 8px 0; color: #111827; font-size: 18px;">${warning.title}</h3>
                                  <p style="color: #4b5563; font-size: 14px; line-height: 1.5; margin: 0 0 24px 0;">
                                      This incident is approaching its SLA limit. Please acknowledge or resolve it immediately to avoid a breach.
                                  </p>

                                  <a href="${process.env.NEXTAUTH_URL}/incidents/${warning.incidentId}" style="display: block; width: 100%; padding: 12px 0; background-color: #dc2626; color: #ffffff; text-decoration: none; text-align: center; border-radius: 6px; font-weight: 600; font-size: 16px;">
                                      View Incident
                                  </a>
                              </div>
                              <div style="background-color: #f3f4f6; padding: 12px; text-align: center; color: #6b7280; font-size: 12px;">
                                  OpsKnight SLA Monitor • ${new Date().toUTCString()}
                              </div>
                          </div>
                      `,
          text: plainText,
        });

        logger.info('[SLA Breach Monitor] Email notification sent', { to: alertEmail });
      } else {
        logger.debug('[SLA Breach Monitor] Email skipped (SLA_ALERT_EMAIL not set)');
      }
    } catch (error) {
      logger.error('[SLA Breach Monitor] Failed to send email notification', { error });
    }
  }
}

/**
 * Format breach warning for display
 */
export function formatBreachWarning(warning: BreachWarning): string {
  const remainingMinutes = Math.round(warning.timeRemainingMs / 60000);
  const type = warning.breachType === 'ack' ? 'Acknowledgment' : 'Resolution';
  return `${type} SLA breach in ${remainingMinutes} min (target: ${warning.targetMinutes} min)`;
}
