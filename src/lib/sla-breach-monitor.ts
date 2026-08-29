import 'server-only';
import { logger } from './logger';
import { WebhookIntegration } from '@prisma/client';
import { getPrioritySLATarget } from './sla-priority';
import { escapeHtml } from './email-components';
import { activeIncidentStatuses } from './incident-status';

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
      status: { in: activeIncidentStatuses() },
    },
    select: {
      id: true,
      title: true,
      serviceId: true,
      urgency: true,
      priority: true,
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
              { message: { contains: 'SLA ACK Breached', mode: 'insensitive' } },
              { message: { contains: 'SLA RESOLVE Breached', mode: 'insensitive' } },
              // Warning events are deduplicated within the recent threshold window
              {
                message: { contains: 'SLA ACK Warning', mode: 'insensitive' },
                createdAt: { gte: new Date(now.getTime() - maxThreshold) },
              },
              {
                message: { contains: 'SLA RESOLVE Warning', mode: 'insensitive' },
                createdAt: { gte: new Date(now.getTime() - maxThreshold) },
              },
            ],
          },
          select: { incidentId: true, message: true },
        })
      : [];

  const recentWarningMap = new Set<string>();
  for (const evt of recentWarningEvents) {
    const msg = (evt.message || '').toUpperCase();
    if (msg.includes('SLA ACK BREACHED')) recentWarningMap.add(`${evt.incidentId}:ack:breached`);
    if (msg.includes('SLA ACK WARNING')) recentWarningMap.add(`${evt.incidentId}:ack:warning`);
    if (msg.includes('SLA RESOLVE BREACHED'))
      recentWarningMap.add(`${evt.incidentId}:resolve:breached`);
    if (msg.includes('SLA RESOLVE WARNING'))
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

    // Resolve priority SLA targets (e.g. P1 = 5m ack / 60m resolve)
    const targets = getPrioritySLATarget(incident.priority, incident.service);
    const ackTargetMinutes = targets.ack;
    const resolveTargetMinutes = targets.resolve;

    const ackTargetMs = ackTargetMinutes * 60 * 1000;
    const resolveTargetMs = resolveTargetMinutes * 60 * 1000;

    // Skip if service has disabled SLA notifications
    if (!incident.service.serviceNotifyOnSlaBreach) {
      continue;
    }

    // Proportional early warning thresholds (e.g. 25% remaining or configured ceiling)
    const effectiveAckWarning = Math.min(ackWarningThreshold, ackTargetMs * 0.25);
    const effectiveResolveWarning = Math.min(resolveWarningThreshold, resolveTargetMs * 0.25);

    // Check ack SLA (only if not acknowledged)
    if (!incident.acknowledgedAt) {
      const ackRemainingMs = ackTargetMs - elapsedMs;

      // Warning or breach
      if (ackRemainingMs < effectiveAckWarning) {
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
                  type: isBreached ? 'ESCALATED' : 'COMMENT',
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
    if (resolveRemainingMs < effectiveResolveWarning) {
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
                type: isBreached ? 'ESCALATED' : 'COMMENT',
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
  const isBreached = warning.timeRemainingMs <= 0;
  const remainingMinutes = Math.round(warning.timeRemainingMs / 60000);
  const breachEmoji = isBreached ? '🚨' : warning.breachType === 'ack' ? '⏰' : '⚠️';
  const breachAction = isBreached ? 'BREACHED' : 'WARNING';
  const breachTypeUpper = warning.breachType.toUpperCase();

  const message = `${breachEmoji} SLA ${breachTypeUpper} ${breachAction}: "${warning.title}"`;
  const plainText = isBreached
    ? `🚨 SLA ${breachTypeUpper} BREACHED: ${warning.serviceName} - "${warning.title}" has breached its ${warning.targetMinutes} minute SLA target.`
    : `⚠️ SLA ${breachTypeUpper} WARNING: ${warning.serviceName} - "${warning.title}" has ${remainingMinutes} minutes remaining before SLA breach.`;

  logger.warn(`[SLA Breach ${breachAction}]`, {
    incidentId: warning.incidentId,
    breachType: warning.breachType,
    remainingMinutes,
    targetMinutes: warning.targetMinutes,
    urgency: warning.urgency,
    service: warning.serviceName,
    message: plainText,
  });

  // 1. Send Slack notification if enabled
  if (config.notifySlack) {
    const { sendSlackNotification, sendSlackMessageToChannel } = await import('./slack');
    const channels = warning.serviceNotificationChannels || [];
    const hasSlackEnabled = channels.length === 0 || channels.includes('SLACK');

    if (hasSlackEnabled) {
      let sent = false;

      // Try OAuth Channel First
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
            'triggered',
            true,
            warning.serviceId
          );

          if (result.success) {
            sent = true;
            logger.info('[SLA Breach Monitor] Slack notification sent via OAuth channel', {
              warning,
            });
          }
        } catch (err) {
          logger.warn('[SLA Breach Monitor] OAuth Slack error, trying webhook fallback', { err });
        }
      }

      // Fallback to Service Webhook
      if (!sent && warning.slackWebhookUrl) {
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
            message,
            warning.slackWebhookUrl
          );
          sent = true;
          logger.info('[SLA Breach Monitor] Slack notification sent via Service Webhook', {
            warning,
          });
        } catch (error) {
          logger.error('[SLA Breach Monitor] Failed to send Slack webhook notification', { error });
        }
      }

      // Last resort: Global webhook
      if (!sent && !warning.slackChannel && !warning.slackWebhookUrl) {
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

  // 2. Send Webhook notifications if enabled
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
            isBreached ? 'triggered' : 'warning',
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

  // 3. Send email notification if enabled
  if (config.notifyEmail) {
    try {
      const alertEmail = config.alertEmail || process.env.SLA_ALERT_EMAIL;

      if (alertEmail) {
        const { sendEmail } = await import('./email');
        const safeServiceName = escapeHtml(warning.serviceName);
        const safeTitle = escapeHtml(warning.title);
        const safeUrgency = escapeHtml(warning.urgency);
        const baseUrl = (process.env.NEXTAUTH_URL || '').replace(/\/+$/, '');
        const incidentUrl = `${baseUrl}/incidents/${encodeURIComponent(warning.incidentId)}`;

        await sendEmail({
          to: alertEmail,
          subject: isBreached
            ? `[SLA BREACHED] ${warning.serviceName}: ${warning.title}`
            : `[SLA WARNING] ${warning.serviceName}: ${warning.title}`,
          html: `
                          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 0; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
                              <div style="background-color: ${isBreached ? '#fee2e2' : '#fef3c7'}; padding: 20px; text-align: center; border-bottom: 1px solid ${isBreached ? '#fecaca' : '#fde68a'};">
                                  <h1 style="color: ${isBreached ? '#991b1b' : '#92400e'}; margin: 0; font-size: 24px; font-weight: 800;">${breachEmoji} SLA ${breachTypeUpper} ${breachAction}</h1>
                                  <p style="color: ${isBreached ? '#7f1d1d' : '#78350f'}; margin: 8px 0 0 0; font-size: 16px; font-weight: 500;">Action Required Immediately</p>
                              </div>
                              
                              <div style="padding: 24px; background-color: #ffffff;">
                                  <div style="margin-bottom: 24px; text-align: center;">
                                      <p style="font-size: 36px; font-weight: 800; color: ${isBreached ? '#dc2626' : '#d97706'}; margin: 0;">
                                          ${isBreached ? 'BREACHED' : `${remainingMinutes} min`}
                                      </p>
                                      <p style="color: #6b7280; margin: 4px 0 0 0; font-size: 14px;">${isBreached ? 'SLA Status' : 'Time Remaining'}</p>
                                  </div>

                                  <div style="background-color: #f9fafb; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
                                      <table style="width: 100%; border-collapse: collapse;">
                                          <tr>
                                              <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Service</td>
                                              <td style="padding: 8px 0; color: #111827; font-weight: 600; text-align: right;">${safeServiceName}</td>
                                          </tr>
                                          <tr>
                                              <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Urgency</td>
                                              <td style="padding: 8px 0; color: #111827; font-weight: 600; text-align: right;">${safeUrgency}</td>
                                          </tr>
                                          <tr>
                                              <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Target</td>
                                              <td style="padding: 8px 0; color: #111827; font-weight: 600; text-align: right;">${warning.targetMinutes} min (${breachTypeUpper})</td>
                                          </tr>
                                      </table>
                                  </div>

                                  <h3 style="margin: 0 0 8px 0; color: #111827; font-size: 18px;">${safeTitle}</h3>
                                  <p style="color: #4b5563; font-size: 14px; line-height: 1.5; margin: 0 0 24px 0;">
                                      ${isBreached ? 'This incident has exceeded its SLA target deadline. Immediate triage and resolution are required.' : 'This incident is approaching its SLA limit. Please acknowledge or resolve it immediately to avoid a breach.'}
                                  </p>

                                  <a href="${incidentUrl}" style="display: block; width: 100%; padding: 12px 0; background-color: #dc2626; color: #ffffff; text-decoration: none; text-align: center; border-radius: 6px; font-weight: 600; font-size: 16px;">
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
