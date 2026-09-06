import { Prisma, IncidentUrgency } from '@prisma/client';
import { logger } from './logger';
import { EVENT_TRANSACTION_MAX_ATTEMPTS } from './config';
import { createHash } from 'crypto';
import { runReadCommittedTransaction } from './db-utils';
import { enqueueEventSideEffects, enqueueLifecycleSideEffects } from './event-outbox';
import { applyIncidentLifecycleCommand } from './incidents/lifecycle';

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

const MAX_DEDUP_KEY_LENGTH = 512;
const MAX_STORED_ALERT_PAYLOAD_BYTES = 64 * 1024;

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

const URGENCY_RANK: Record<IncidentUrgency, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
};

function mapSeverityToUrgency(severity: EventSeverity): IncidentUrgency {
  return SEVERITY_TO_URGENCY[severity] ?? 'MEDIUM'; // Default to MEDIUM if unknown
}

function maxUrgency(current: IncidentUrgency, incoming: IncidentUrgency): IncidentUrgency {
  return URGENCY_RANK[incoming] > URGENCY_RANK[current] ? incoming : current;
}

// Maximum description length to prevent DB insert failures
const MAX_DESCRIPTION_LENGTH = 10000;

/**
 * Normalize externally supplied text for safe canonical storage.
 *
 * XSS escaping deliberately belongs at the HTML/rendering boundary. Persisting
 * HTML entities here corrupts domain data for REST clients, webhooks, exports,
 * and integrations and can result in double escaping in React/email renderers.
 */
function normalizeText(text: string): string {
  if (!text) return '';
  return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').normalize('NFC');
}

// Truncate long strings safely (handles unicode)
function truncateString(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  // Use Array.from to handle unicode properly
  const chars = Array.from(str);
  if (chars.length <= maxLength) return str;
  return chars.slice(0, maxLength - 3).join('') + '...';
}

function truncateDedupKey(key: unknown): string {
  const str = typeof key === 'string' ? key : String(key || '');
  if (str.length <= MAX_DEDUP_KEY_LENGTH) return str;
  const hash = createHash('sha256').update(str).digest('hex').slice(0, 32);
  const prefixLength = MAX_DEDUP_KEY_LENGTH - 33; // 32 hex chars + 1 underscore
  return `${str.slice(0, prefixLength)}_${hash}`;
}

function normalizeDedupKeys(
  key: unknown,
  integrationId: string,
  eventData: EventPayload['payload']
): { primary: string; legacy?: string } {
  const supplied = typeof key === 'string' ? key.trim() : String(key ?? '').trim();
  const stableRaw =
    supplied ||
    `unkeyed-${createHash('sha256')
      .update(
        JSON.stringify({
          source: eventData.source,
          summary: eventData.summary,
          details: eventData.custom_details ?? null,
        })
      )
      .digest('hex')}`;

  return {
    primary: truncateDedupKey(`${integrationId}:${stableRaw}`),
    legacy: supplied ? truncateDedupKey(supplied) : undefined,
  };
}

function boundedAlertPayload(eventData: EventPayload['payload']): Prisma.InputJsonValue {
  const serialized = JSON.stringify(eventData);
  if (Buffer.byteLength(serialized, 'utf8') <= MAX_STORED_ALERT_PAYLOAD_BYTES) {
    return eventData as Prisma.InputJsonValue;
  }

  const detailsPreview = eventData.custom_details
    ? truncateString(JSON.stringify(eventData.custom_details), 8_000)
    : undefined;
  return {
    summary: truncateString(eventData.summary, 2_000),
    source: truncateString(eventData.source, 500),
    severity: eventData.severity,
    custom_details: detailsPreview,
    _truncated: true,
    _originalBytes: Buffer.byteLength(serialized, 'utf8'),
  };
}

async function lockEventDedupKeys(
  tx: Prisma.TransactionClient,
  serviceId: string,
  candidateDedupKeys: string[]
): Promise<void> {
  // Serialize only requests that can address the same logical incident. Include
  // legacy keys during rolling upgrades and use deterministic lock ordering.
  const lockKeys = Array.from(
    new Set(candidateDedupKeys.map(key => JSON.stringify([serviceId, key])))
  ).sort();

  for (const lockKey of lockKeys) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
  }
}

async function reloadIncident(tx: Prisma.TransactionClient, incidentId: string) {
  const incident = await tx.incident.findUnique({ where: { id: incidentId } });
  if (!incident) {
    throw new Error(`Incident disappeared during event lifecycle transition: ${incidentId}`);
  }
  return incident;
}

export async function processEvent(
  payload: EventPayload,
  serviceId: string,
  integrationId: string
) {
  const { event_action, dedup_key: rawDedupKey, payload: eventData } = payload;
  const dedupKeys = normalizeDedupKeys(rawDedupKey, integrationId, eventData);
  const dedup_key = dedupKeys.primary;
  const candidateDedupKeys = dedupKeys.legacy
    ? [dedupKeys.primary, dedupKeys.legacy]
    : [dedupKeys.primary];

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

  const normalizedSource = truncateString(normalizeText(eventData.source.trim()), 500);

  const result = await runReadCommittedTransaction(async tx => {
    // 1. Validate serviceId exists (prevents orphaned incidents)
    const service = await tx.service.findUnique({
      where: { id: serviceId },
      select: { id: true, name: true, defaultIncidentVisibility: true },
    });

    if (!service) {
      logger.error('event.service_not_found', {
        serviceId,
        integrationId,
        dedupKey: dedup_key,
      });
      throw new Error(`Service not found: ${serviceId}. Integration may be misconfigured.`);
    }

    // ReadCommitted removes broad Serializable predicate conflicts. A
    // transaction-scoped advisory lock preserves the find-then-create
    // deduplication boundary for events targeting the same service/key.
    await lockEventDedupKeys(tx, serviceId, candidateDedupKeys);

    // 2. Find existing open incident with this dedup_key BEFORE creating alert
    // This prevents alert orphaning when resolve/acknowledge has no matching incident
    const existingIncident = await tx.incident.findFirst({
      where: {
        dedupKey: { in: candidateDedupKeys },
        serviceId,
        status: { in: ['OPEN', 'ACKNOWLEDGED', 'SNOOZED', 'SUPPRESSED'] },
      },
    });

    // Rolling-upgrade compatibility: move an open incident created with an
    // older, unscoped key to the integration-scoped key on first contact.
    if (existingIncident && existingIncident.dedupKey !== dedup_key) {
      await tx.incident.update({
        where: { id: existingIncident.id },
        data: { dedupKey: dedup_key },
      });
      existingIncident.dedupKey = dedup_key;
    }

    // Run this after the advisory lock so a queued event observes alert
    // history committed by earlier events for the same dedup key. Passing the
    // transaction client avoids opening a second pooled connection while this
    // interactive transaction is active.
    let isFlapping = false;
    if (event_action === 'trigger' && !existingIncident) {
      try {
        const { checkAlertFlapping } = await import('./flapping');
        const flappingResult = await checkAlertFlapping(dedup_key, serviceId, undefined, tx);
        isFlapping = flappingResult.isFlapping;
      } catch (_) {
        // Non-critical: if flapping check fails, proceed with normal incident creation
      }
    }

    // 3. For acknowledge, skip alert creation if no matching incident
    if (event_action === 'acknowledge' && !existingIncident) {
      logger.info(`event.${event_action}_no_match`, {
        dedupKey: dedup_key,
        serviceId,
        source: normalizedSource,
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
        payload: boundedAlertPayload(eventData),
        serviceId,
      },
    });

    if (event_action === 'resolve' && !existingIncident) {
      logger.info('event.resolve_buffered_for_out_of_order', {
        dedupKey: dedup_key,
        serviceId,
        source: normalizedSource,
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
        // Deduplication: append the alert and monotonically raise urgency when a
        // stronger signal arrives. Alert retries must never lower an incident.
        await tx.alert.update({
          where: { id: alert.id },
          data: { incidentId: existingIncident.id },
        });

        const incomingUrgency = mapSeverityToUrgency(eventData.severity);
        const effectiveUrgency = maxUrgency(existingIncident.urgency, incomingUrgency);
        const urgencyRaised = effectiveUrgency !== existingIncident.urgency;
        if (urgencyRaised) {
          await tx.incident.update({
            where: { id: existingIncident.id },
            data: { urgency: effectiveUrgency },
          });
          existingIncident.urgency = effectiveUrgency;
        }

        // Log an event instead of note (no userId needed)
        const safeSummary = truncateString(normalizeText(eventData.summary.trim()), 500);
        await tx.incidentEvent.create({
          data: {
            incidentId: existingIncident.id,
            message: `Re-triggered by event from ${normalizedSource}. Summary: ${safeSummary}${urgencyRaised ? ` Urgency raised to ${effectiveUrgency}.` : ''}`,
          },
        });

        logger.info('event.deduplicated', {
          incidentId: existingIncident.id,
          dedupKey: dedup_key,
          source: normalizedSource,
          alertCount: 'appended',
          incomingUrgency,
          effectiveUrgency,
          urgencyRaised,
        });

        return { action: 'deduplicated', incident: existingIncident };
      }

      // Check if an out-of-order resolve event arrived recently (< 5 minutes ago) for this dedupKey
      const recentResolveAlert = await tx.alert.findFirst({
        where: {
          dedupKey: { in: candidateDedupKeys },
          serviceId,
          status: 'RESOLVED',
          incidentId: null,
          createdAt: { gte: new Date(Date.now() - 5 * 60 * 1000) },
        },
        orderBy: { createdAt: 'desc' },
      });

      // Create New Incident with proper severity → urgency mapping
      const urgency = mapSeverityToUrgency(eventData.severity);

      // Keep canonical text in persistence. React/email/API boundaries are
      // responsible for context-appropriate output escaping.
      const sanitizedTitle = truncateString(normalizeText(eventData.summary.trim()), 500);

      // Creation is not a lifecycle transition. A buffered upstream resolve may
      // legitimately create the incident directly in its terminal state.
      if (recentResolveAlert) {
        const rawDescription = eventData.custom_details
          ? JSON.stringify(eventData.custom_details, null, 2)
          : null;
        const truncatedDescription = rawDescription
          ? truncateString(rawDescription, MAX_DESCRIPTION_LENGTH)
          : null;

        const resolutionAt = new Date();
        const resolvedIncident = await tx.incident.create({
          data: {
            title: sanitizedTitle,
            description: truncatedDescription,
            status: 'RESOLVED',
            resolvedAt: resolutionAt,
            urgency,
            dedupKey: dedup_key,
            serviceId,
            visibility: service.defaultIncidentVisibility ?? 'PUBLIC',
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
            message: `Incident created in resolved state: resolve event was received prior to trigger event from ${normalizedSource}`,
          },
        });

        // This terminal creation bypasses applyIncidentLifecycleCommand, so it
        // must explicitly enqueue the canonical lifecycle fan-out. The legacy
        // event-side-effect mapping is intentionally empty for resolve/ACK.
        await enqueueLifecycleSideEffects(tx, {
          incidentId: resolvedIncident.id,
          command: 'RESOLVE',
          source: 'EVENT',
          previousStatus: 'OPEN',
          status: 'RESOLVED',
          transitionAt: resolutionAt,
        });

        logger.info('event.out_of_order_resolved', {
          incidentId: resolvedIncident.id,
          dedupKey: dedup_key,
          source: normalizedSource,
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

      // Initial OPEN/SUPPRESSED state is creation policy, not a transition of an
      // existing incident, so it intentionally remains in the ingestion path.
      const incidentCreatedAt = new Date();
      const newIncident = await tx.incident.create({
        data: {
          title: sanitizedTitle,
          description: truncatedDescription,
          status: isFlapping ? 'SUPPRESSED' : 'OPEN',
          urgency,
          dedupKey: dedup_key,
          serviceId,
          visibility: service.defaultIncidentVisibility ?? 'PUBLIC',
          createdAt: incidentCreatedAt,
          ...(isFlapping
            ? {
                escalationStatus: 'COMPLETED',
                nextEscalationAt: null,
                slaPauseStartedAt: incidentCreatedAt,
                slaPauses: {
                  create: {
                    reason: 'flapping-suppression',
                    startedAt: incidentCreatedAt,
                  },
                },
              }
            : {}),
        },
      });

      logger.info(
        isFlapping ? 'event.incident_created_suppressed_flapping' : 'event.incident_created',
        {
          incidentId: newIncident.id,
          dedupKey: dedup_key,
          source: normalizedSource,
          severity: eventData.severity,
          urgency,
          isFlapping,
        }
      );

      // Connect alert to incident
      await tx.alert.update({
        where: { id: alert.id },
        data: { incidentId: newIncident.id },
      });

      // Log timeline event
      await tx.incidentEvent.create({
        data: {
          incidentId: newIncident.id,
          message: isFlapping
            ? `Incident created in SUPPRESSED state: rapid alert oscillations detected from ${normalizedSource}. Notifications muted until signal stabilises.`
            : `Incident triggered via API from ${normalizedSource}`,
        },
      });

      if (!isFlapping) {
        // Escalation state and its first due job commit with the incident, so
        // an OPEN incident with a policy is never left with nothing scheduled.
        const { initializeEscalationExecution } = await import('./escalation/repository');
        await initializeEscalationExecution(tx, {
          incidentId: newIncident.id,
          serviceId,
        });
        await enqueueEventSideEffects(tx, 'triggered', newIncident.id);
      }

      return {
        action: isFlapping ? ('suppressed' as const) : ('triggered' as const),
        incident: newIncident,
      };
    }

    if (event_action === 'resolve') {
      // Alert linkage, lifecycle mutation, timeline event, and outbox enqueue stay
      // in this same ReadCommitted transaction under the dedup advisory lock.
      await tx.alert.update({
        where: { id: alert.id },
        data: { incidentId: existingIncident!.id },
      });

      const transition = await applyIncidentLifecycleCommand(tx, {
        incidentId: existingIncident!.id,
        command: 'RESOLVE',
        source: 'EVENT',
        eventMessage: `Auto-resolved by event from ${normalizedSource}.`,
      });
      const resolvedIncident = await reloadIncident(tx, existingIncident!.id);

      if (transition.changed) {
        await enqueueEventSideEffects(tx, 'resolved', resolvedIncident.id);
      }

      logger.info('event.incident_resolved', {
        incidentId: resolvedIncident.id,
        dedupKey: dedup_key,
        source: normalizedSource,
        changed: transition.changed,
      });

      return { action: 'resolved', incident: resolvedIncident };
    }

    if (event_action === 'acknowledge') {
      // Repeated acknowledge signals still attach their raw alert, but the
      // lifecycle engine makes the state transition/event/effects idempotent.
      await tx.alert.update({
        where: { id: alert.id },
        data: { incidentId: existingIncident!.id },
      });

      const transition = await applyIncidentLifecycleCommand(tx, {
        incidentId: existingIncident!.id,
        command: 'ACKNOWLEDGE',
        source: 'EVENT',
        eventMessage: 'Acknowledged via API event.',
      });
      const ackIncident = await reloadIncident(tx, existingIncident!.id);

      if (transition.changed) {
        await enqueueEventSideEffects(tx, 'acknowledged', ackIncident.id);
      }

      logger.info('event.incident_acknowledged', {
        incidentId: ackIncident.id,
        dedupKey: dedup_key,
        source: normalizedSource,
        changed: transition.changed,
      });

      return { action: 'acknowledged', incident: ackIncident };
    }

    // Unknown event_action
    logger.warn('event.unknown_action', {
      eventAction: event_action,
      dedupKey: dedup_key,
      source: normalizedSource,
    });
    return { action: 'ignored', reason: `Unknown event action: ${event_action}` };
  }, EVENT_TRANSACTION_MAX_ATTEMPTS);

  // External side-effects are persisted above in the same transaction and are
  // executed by the durable PostgreSQL job worker. The API no longer waits for
  // webhook, notification, Slack, or ChatOps network calls before returning.
  return result;
}

export { escalationNotificationRoute } from './event-side-effects';
