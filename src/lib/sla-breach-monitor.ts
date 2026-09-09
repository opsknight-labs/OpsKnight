import 'server-only';
import { logger } from './logger';
import { WebhookIntegration } from '@prisma/client';
import { projectIncidentSlaState } from '@/lib/incident-sla/state';
import { DEFAULT_SLA_WARNING_POLICY } from '@/lib/incident-sla/warning-policy';
import { escapeHtml } from './email-components';
import { activeIncidentStatuses } from './incident-status';
import { enqueueCentralNotification } from './notification-control-plane';
import { formatWebhookPayloadByType } from './webhooks';
import { getBaseUrl } from './env-validation';
import { configuredSlackWebhookUrl } from './slack';
import { deriveNextSlaTransition } from '@/lib/incident-sla/next-transition';
import {
  addOperationalMetric,
  observeOperationalHistogram,
} from '@/lib/metrics/operational/registry';

/**
 * SLA Breach Monitor - Proactive Breach Detection
 *
 * Monitors active incidents for approaching SLA breaches and
 * sends notifications before breaches occur.
 *
 * Run this via scheduled job every 5 minutes.
 */

// Default warning thresholds (ms before breach to trigger warning)

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

  const warningPolicy = {
    ...DEFAULT_SLA_WARNING_POLICY,
    ackCeilingMs: config.ackWarningThresholdMs ?? DEFAULT_SLA_WARNING_POLICY.ackCeilingMs,
    resolveCeilingMs:
      config.resolveWarningThresholdMs ?? DEFAULT_SLA_WARNING_POLICY.resolveCeilingMs,
  };
  const ackWarningThreshold = warningPolicy.ackCeilingMs;
  const resolveWarningThreshold = warningPolicy.resolveCeilingMs;

  // Get all active incidents with their service SLA targets
  const indexedScheduler = process.env.INDEXED_SLA_SCHEDULER === 'true';
  const incidents = await prisma.incident.findMany({
    where: {
      status: { in: activeIncidentStatuses() },
      ...(indexedScheduler
        ? { OR: [{ nextSlaTransitionAt: { lte: now } }, { nextSlaTransitionAt: null }] }
        : {}),
    },
    ...(indexedScheduler
      ? { orderBy: { nextSlaTransitionAt: { sort: 'asc', nulls: 'first' } }, take: 500 }
      : {}),
    select: {
      id: true,
      title: true,
      serviceId: true,
      urgency: true,
      priority: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      acknowledgedAt: true,
      resolvedAt: true,
      slaAckTargetMs: true,
      slaResolveTargetMs: true,
      slaTargetSource: true,
      slaTargetCapturedAt: true,
      slaPausedMs: true,
      slaPauseStartedAt: true,
      slaAckElapsedMs: true,
      slaResolveElapsedMs: true,
      nextSlaTransitionAt: true,
      nextSlaTransitionKind: true,
      service: {
        select: {
          id: true,
          name: true,
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
    if (!incident.service.serviceNotifyOnSlaBreach) continue;
    const state = projectIncidentSlaState(incident, { now, warningPolicy });
    if (!state.valid) {
      addOperationalMetric('opsknight_sla_projection_invalid_total', 1, {
        reason_category: state.reason.toLowerCase().includes('target') ? 'target' : 'contract',
      });
      logger.warn('[SLA Breach Monitor] Invalid captured incident SLA contract', {
        reason: state.reason,
      });
      continue;
    }
    if (
      indexedScheduler &&
      incident.nextSlaTransitionAt &&
      incident.nextSlaTransitionKind &&
      incident.nextSlaTransitionAt <= now
    ) {
      observeOperationalHistogram(
        'opsknight_sla_transition_lag_seconds',
        (now.getTime() - incident.nextSlaTransitionAt.getTime()) / 1000,
        { kind: incident.nextSlaTransitionKind }
      );
    }
    const warningCountBeforeIncident = warnings.length;
    for (const [breachType, phase] of [
      ['ack', state.ack],
      ['resolve', state.resolve],
    ] as const) {
      if (phase.warning === 'NONE') continue;
      const key = phase.warning === 'BREACHED' ? 'breached' : 'warning';
      if (recentWarningMap.has(`${incident.id}:${breachType}:${key}`)) continue;
      recentWarningMap.add(`${incident.id}:${breachType}:${key}`);
      warnings.push({
        incidentId: incident.id,
        title: incident.title,
        serviceId: incident.service.id,
        serviceName: incident.service.name,
        breachType,
        timeRemainingMs: phase.remainingMs,
        targetMinutes: phase.targetMs / 60000,
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
    // Never advance past a newly-discovered warning before its durable intent
    // is materialized below. A following tick advances only after its event is visible.
    if (indexedScheduler && warnings.length === warningCountBeforeIncident) {
      const next = deriveNextSlaTransition(incident, now);
      if (
        incident.nextSlaTransitionAt?.getTime() !== next?.at.getTime() ||
        incident.nextSlaTransitionKind !== next?.kind
      ) {
        await prisma.incident.updateMany({
          where: { id: incident.id, updatedAt: incident.updatedAt },
          data: {
            nextSlaTransitionAt: next?.at ?? null,
            nextSlaTransitionKind: next?.kind ?? null,
          },
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
      const materialized = await notifyBreachWarning(warning, config);
      if (!materialized) continue;
      // The durable notification intent is the primary delivery record. Only
      // mark this SLA warning as observed after its intents were materialized;
      // otherwise a crash or enqueue failure would suppress it forever.
      try {
        if (prisma.incidentEvent?.create) {
          const isBreached = warning.timeRemainingMs <= 0;
          await prisma.incidentEvent.create({
            data: {
              incidentId: warning.incidentId,
              type: isBreached ? 'SLA_BREACHED' : 'SLA_WARNING',
              message: isBreached
                ? `🚨 SLA ${warning.breachType.toUpperCase()} Breached: target was ${warning.targetMinutes} min`
                : `${warning.breachType === 'ack' ? '⏰' : '⚠️'} SLA ${warning.breachType.toUpperCase()} Warning: ${Math.max(1, Math.round(warning.timeRemainingMs / 60000))} min remaining`,
            },
          });
        }
      } catch {
        // Duplicate intent keys prevent a repeated cron loop from duplicating
        // delivery if this non-critical audit marker cannot be written.
      }
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
): Promise<boolean> {
  let materialized = true;
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
  const eventKey = `${warning.breachType}:${isBreached ? 'breached' : 'warning'}:${warning.targetMinutes}`;
  const incidentPresentation = {
    id: warning.incidentId,
    title: warning.title,
    status: warning.status,
    urgency: warning.urgency,
    serviceName: warning.serviceName,
    assigneeName: warning.assigneeName,
  };

  // 1. Send Slack notification if enabled
  if (config.notifySlack) {
    const channels = warning.serviceNotificationChannels || [];
    const hasSlackEnabled = channels.includes('SLACK');
    const slackChannel = warning.slackChannel?.trim();
    const slackWebhookUrl = warning.slackWebhookUrl?.trim() || configuredSlackWebhookUrl();

    // Do not create a synthetic Slack recipient. A service target is preferred,
    // with a configured global webhook as the deliberate fallback.
    if (hasSlackEnabled && (slackChannel || slackWebhookUrl)) {
      await enqueueCentralNotification({
        category: 'SLA',
        channel: 'SLACK',
        recipientType: slackChannel ? 'SLACK_CHANNEL' : 'WEBHOOK',
        recipientId: warning.serviceId,
        recipientAddress: slackChannel || slackWebhookUrl!,
        incidentId: warning.incidentId,
        templateKey: `sla-${warning.breachType}-${isBreached ? 'breached' : 'warning'}`,
        sourceType: 'INCIDENT_SLA',
        sourceId: warning.incidentId,
        eventKey,
        displayMessage: plainText,
        priority: isBreached ? 0 : 1,
        payload: slackChannel
          ? {
              kind: 'SLACK_CHANNEL',
              channel: slackChannel,
              incident: incidentPresentation,
              eventType: 'triggered',
              includeInteractiveButtons: true,
              serviceId: warning.serviceId,
              additionalMessage: message,
            }
          : {
              kind: 'SLACK_WEBHOOK',
              incident: incidentPresentation,
              eventType: 'triggered',
              webhookUrl: slackWebhookUrl,
              additionalMessage: message,
            },
      });
    }
  }

  // 2. Send Webhook notifications if enabled
  if (config.notifyWebhook && warning.serviceNotificationChannels?.includes('WEBHOOK')) {
    try {
      const webhooks = warning.webhookIntegrations || [];

      for (const webhook of webhooks) {
        try {
          const { decryptStoredSecret } = await import('./encryption');
          await enqueueCentralNotification({
            category: 'SLA',
            channel: 'WEBHOOK',
            recipientType: 'WEBHOOK',
            recipientId: webhook.id,
            recipientAddress: webhook.url,
            incidentId: warning.incidentId,
            templateKey: `sla-webhook-${warning.breachType}-${isBreached ? 'breached' : 'warning'}`,
            sourceType: 'WEBHOOK_INTEGRATION',
            sourceId: webhook.id,
            eventKey,
            displayMessage: plainText,
            priority: isBreached ? 0 : 1,
            payload: {
              kind: 'WEBHOOK',
              url: webhook.url,
              payload: formatWebhookPayloadByType(
                webhook.type,
                {
                  id: warning.incidentId,
                  title: warning.title,
                  status: warning.status,
                  urgency: warning.urgency,
                  service: { id: warning.serviceId, name: warning.serviceName },
                  createdAt: warning.createdAt,
                },
                isBreached ? 'triggered' : 'warning',
                getBaseUrl(),
                webhook.channel || undefined
              ),
              secret: webhook.secret ? await decryptStoredSecret(webhook.secret) : undefined,
            },
          });
          logger.info('[SLA Breach Monitor] Webhook notification enqueued', {
            webhookId: webhook.id,
            type: webhook.type,
          });
        } catch (error) {
          materialized = false;
          logger.error('[SLA Breach Monitor] Error sending webhook notification', {
            webhookId: webhook.id,
            error,
          });
        }
      }
    } catch (importError) {
      materialized = false;
      logger.error('[SLA Breach Monitor] Failed to import webhooks module', { importError });
    }
  }

  // 3. Send email notification if enabled
  if (config.notifyEmail) {
    try {
      const alertEmail = config.alertEmail || process.env.SLA_ALERT_EMAIL;

      if (alertEmail) {
        const safeServiceName = escapeHtml(warning.serviceName);
        const safeTitle = escapeHtml(warning.title);
        const safeUrgency = escapeHtml(warning.urgency);
        const baseUrl = (process.env.NEXTAUTH_URL || '').replace(/\/+$/, '');
        const incidentUrl = `${baseUrl}/incidents/${encodeURIComponent(warning.incidentId)}`;

        const subject = isBreached
          ? `[SLA BREACHED] ${warning.serviceName}: ${warning.title}`
          : `[SLA WARNING] ${warning.serviceName}: ${warning.title}`;
        const html = `
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
                      `;
        await enqueueCentralNotification({
          category: 'SLA',
          channel: 'EMAIL',
          recipientType: 'EMAIL',
          recipientAddress: alertEmail,
          incidentId: warning.incidentId,
          templateKey: `sla-email-${warning.breachType}-${isBreached ? 'breached' : 'warning'}`,
          sourceType: 'INCIDENT_SLA',
          sourceId: warning.incidentId,
          eventKey,
          displayMessage: plainText,
          priority: isBreached ? 0 : 1,
          payload: { kind: 'EMAIL', to: alertEmail, subject, html, text: plainText },
        });

        logger.info('[SLA Breach Monitor] Email notification enqueued', { to: alertEmail });
      } else {
        logger.debug('[SLA Breach Monitor] Email skipped (SLA_ALERT_EMAIL not set)');
      }
    } catch (error) {
      materialized = false;
      logger.error('[SLA Breach Monitor] Failed to send email notification', { error });
    }
  }

  return materialized;
}

/**
 * Format breach warning for display
 */
export function formatBreachWarning(warning: BreachWarning): string {
  const remainingMinutes = Math.round(warning.timeRemainingMs / 60000);
  const type = warning.breachType === 'ack' ? 'Acknowledgment' : 'Resolution';
  return `${type} SLA breach in ${remainingMinutes} min (target: ${warning.targetMinutes} min)`;
}
