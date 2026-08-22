import { Prisma, IncidentUrgency } from '@prisma/client';
import prisma from './prisma';
import { executeEscalation } from './notifications';
import { notifySlackForIncident } from './slack';
import { logger } from './logger';
import { EVENT_TRANSACTION_MAX_ATTEMPTS } from './config';

export type EventSeverity = 'critical' | 'error' | 'warning' | 'info';

export type EventPayload = {
  event_action: 'trigger' | 'resolve' | 'acknowledge';
  dedup_key: string;
  payload: {
    summary: string;
    source: string;
    severity: EventSeverity;
    custom_details?: unknown;
  };
};

import { createHash } from 'crypto';
import { runSerializableTransaction } from './db-utils';

const MAX_DEDUP_KEY_LENGTH = 512;

// Centralized severity → urgency mapping for consistency
// Critical = HIGH (P1 - immediate response needed)
// Error/Warning = MEDIUM (P2 - respond within SLA)
// Info = LOW (P3 - informational, no immediate action)
const SEVERITY_TO_URGENCY: Record<EventSeverity, IncidentUrgency> = {
  critical: 'HIGH',
  error: 'MEDIUM',
  warning: 'MEDIUM', // Warning is MEDIUM, not LOW - important alerts shouldn't be missed
  info: 'LOW',
};

function mapSeverityToUrgency(severity: EventSeverity): IncidentUrgency {
  return SEVERITY_TO_URGENCY[severity] ?? 'MEDIUM'; // Default to MEDIUM if unknown
}

// Maximum description length to prevent DB insert failures
const MAX_DESCRIPTION_LENGTH = 10000;

// Sanitize text to prevent XSS and remove control characters
function sanitizeText(text: string): string {
  if (!text) return '';
  return (
    text
      // Remove null bytes and control characters (except newlines/tabs)
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
      // Normalize Unicode to prevent homoglyph attacks
      .normalize('NFC')
      // Basic HTML entity encoding for XSS prevention
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
  );
}

// Truncate long strings safely (handles unicode)
function truncateString(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  // Use Array.from to handle unicode properly
  const chars = Array.from(str);
  if (chars.length <= maxLength) return str;
  return chars.slice(0, maxLength - 3).join('') + '...';
}

function truncateDedupKey(key: string): string {
  if (key.length <= MAX_DEDUP_KEY_LENGTH) return key;
  const hash = createHash('sha256').update(key).digest('hex').slice(0, 32);
  const prefixLength = MAX_DEDUP_KEY_LENGTH - 33; // 32 hex chars + 1 underscore
  return `${key.slice(0, prefixLength)}_${hash}`;
}

export async function processEvent(
  payload: EventPayload,
  serviceId: string,
  integrationId: string
) {
  const { event_action, dedup_key: rawDedupKey, payload: eventData } = payload;
  const dedup_key = truncateDedupKey(rawDedupKey);

  // Validate summary is not empty (prevents generic incident titles)
  if (!eventData.summary || eventData.summary.trim().length === 0) {
    logger.warn('event.empty_summary', {
      source: eventData.source,
      dedupKey: dedup_key,
      integrationId,
    });
    // Use source as fallback title instead of failing
    eventData.summary = `Alert from ${eventData.source}`;
  }

  const result = await runSerializableTransaction(async tx => {
    // 1. Validate serviceId exists (prevents orphaned incidents)
    const service = await tx.service.findUnique({
      where: { id: serviceId },
      select: { id: true, name: true },
    });

    if (!service) {
      logger.error('event.service_not_found', {
        serviceId,
        integrationId,
        dedupKey: dedup_key,
      });
      throw new Error(`Service not found: ${serviceId}. Integration may be misconfigured.`);
    }

    // 2. Find existing open incident with this dedup_key BEFORE creating alert
    // This prevents alert orphaning when resolve/acknowledge has no matching incident
    const existingIncident = await tx.incident.findFirst({
      where: {
        dedupKey: dedup_key,
        serviceId,
        status: { in: ['OPEN', 'ACKNOWLEDGED', 'SNOOZED', 'SUPPRESSED'] },
      },
    });

    // 3. For acknowledge, skip alert creation if no matching incident
    if (event_action === 'acknowledge' && !existingIncident) {
      logger.warn(`event.${event_action}_no_match`, {
        dedupKey: dedup_key,
        serviceId,
        source: eventData.source,
      });
      return {
        action: 'ignored',
        reason: `No matching incident to ${event_action}`,
        dedupKey: dedup_key,
      };
    }

    // 4. Log the raw alert
    const alert = await tx.alert.create({
      data: {
        dedupKey: dedup_key,
        status: event_action === 'resolve' ? 'RESOLVED' : 'TRIGGERED',
        payload: eventData as object,
        serviceId,
      },
    });

    if (event_action === 'resolve' && !existingIncident) {
      logger.info('event.resolve_buffered_for_out_of_order', {
        dedupKey: dedup_key,
        serviceId,
        source: eventData.source,
        alertId: alert.id,
      });
      return {
        action: 'ignored',
        reason: 'No matching incident to resolve (buffered for out-of-order trigger)',
        dedupKey: dedup_key,
      };
    }

    if (event_action === 'trigger') {
      if (existingIncident) {
        // Deduplication: Just append the alert to the incident
        await tx.alert.update({
          where: { id: alert.id },
          data: { incidentId: existingIncident.id },
        });

        // Log an event instead of note (no userId needed)
        const safeSummary = truncateString(sanitizeText(eventData.summary.trim()), 500);
        await tx.incidentEvent.create({
          data: {
            incidentId: existingIncident.id,
            message: `Re-triggered by event from ${eventData.source}. Summary: ${safeSummary}`,
          },
        });

        logger.info('event.deduplicated', {
          incidentId: existingIncident.id,
          dedupKey: dedup_key,
          source: eventData.source,
          alertCount: 'appended',
        });

        return { action: 'deduplicated', incident: existingIncident };
      }

      // Check if an out-of-order resolve event arrived recently (< 5 minutes ago) for this dedupKey
      const recentResolveAlert = await tx.alert.findFirst({
        where: {
          dedupKey: dedup_key,
          serviceId,
          status: 'RESOLVED',
          incidentId: null,
          createdAt: { gte: new Date(Date.now() - 5 * 60 * 1000) },
        },
        orderBy: { createdAt: 'desc' },
      });

      // Create New Incident with proper severity → urgency mapping
      const urgency = mapSeverityToUrgency(eventData.severity);

      // Sanitize title to prevent XSS and truncate to reasonable length
      const sanitizedTitle = truncateString(sanitizeText(eventData.summary.trim()), 500);

      // If a resolve event already arrived, create the incident in RESOLVED state immediately
      if (recentResolveAlert) {
        const rawDescription = eventData.custom_details
          ? JSON.stringify(eventData.custom_details, null, 2)
          : null;
        const truncatedDescription = rawDescription
          ? truncateString(rawDescription, MAX_DESCRIPTION_LENGTH)
          : null;

        const resolvedIncident = await tx.incident.create({
          data: {
            title: sanitizedTitle,
            description: truncatedDescription,
            status: 'RESOLVED',
            resolvedAt: new Date(),
            urgency,
            dedupKey: dedup_key,
            serviceId,
            escalationStatus: 'COMPLETED',
          },
        });

        await tx.alert.updateMany({
          where: { id: { in: [alert.id, recentResolveAlert.id] } },
          data: { incidentId: resolvedIncident.id },
        });

        await tx.incidentEvent.create({
          data: {
            incidentId: resolvedIncident.id,
            message: `Incident created in resolved state: resolve event was received prior to trigger event from ${eventData.source}`,
          },
        });

        logger.info('event.out_of_order_resolved', {
          incidentId: resolvedIncident.id,
          dedupKey: dedup_key,
          source: eventData.source,
        });

        return { action: 'resolved', incident: resolvedIncident };
      }

      // Truncate description to prevent DB insert failures on very long payloads
      const rawDescription = eventData.custom_details
        ? JSON.stringify(eventData.custom_details, null, 2)
        : null;
      const truncatedDescription = rawDescription
        ? truncateString(rawDescription, MAX_DESCRIPTION_LENGTH)
        : null;

      const newIncident = await tx.incident.create({
        data: {
          title: sanitizedTitle,
          description: truncatedDescription,
          status: 'OPEN',
          urgency,
          dedupKey: dedup_key,
          serviceId,
        },
      });

      logger.info('event.incident_created', {
        incidentId: newIncident.id,
        dedupKey: dedup_key,
        source: eventData.source,
        severity: eventData.severity,
        urgency,
      });

      // Connect alert to incident
      await tx.alert.update({
        where: { id: alert.id },
        data: { incidentId: newIncident.id },
      });

      // Log timeline event
      await tx.incidentEvent.create({
        data: {
          incidentId: newIncident.id,
          message: `Incident triggered via API from ${eventData.source}`,
        },
      });

      // Note: Webhook triggering happens outside transaction to avoid blocking
      return { action: 'triggered', incident: newIncident };
    }

    if (event_action === 'resolve') {
      // existingIncident is guaranteed to exist here (checked above before alert creation)
      await tx.alert.update({
        where: { id: alert.id },
        data: { incidentId: existingIncident!.id },
      });

      const resolvedIncident = await tx.incident.update({
        where: { id: existingIncident!.id },
        data: {
          status: 'RESOLVED',
          escalationStatus: 'COMPLETED',
          nextEscalationAt: null,
          resolvedAt: existingIncident!.resolvedAt ?? new Date(),
        },
      });

      await tx.incidentEvent.create({
        data: {
          incidentId: existingIncident!.id,
          message: `Auto-resolved by event from ${eventData.source}.`,
        },
      });

      logger.info('event.incident_resolved', {
        incidentId: resolvedIncident.id,
        dedupKey: dedup_key,
        source: eventData.source,
      });

      return { action: 'resolved', incident: resolvedIncident };
    }

    if (event_action === 'acknowledge') {
      // existingIncident is guaranteed to exist here (checked above before alert creation)
      await tx.alert.update({
        where: { id: alert.id },
        data: { incidentId: existingIncident!.id },
      });

      const ackIncident = await tx.incident.update({
        where: { id: existingIncident!.id },
        data: {
          status: 'ACKNOWLEDGED',
          escalationStatus: 'COMPLETED',
          nextEscalationAt: null,
          acknowledgedAt: existingIncident!.acknowledgedAt ?? new Date(),
        },
      });

      await tx.incidentEvent.create({
        data: {
          incidentId: existingIncident!.id,
          message: `Acknowledged via API event.`,
        },
      });

      logger.info('event.incident_acknowledged', {
        incidentId: ackIncident.id,
        dedupKey: dedup_key,
        source: eventData.source,
      });

      return { action: 'acknowledged', incident: ackIncident };
    }

    // Unknown event_action
    logger.warn('event.unknown_action', {
      eventAction: event_action,
      dedupKey: dedup_key,
      source: eventData.source,
    });
    return { action: 'ignored', reason: `Unknown event action: ${event_action}` };
  });

  if (result.action === 'triggered' && result.incident) {
    // Trigger status page webhooks for incident.created event
    try {
      const { triggerWebhooksForService } = await import('./status-page-webhooks');
      const incidentWithService = await prisma.incident.findUnique({
        where: { id: result.incident.id },
        include: {
          service: { select: { id: true, name: true } },
          assignee: { select: { id: true, name: true, email: true } },
        },
      });

      if (incidentWithService) {
        // PERF: Fire-and-forget status webhooks to avoid blocking response
        // Catch errors locally to prevent unhandled promise rejections
        const webhookStart = performance.now();
        triggerWebhooksForService(result.incident.serviceId, 'incident.created', {
          id: incidentWithService.id,
          title: incidentWithService.title,
          description: incidentWithService.description,
          status: incidentWithService.status,
          urgency: incidentWithService.urgency,
          priority: incidentWithService.priority,
          service: {
            id: incidentWithService.service.id,
            name: incidentWithService.service.name,
          },
          assignee: incidentWithService.assignee,
          createdAt: incidentWithService.createdAt.toISOString(),
        })
          .then(() => {
            logger.info('api.event.webhook_trigger_success', {
              latencyMs: performance.now() - webhookStart,
              incidentId: result.incident.id,
            });
          })
          .catch(err => {
            logger.error('api.event.webhook_trigger_failed', {
              error: err instanceof Error ? err.message : String(err),
              latencyMs: performance.now() - webhookStart,
            });
          });
      }
    } catch (e) {
      logger.error('api.event.webhook_trigger_error', {
        error: e instanceof Error ? e.message : String(e),
      });
    }

    // Execute escalation policy, then choose the correct notification path.
    // PERF: Async dispatch (no await) prevents blocking the webhook response
    const notifyStart = performance.now();
    executeEscalation(result.incident.id)
      .then(escalationResult => {
        const hasEscalationPolicy = escalationResult?.reason !== 'No escalation policy configured';

        if (hasEscalationPolicy) {
          import('./service-notifications')
            .then(({ sendServiceNotifications }) => {
              sendServiceNotifications(result.incident.id, 'triggered')
                .then(() => {
                  logger.info('api.event.notifications_sent', {
                    latencyMs: performance.now() - notifyStart,
                    incidentId: result.incident.id,
                  });
                })
                .catch(error => {
                  logger.error('Service notification failed', {
                    incidentId: result.incident.id,
                    error: error instanceof Error ? error.message : 'Unknown error',
                    latencyMs: performance.now() - notifyStart,
                  });
                });
            })
            .catch(e => logger.error('Failed to load service-notifications', { error: e }));
        } else {
          import('./user-notifications')
            .then(({ sendIncidentNotifications }) => {
              sendIncidentNotifications(result.incident.id, 'triggered')
                .then(() => {
                  logger.info('api.event.user_notifications_sent', {
                    latencyMs: performance.now() - notifyStart,
                    incidentId: result.incident.id,
                  });
                })
                .catch(error => {
                  logger.error('User notification failed', {
                    incidentId: result.incident.id,
                    error: error instanceof Error ? error.message : 'Unknown error',
                    latencyMs: performance.now() - notifyStart,
                  });
                });
            })
            .catch(e => logger.error('Failed to load user-notifications', { error: e }));
        }
      })
      .catch(error => {
        logger.error('Escalation failed', {
          incidentId: result.incident.id,
          error: error instanceof Error ? error.message : 'Unknown error',
        });

        import('./service-notifications')
          .then(({ sendServiceNotifications }) => {
            sendServiceNotifications(result.incident.id, 'triggered').catch(err => {
              logger.error('Service notification failed', {
                incidentId: result.incident.id,
                error: err instanceof Error ? err.message : 'Unknown error',
                latencyMs: performance.now() - notifyStart,
              });
            });
          })
          .catch(e => logger.error('Failed to load service-notifications', { error: e }));
      });

    // ChatOps: Auto-create war-room channel for qualifying incidents (fire-and-forget)
    import('./chatops/war-room')
      .then(({ createIncidentWarRoom }) => {
        createIncidentWarRoom(result.incident.id)
          .then(warRoomResult => {
            if (warRoomResult.success) {
              logger.info('chatops.war_room_created', {
                incidentId: result.incident.id,
                channelName: warRoomResult.channelName,
              });
            }
          })
          .catch(err => {
            logger.error('chatops.war_room_creation_failed', {
              incidentId: result.incident.id,
              error: err instanceof Error ? err.message : String(err),
            });
          });
      })
      .catch(e => logger.error('Failed to load chatops/war-room', { error: e }));
  }

  if (result.action === 'resolved' && result.incident) {
    // Trigger status page webhooks for incident.resolved event
    try {
      const { triggerWebhooksForService } = await import('./status-page-webhooks');
      const incidentWithService = await prisma.incident.findUnique({
        where: { id: result.incident.id },
        include: {
          service: { select: { id: true, name: true } },
          assignee: { select: { id: true, name: true, email: true } },
        },
      });

      if (incidentWithService) {
        triggerWebhooksForService(result.incident.serviceId, 'incident.resolved', {
          id: incidentWithService.id,
          title: incidentWithService.title,
          description: incidentWithService.description,
          status: incidentWithService.status,
          urgency: incidentWithService.urgency,
          priority: incidentWithService.priority,
          service: {
            id: incidentWithService.service.id,
            name: incidentWithService.service.name,
          },
          assignee: incidentWithService.assignee,
          createdAt: incidentWithService.createdAt.toISOString(),
          acknowledgedAt: incidentWithService.acknowledgedAt?.toISOString() || null,
          resolvedAt: incidentWithService.resolvedAt?.toISOString() || null,
        }).catch(err => {
          logger.error('api.event.webhook_trigger_failed', {
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }
    } catch (e) {
      logger.error('api.event.webhook_trigger_error', {
        error: e instanceof Error ? e.message : String(e),
      });
    }

    notifySlackForIncident(result.incident.id, 'resolved').catch(error => {
      logger.error('Slack notification failed', {
        incidentId: result.incident.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    });

    // ChatOps: Archive war-room channel on resolve (fire-and-forget)
    import('./chatops/war-room')
      .then(({ archiveWarRoomChannel }) => {
        archiveWarRoomChannel(result.incident.id).catch(err => {
          logger.error('chatops.war_room_archive_failed', {
            incidentId: result.incident.id,
            error: err instanceof Error ? err.message : String(err),
          });
        });
      })
      .catch(e => logger.error('Failed to load chatops/war-room', { error: e }));
  }

  if (result.action === 'acknowledged' && result.incident) {
    notifySlackForIncident(result.incident.id, 'acknowledged').catch(error => {
      logger.error('Slack notification failed', {
        incidentId: result.incident.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    });
  }

  return result;
}
