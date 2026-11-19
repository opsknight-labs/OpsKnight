/* eslint-disable security/detect-object-injection -- Urgency keys are constrained by IncidentUrgency. */
import {
  prepareAutomation,
  persistAutomation,
  recordAutomationMetrics,
  type IntegrationEventEnvelope,
} from './automation/runtime';
import { Prisma, IncidentUrgency } from '@prisma/client';
import type { ProcessingLease } from './ingestion/contract';
import { ingestionConfig } from './ingestion/config';
import { lockProcessingReceipt, completeProcessingReceipt } from './ingestion/postgres';
import { findActiveMaintenanceWindow } from '@/lib/service-maintenance/active';
import { logger } from './logger';
import { sanitizeIntegrationEnvelope } from './integrations/payload-security';
import { EVENT_TRANSACTION_MAX_ATTEMPTS } from './config';
import {
  normalizeDedupKeys,
  lockEventDedupKeys,
  findOpenEventIncident,
} from './incidents/event-identity';
import { runReadCommittedTransaction } from './db-utils';
import { observeTransactionTiming } from './metrics/operational/transaction-timing';
import {
  enqueueEventSideEffects,
  enqueueLifecycleSideEffects,
  enqueueIncidentCreatedRunbookEvaluation,
} from './event-outbox';
import { applyIncidentLifecycleCommand } from './incidents/lifecycle';
import { readPublishedIncidentPolicies } from './incident-policies/published';
import { resolveNewIncidentSlaContract } from './incident-sla/contract';
import { resolveIncidentClassification } from './incidents/classification';
import { deriveNewIncidentSlaTransition } from './incident-sla/next-transition';
import { resolveSupportHours } from './incidents/support-hours';
import { resolveIncidentEngagement } from './incidents/engagement';
import { reconcileIncidentEngagementAfterUrgencyChange } from './incidents/engagement-reconciliation';
import { addOperationalMetric, observeOperationalHistogram } from './metrics/operational/registry';
import { checkAlertFlapping } from './flapping';
import { initializeEscalationExecution } from './escalation/repository';
import { buildResponderRoutingFromAutomation } from './escalation/routing';
import { captureResponderSnapshot } from './escalation/automation-snapshot';

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

const MAX_STORED_ALERT_PAYLOAD_BYTES = 64 * 1024;

const URGENCY_RANK: Record<IncidentUrgency, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
};

function maxUrgency(current: IncidentUrgency, incoming: IncidentUrgency): IncidentUrgency {
  return URGENCY_RANK[incoming] > URGENCY_RANK[current] ? incoming : current;
}

// Maximum description length to prevent DB insert failures
const MAX_DESCRIPTION_LENGTH = 10000;
const OUT_OF_ORDER_RESOLVE_WINDOW_MS = 5 * 60 * 1000;
// A provider recovery can lag a manual resolve by far more than the buffer
// window; a late recovery for a closed episode must not pre-resolve the next.
const CLOSED_EPISODE_LOOKBACK_MS = 24 * 60 * 60 * 1000;
// CI/CD success is a new run's state, never a late recovery of a pending failure.
const CI_INTEGRATION_TYPES = new Set(['GITHUB', 'GITLAB', 'BITBUCKET', 'VERCEL']);

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
  integrationId: string,
  envelopeInput?: IntegrationEventEnvelope,
  processingLease?: ProcessingLease
) {
  const dedupKeys = normalizeDedupKeys(payload.dedup_key, integrationId, payload.payload);
  const envelope = sanitizeIntegrationEnvelope({
    ...(envelopeInput ?? {
      serviceId,
      integrationId,
      integrationType: 'EVENTS_API',
      providerPayload: payload,
      receivedAt: new Date(),
    }),
    event: payload,
  });
  payload = envelope.event;
  const { event_action, payload: eventData } = payload;
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
  // Event-only preparation has no dependency on the locked incident or policy.
  const sanitizedTitle = truncateString(normalizeText(eventData.summary.trim()), 500);
  const rawDescription =
    event_action === 'trigger' && eventData.custom_details
      ? JSON.stringify(eventData.custom_details, null, 2)
      : null;
  const truncatedDescription = rawDescription
    ? truncateString(rawDescription, MAX_DESCRIPTION_LENGTH)
    : null;

  const transactionStarted = performance.now();
  const execute = async (tx: Prisma.TransactionClient) => {
    // ReadCommitted removes broad Serializable predicate conflicts. A
    // transaction-scoped advisory lock preserves the find-then-create
    // deduplication boundary for events targeting the same service/key.
    await lockEventDedupKeys(tx, serviceId, candidateDedupKeys);

    // Validate service and configuration after waiting on the identity lock.
    // This snapshot belongs to the event now being applied, not its queue wait.
    const service = await tx.service.findUnique({
      where: { id: serviceId },
      select: {
        id: true,
        name: true,
        defaultIncidentVisibility: true,
        escalationPolicyId: true,
        policy: { select: { id: true, name: true } },
      },
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
    // An incident keyed with the raw (legacy or manually supplied) key is matched
    // through the legacy candidate; its key is left as-is so manual reports that
    // reuse the same key keep deduplicating into it.
    const existingIncident = await findOpenEventIncident(tx, serviceId, candidateDedupKeys);

    // Run this after the advisory lock so a queued event observes alert
    // history committed by earlier events for the same dedup key. Passing the
    // transaction client avoids opening a second pooled connection while this
    // interactive transaction is active.
    let isFlapping = false;
    // Only a brand-new incident is held; incidents already open before the
    // window keep escalating, as PagerDuty does.
    let maintenanceWindow: { id: string; title: string } | null = null;
    if (event_action === 'trigger' && !existingIncident) {
      maintenanceWindow = await findActiveMaintenanceWindow(tx, serviceId, new Date());
      if (!maintenanceWindow) {
        try {
          const flappingResult = await checkAlertFlapping(dedup_key, serviceId, undefined, tx);
          isFlapping = flappingResult.isFlapping;
        } catch (_) {
          // Non-critical: if flapping check fails, proceed with normal incident creation
        }
      }
    }
    const isSuppressed = isFlapping || maintenanceWindow !== null;

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
    // CI parsers emit acknowledge for informational states (queued, running,
    // skipped, canceled). No human acknowledged anything, so an open failure
    // must keep escalating.
    if (event_action === 'acknowledge' && CI_INTEGRATION_TYPES.has(envelope.integrationType)) {
      logger.info('event.ci_informational_ignored', {
        dedupKey: dedup_key,
        serviceId,
        source: normalizedSource,
      });
      return {
        action: 'ignored',
        reason: 'CI status updates do not acknowledge incidents',
        dedupKey: dedup_key,
      };
    }

    // Persist the final link on insertion instead of rewriting every alert.
    // New incidents are created first so the foreign key remains immediate;
    // alert, incident, Automation and receipt still share this transaction.
    const alertData = () => ({
      dedupKey: dedup_key,
      status: event_action === 'resolve' ? 'RESOLVED' : 'TRIGGERED',
      payload: boundedAlertPayload(eventData),
      serviceId,
      createdAt: processingLease ? envelope.receivedAt : undefined,
    });
    const persistAlert = (incidentId?: string) =>
      tx.alert.create({
        data: { ...alertData(), incidentId },
        select: { id: true },
      });
    if (existingIncident) await persistAlert(existingIncident.id);

    // Out-of-order resolve buffering covers a resolve that precedes its trigger.
    const outOfOrderWindow = processingLease
      ? {
          gte: new Date(envelope.receivedAt.getTime() - OUT_OF_ORDER_RESOLVE_WINDOW_MS),
          lte: envelope.receivedAt,
        }
      : { gte: new Date(Date.now() - OUT_OF_ORDER_RESOLVE_WINDOW_MS) };

    if (event_action === 'resolve' && !existingIncident) {
      // A CI success with no open failure is a routine pass, not an early copy of
      // a pending trigger; buffering it would pre-resolve the next real failure.
      if (CI_INTEGRATION_TYPES.has(envelope.integrationType)) {
        logger.info('event.resolve_no_match', {
          dedupKey: dedup_key,
          serviceId,
          source: normalizedSource,
        });
        return {
          action: 'ignored',
          reason: 'No matching incident to resolve',
          dedupKey: dedup_key,
        };
      }
      // A resolve for an incident someone already closed is late, not early:
      // link it there so it cannot turn the next genuine trigger into a resolved incident.
      const receivedAt = processingLease ? envelope.receivedAt : new Date();
      const recentlyClosed = await tx.incident.findFirst({
        where: {
          serviceId,
          dedupKey: { in: candidateDedupKeys },
          status: 'RESOLVED',
          resolvedAt: {
            gte: new Date(receivedAt.getTime() - CLOSED_EPISODE_LOOKBACK_MS),
            lte: receivedAt,
          },
        },
        orderBy: { resolvedAt: 'desc' },
        select: { id: true },
      });
      if (recentlyClosed) {
        await persistAlert(recentlyClosed.id);
        logger.info('event.resolve_late_for_resolved_incident', {
          dedupKey: dedup_key,
          serviceId,
          incidentId: recentlyClosed.id,
        });
        return {
          action: 'ignored',
          reason: 'Incident already resolved',
          dedupKey: dedup_key,
        };
      }
      const alert = await persistAlert();
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
        const incomingClassification = await resolveIncidentClassification(tx, {
          serviceId,
          integrationId,
          alertSeverity: eventData.severity,
        });
        const incomingUrgency = incomingClassification.urgency;
        const effectiveUrgency = maxUrgency(existingIncident.urgency, incomingUrgency);
        const urgencyRaised = effectiveUrgency !== existingIncident.urgency;
        let releaseSupportHoursDeferral = false;
        if (urgencyRaised) {
          const previousUrgency = existingIncident.urgency;
          await tx.incident.update({
            where: { id: existingIncident.id },
            data: { urgency: effectiveUrgency },
          });
          existingIncident.urgency = effectiveUrgency;
          releaseSupportHoursDeferral = (
            await reconcileIncidentEngagementAfterUrgencyChange(tx, {
              incidentId: existingIncident.id,
              previousUrgency,
              urgency: effectiveUrgency,
            })
          ).released;
        }

        // A flapping hold has no timer of its own: the next trigger after the
        // signal stabilises releases it, so a flapped-then-steady alert still pages.
        let releasedFlappingHold = false;
        if (existingIncident.status === 'SUPPRESSED') {
          const flappingHold = await tx.incidentSlaPause.findFirst({
            where: {
              incidentId: existingIncident.id,
              endedAt: null,
              reason: 'flapping-suppression',
            },
            select: { id: true },
          });
          if (
            flappingHold &&
            !(await checkAlertFlapping(dedup_key, serviceId, undefined, tx)).isFlapping
          ) {
            releasedFlappingHold = (
              await applyIncidentLifecycleCommand(tx, {
                incidentId: existingIncident.id,
                command: 'UNSUPPRESS',
                source: 'EVENT',
                expectedStatus: 'SUPPRESSED',
                eventMessage: `Alert from ${normalizedSource} stopped flapping and is still firing; incident released for paging.`,
              })
            ).changed;
          }
        }

        // The alert row already records every repeat; only a change earns a
        // timeline entry, so a monitor firing every minute cannot flood it.
        if (urgencyRaised || releaseSupportHoursDeferral) {
          const safeSummary = truncateString(normalizeText(eventData.summary.trim()), 500);
          await tx.incidentEvent.create({
            data: {
              incidentId: existingIncident.id,
              message: `Re-triggered by event from ${normalizedSource}. Summary: ${safeSummary}${urgencyRaised ? ` Urgency raised to ${effectiveUrgency}.` : ''}${releaseSupportHoursDeferral ? ' Support-hours engagement deferral released.' : ''}`,
            },
          });
        }

        logger.info('event.deduplicated', {
          incidentId: existingIncident.id,
          dedupKey: dedup_key,
          source: normalizedSource,
          alertCount: 'appended',
          incomingUrgency,
          effectiveUrgency,
          urgencyRaised,
          releasedFlappingHold,
        });

        return {
          action: 'deduplicated',
          incident: releasedFlappingHold
            ? await reloadIncident(tx, existingIncident.id)
            : existingIncident,
        };
      }

      // Check if an out-of-order resolve event arrived recently (< 5 minutes ago) for this dedupKey
      const recentResolveAlert = await tx.alert.findFirst({
        where: {
          dedupKey: { in: candidateDedupKeys },
          serviceId,
          status: 'RESOLVED',
          incidentId: null,
          createdAt: outOfOrderWindow,
        },
        orderBy: { createdAt: 'desc' },
      });

      // Create New Incident with proper severity → urgency mapping
      const publishedPolicies = await readPublishedIncidentPolicies(tx, serviceId, integrationId);
      const classification = await resolveIncidentClassification(
        tx,
        {
          serviceId,
          integrationId,
          alertSeverity: eventData.severity,
        },
        publishedPolicies.classification
      );
      const urgency = classification.urgency;
      const automation = await prepareAutomation(tx, envelope, classification, service.policy);
      const finalPriority = automation?.finalPriority ?? classification.priority;

      // Creation is not a lifecycle transition. A buffered upstream resolve may
      // legitimately create the incident directly in its terminal state.
      if (recentResolveAlert) {
        const resolutionAt = new Date();
        const resolvedSla = await resolveNewIncidentSlaContract(
          tx,
          {
            serviceId,
            priority: finalPriority,
            now: resolutionAt,
          },
          publishedPolicies.sla
        );
        const resolvedIncident = await tx.incident.create({
          data: {
            title: sanitizedTitle,
            automationSourceRestricted: !!automation,
            description: truncatedDescription,
            status: 'RESOLVED',
            createdAt: resolutionAt,
            resolvedAt: resolutionAt,
            resolutionKind: 'SOURCE_RECOVERY',
            urgency,
            priority: finalPriority,
            dedupKey: dedup_key,
            serviceId,
            visibility: service.defaultIncidentVisibility ?? 'PUBLIC',
            slaAckTargetMs: resolvedSla.ackTargetMs,
            slaResolveTargetMs: resolvedSla.resolveTargetMs,
            slaTargetSource: resolvedSla.source,
            slaTargetCapturedAt: resolvedSla.capturedAt,
            slaPolicyId: resolvedSla.policyId,
            slaPolicyVersion: resolvedSla.policyVersion,
            slaPolicyRule: resolvedSla.policyRule,
            slaPriorityAtCapture: finalPriority,
            classificationPrioritySource: classification.prioritySource,
            classificationUrgencySource: classification.urgencySource,
            classificationPolicyId: classification.policyId,
            classificationPolicyVersion: classification.policyVersion,
            classificationRule: classification.rule,
            classificationPriorityPolicyId: classification.priorityProvenance.policyId,
            classificationPriorityPolicyVersion: classification.priorityProvenance.policyVersion,
            classificationPriorityRule: classification.priorityProvenance.rule,
            classificationPriorityScope: classification.priorityProvenance.scope,
            classificationUrgencyPolicyId: classification.urgencyProvenance.policyId,
            classificationUrgencyPolicyVersion: classification.urgencyProvenance.policyVersion,
            classificationUrgencyRule: classification.urgencyProvenance.rule,
            classificationUrgencyScope: classification.urgencyProvenance.scope,
            nextSlaTransitionAt: null,
            nextSlaTransitionKind: null,
            escalationStatus: 'COMPLETED',
            alerts: { create: alertData() },
            events: {
              create: {
                message: `Incident created in resolved state: resolve event was received prior to trigger event from ${normalizedSource}`,
              },
            },
          },
        });

        await persistAutomation(
          tx,
          resolvedIncident.id,
          envelope,
          automation,
          false,
          service.escalationPolicyId
        );
        await enqueueIncidentCreatedRunbookEvaluation(tx, {
          incidentId: resolvedIncident.id,
          status: resolvedIncident.status,
          source: 'MONITORING',
        });
        await tx.alert.updateMany({
          where: { id: recentResolveAlert.id },
          data: { incidentId: resolvedIncident.id },
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

        return {
          action: 'resolved',
          incident: resolvedIncident,
          automationTelemetry: automation,
          telemetry: {
            prioritySource: classification.priorityProvenance.source,
            urgencySource: classification.urgencyProvenance.source,
            engagementDeferred: false,
            urgency: classification.urgency,
          },
        };
      }

      // Initial OPEN/SUPPRESSED state is creation policy, not a transition of an
      // existing incident, so it intentionally remains in the ingestion path.
      const incidentCreatedAt = new Date();
      const newSla = await resolveNewIncidentSlaContract(
        tx,
        {
          serviceId,
          priority: finalPriority,
          now: incidentCreatedAt,
        },
        publishedPolicies.sla
      );
      const engagement = resolveIncidentEngagement({
        urgency,
        supportHours: await resolveSupportHours(
          tx,
          { serviceId, at: incidentCreatedAt },
          publishedPolicies.support
        ),
        now: incidentCreatedAt,
      });
      const newIncident = await tx.incident.create({
        data: {
          title: sanitizedTitle,
          automationSourceRestricted: !!automation,
          description: truncatedDescription,
          status: isSuppressed ? 'SUPPRESSED' : 'OPEN',
          maintenanceWindowId: maintenanceWindow?.id ?? null,
          urgency,
          priority: finalPriority,
          dedupKey: dedupKeys.primary,
          serviceId,
          visibility: service.defaultIncidentVisibility ?? 'PUBLIC',
          slaAckTargetMs: newSla.ackTargetMs,
          slaResolveTargetMs: newSla.resolveTargetMs,
          slaTargetSource: newSla.source,
          slaTargetCapturedAt: newSla.capturedAt,
          slaPolicyId: newSla.policyId,
          slaPolicyVersion: newSla.policyVersion,
          slaPolicyRule: newSla.policyRule,
          slaPriorityAtCapture: finalPriority,
          classificationPrioritySource: classification.prioritySource,
          classificationUrgencySource: classification.urgencySource,
          classificationPolicyId: classification.policyId,
          classificationPolicyVersion: classification.policyVersion,
          classificationRule: classification.rule,
          classificationPriorityPolicyId: classification.priorityProvenance.policyId,
          classificationPriorityPolicyVersion: classification.priorityProvenance.policyVersion,
          classificationPriorityRule: classification.priorityProvenance.rule,
          classificationPriorityScope: classification.priorityProvenance.scope,
          classificationUrgencyPolicyId: classification.urgencyProvenance.policyId,
          classificationUrgencyPolicyVersion: classification.urgencyProvenance.policyVersion,
          classificationUrgencyRule: classification.urgencyProvenance.rule,
          classificationUrgencyScope: classification.urgencyProvenance.scope,
          ...(() => {
            const next = deriveNewIncidentSlaTransition(newSla, incidentCreatedAt);
            return { nextSlaTransitionAt: next?.at, nextSlaTransitionKind: next?.kind };
          })(),
          createdAt: incidentCreatedAt,
          alerts: { create: alertData() },
          events: {
            create: {
              message: maintenanceWindow
                ? `Incident created in SUPPRESSED state: service is in maintenance window "${truncateString(maintenanceWindow.title, 200)}". Nobody is paged until the window ends.`
                : isFlapping
                  ? `Incident created in SUPPRESSED state: rapid alert oscillations detected from ${normalizedSource}. Notifications muted until signal stabilises.`
                  : `Incident triggered via API from ${normalizedSource}`,
            },
          },
          ...(isSuppressed
            ? {
                escalationStatus: 'COMPLETED',
                nextEscalationAt: null,
                slaPauseStartedAt: incidentCreatedAt,
                slaPauses: {
                  create: {
                    reason: maintenanceWindow ? 'maintenance-window' : 'flapping-suppression',
                    startedAt: incidentCreatedAt,
                  },
                },
              }
            : {}),
        },
      });

      logger.info(
        maintenanceWindow
          ? 'event.incident_created_suppressed_maintenance'
          : isFlapping
            ? 'event.incident_created_suppressed_flapping'
            : 'event.incident_created',
        {
          incidentId: newIncident.id,
          dedupKey: dedup_key,
          source: normalizedSource,
          severity: eventData.severity,
          urgency,
          isFlapping,
          maintenanceWindowId: maintenanceWindow?.id,
        }
      );

      await persistAutomation(
        tx,
        newIncident.id,
        envelope,
        automation,
        !isSuppressed,
        service.escalationPolicyId
      );

      if (!isSuppressed) {
        // Escalation state and its first due job commit with the incident, so
        // an OPEN incident with a policy is never left with nothing scheduled.
        let inMemoryRouting = automation ? buildResponderRoutingFromAutomation(automation) : null;
        // This incident was created by this transaction and has no Automation
        // decision. Reuse the service's authoritative no-policy snapshot rather
        // than re-reading that new row's routing and the same service. The
        // independently durable critical effect still resolves delivery-time
        // routing, including a policy configured after incident creation.
        if (!automation && !service.escalationPolicyId) {
          inMemoryRouting = { type: 'DEFAULT_FANOUT', policy: null };
        }
        if (!inMemoryRouting && service.escalationPolicyId) {
          try {
            const snapshot = await captureResponderSnapshot(tx, service.escalationPolicyId);
            if (snapshot) {
              inMemoryRouting = {
                type: 'DEFAULT_POLICY',
                policy: {
                  id: snapshot.id,
                  name: snapshot.name,
                  description: null,
                  archivedAt: null,
                  archivedBy: null,
                  revision: 0,
                  createdAt: incidentCreatedAt,
                  updatedAt: incidentCreatedAt,
                  steps: snapshot.steps.map(({ conditions: _conditions, ...step }) => ({
                    ...step,
                    targetUser: null,
                    targetTeam: null,
                    targetSchedule: null,
                  })),
                },
                pinnedConditions: new Map(snapshot.steps.map(step => [step.id, step.conditions])),
              };
            }
          } catch {
            // Fall back to standard lookup if snapshot capture fails
          }
        }
        await initializeEscalationExecution(tx, {
          incidentId: newIncident.id,
          serviceId,
          now: incidentCreatedAt,
          notBefore: engagement.earliestDeliveryAt,
          generation: newIncident.escalationGeneration ?? 0,
          routing: inMemoryRouting,
        });
        await enqueueEventSideEffects(
          tx,
          'triggered',
          newIncident.id,
          engagement.earliestDeliveryAt,
          {
            escalationGeneration: newIncident.escalationGeneration ?? 0,
            status: newIncident.status,
          },
          automation
            ? {
                mode: automation.mode,
                routeType: automation.result?.outcome.type ?? 'SERVICE_DEFAULT',
              }
            : null
        );
      }
      // Same transaction as persistAutomation, so evaluation always sees the committed decision.
      await enqueueIncidentCreatedRunbookEvaluation(tx, {
        incidentId: newIncident.id,
        status: newIncident.status,
        source: 'MONITORING',
      });

      return {
        action: isSuppressed ? ('suppressed' as const) : ('triggered' as const),
        incident: newIncident,
        automationTelemetry: automation,
        telemetry: {
          prioritySource: classification.priorityProvenance.source,
          urgencySource: classification.urgencyProvenance.source,
          engagementDeferred: engagement.deferred,
          urgency: classification.urgency,
        },
      };
    }

    if (event_action === 'resolve') {
      // Alert linkage, lifecycle mutation, timeline event, and outbox enqueue stay
      // in this same ReadCommitted transaction under the dedup advisory lock.
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
    if (!existingIncident) await persistAlert();
    logger.warn('event.unknown_action', {
      eventAction: event_action,
      dedupKey: dedup_key,
      source: normalizedSource,
    });
    return { action: 'ignored', reason: `Unknown event action: ${event_action}` };
  };
  const result = await runReadCommittedTransaction(
    async tx => {
      if (processingLease) await lockProcessingReceipt(tx, processingLease);
      const outcome = await execute(tx);
      if (processingLease) await completeProcessingReceipt(tx, processingLease, outcome);
      return outcome;
    },
    EVENT_TRANSACTION_MAX_ATTEMPTS,
    timing => observeTransactionTiming('event', timing)
  );
  observeOperationalHistogram(
    'opsknight_event_transaction_duration_ms',
    performance.now() - transactionStarted,
    { action: result.action }
  );

  const telemetry = 'telemetry' in result ? result.telemetry : undefined;
  if (telemetry) {
    addOperationalMetric('opsknight_incident_classification_total', 1, {
      priority_source: telemetry.prioritySource,
      urgency_source: telemetry.urgencySource,
    });
    if (telemetry.engagementDeferred)
      addOperationalMetric('opsknight_engagement_deferred_total', 1, {
        urgency: telemetry.urgency,
      });
    delete (result as { telemetry?: unknown }).telemetry;
  }

  // External side-effects are persisted above in the same transaction and are
  // executed by the durable PostgreSQL job worker. The API no longer waits for
  // webhook, notification, Slack, or ChatOps network calls before returning.
  recordAutomationMetrics(
    'automationTelemetry' in result ? (result.automationTelemetry ?? null) : null
  );
  if ('automationTelemetry' in result) delete result.automationTelemetry;
  return result;
}

export { escalationNotificationRoute } from './event-side-effects';

export async function processIntegrationEvent(envelope: IntegrationEventEnvelope) {
  envelope = sanitizeIntegrationEnvelope(envelope);
  if (ingestionConfig().mode === 'postgres') {
    const { acceptIntegrationEvent } = await import('./ingestion/admission');
    return acceptIntegrationEvent(envelope);
  }
  return processEvent(envelope.event, envelope.serviceId, envelope.integrationId, envelope);
}

/** Providers with multiple normalized children share the same admission policy. */
export async function processIntegrationBatch(
  input: Omit<IntegrationEventEnvelope, 'event'>,
  events: EventPayload[]
) {
  if (ingestionConfig().mode === 'postgres') {
    const { acceptIntegrationBatch } = await import('./ingestion/admission');
    return acceptIntegrationBatch(input, events);
  }
  const results = [];
  for (const event of events) results.push(await processIntegrationEvent({ ...input, event }));
  return results;
}
