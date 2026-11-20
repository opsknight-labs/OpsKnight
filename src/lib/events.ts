/* eslint-disable security/detect-object-injection -- Urgency keys are constrained by IncidentUrgency. */
import {
  prepareAutomation,
  persistAutomation,
  recordAutomationMetrics,
  type IntegrationEventEnvelope,
} from './automation/runtime';
import {
  applyOrchestrationReroute,
  noiseFirstInputs,
  outcomeOf,
  reevaluateNoiseFirst,
  rerouteBlocker,
} from './automation/pipeline';
import { Prisma, IncidentUrgency } from '@prisma/client';
import type { ProcessingLease } from './ingestion/contract';
import { ingestionConfig } from './ingestion/config';
import { lockProcessingReceipt, completeProcessingReceipt } from './ingestion/postgres';
import { findActiveMaintenanceWindow } from '@/lib/service-maintenance/active';
import { logger } from './logger';
import {
  beginIngestNoiseLookups,
  evaluateIngestNoiseControls,
  linkStormChild,
  recordIngestNoiseDecision,
  noisePipelineOrder,
  contentDedupMayAppend,
  signalIntelligenceIncident,
  type IngestNoiseDecision,
} from './intelligence/ingest-hooks';
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
  enqueueStormChildSideEffects,
} from './event-outbox';
import { applyIncidentLifecycleCommand } from './incidents/lifecycle';
import { checkAlertFlapping } from './flapping';
import { readPublishedIncidentPolicies } from './incident-policies/published';
import { resolveNewIncidentSlaContract } from './incident-sla/contract';
import { resolveIncidentClassification } from './incidents/classification';
import { deriveNewIncidentSlaTransition } from './incident-sla/next-transition';
import { resolveSupportHours } from './incidents/support-hours';
import { resolveIncidentEngagement } from './incidents/engagement';
import { reconcileIncidentEngagementAfterUrgencyChange } from './incidents/engagement-reconciliation';
import { addOperationalMetric, observeOperationalHistogram } from './metrics/operational/registry';
import { beginIngestionActivity } from './ingestion/activity';
import { initializeEscalationExecution } from './escalation/repository';
import { buildResponderRoutingFromAutomation } from './escalation/routing';
import { captureResponderSnapshot } from './escalation/automation-snapshot';
import { normalizeAlertShape } from './alerts/normalization';
import { normalizeSeverity } from './integrations/normalization';

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

function boundedAlertPayload(eventData: EventPayload['payload']): Prisma.InputJsonObject {
  const serialized = JSON.stringify(eventData);
  if (Buffer.byteLength(serialized, 'utf8') <= MAX_STORED_ALERT_PAYLOAD_BYTES) {
    return eventData as Prisma.InputJsonObject;
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

const NOISE_TARGET_STATUSES = {
  APPEND: ['OPEN', 'ACKNOWLEDGED', 'SNOOZED', 'SUPPRESSED'],
  GROUP_CHILD: ['OPEN', 'ACKNOWLEDGED'],
} as const;

/** Timeline lines that explain an applied pre-paging decision on the incident it produced. */
function noiseDecisionMessages(
  decision: IngestNoiseDecision,
  classifiedUrgency: IncidentUrgency,
  effectiveUrgency: IncidentUrgency,
  holdUntil: Date | null,
  noiseFirst = false
): string[] {
  const control = decision.control ?? 'NOISE';
  const messages: string[] = [];
  const transform = decision.transform;
  if (transform) {
    const parts = [
      transform.severity ? `severity ${transform.severity}` : null,
      transform.urgency ? `urgency ${transform.urgency}` : null,
      transform.labels ? `labels ${Object.keys(transform.labels).join(', ')}` : null,
    ].filter(Boolean);
    if (parts.length) messages.push(`Orchestration rules set ${parts.join('; ')}.`);
    const deferred = [
      transform.serviceId ? `reroute to service ${transform.serviceId}` : null,
      transform.runbookIds?.length ? `attach runbook ${transform.runbookIds.join(', ')}` : null,
    ].filter(Boolean);
    if (deferred.length)
      messages.push(
        noiseFirst
          ? `Orchestration also asked to ${deferred.join(' and ')}; handed to automation routing and the service's runbook bindings (see "Why did this route here?").`
          : `Orchestration also asked to ${deferred.join(' and ')}; not applied at ingestion.`
      );
    for (const note of transform.notes ?? []) messages.push(`Orchestration note: ${note}`);
  }
  if (effectiveUrgency !== classifiedUrgency && decision.action === 'DOWNGRADE')
    messages.push(
      `Urgency lowered from ${classifiedUrgency} to ${effectiveUrgency} by noise control (${control}): ${decision.reason}. Reverse the decision under Settings → Intelligence → Noise controls to restore it.`
    );
  if (holdUntil)
    messages.push(
      `Paging held until ${holdUntil.toISOString()} by noise control (${control}): ${decision.reason}. Reverse the decision to page now.`
    );
  return messages.map(message => truncateString(message, 1_000));
}

async function reloadIncident(tx: Prisma.TransactionClient, incidentId: string) {
  const incident = await tx.incident.findUnique({ where: { id: incidentId } });
  if (!incident) {
    throw new Error(`Incident disappeared during event lifecycle transition: ${incidentId}`);
  }
  return incident;
}

/**
 * Applies one event. The in-process activity count lets background work sharing this process (the
 * intelligence lane in `integrated`) back off during bursts; it costs two clock reads and never throws.
 */
export async function processEvent(
  payload: EventPayload,
  serviceId: string,
  integrationId: string,
  envelopeInput?: IntegrationEventEnvelope,
  processingLease?: ProcessingLease
) {
  const endActivity = beginIngestionActivity();
  try {
    return await applyEvent(payload, serviceId, integrationId, envelopeInput, processingLease);
  } finally {
    endActivity();
  }
}

async function applyEvent(
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

  const storedAlertPayload = boundedAlertPayload(eventData);
  const alertShape = normalizeAlertShape({
    summary: eventData.summary,
    severity: eventData.severity,
    custom_details: storedAlertPayload.custom_details,
  });

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
    const existingIncident = await findOpenEventIncident(
      tx,
      serviceId,
      candidateDedupKeys,
      event_action === 'resolve' && contentDedupMayAppend(serviceId)
    );

    // Only a brand-new incident is held; incidents already open before the
    // window keep escalating, as PagerDuty does.
    let maintenanceWindow: { id: string; title: string } | null = null;
    if (event_action === 'trigger' && !existingIncident) {
      maintenanceWindow = await findActiveMaintenanceWindow(tx, serviceId, new Date());
    }
    const isSuppressed = maintenanceWindow !== null;

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
    // Orchestration transforms (pre-paging noise controls, ON only) may restate severity and labels.
    let alertShapeOverride: Partial<Pick<typeof alertShape, 'severity' | 'labels'>> = {};
    const alertData = () => ({
      ...alertShape,
      ...alertShapeOverride,
      dedupKey: dedup_key,
      status: event_action === 'resolve' ? 'RESOLVED' : 'TRIGGERED',
      payload: storedAlertPayload,
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
      // With no open incident, a resolve for a key that already had a resolved
      // incident belongs to that closed episode: a late recovery after a manual
      // resolve, or a repeated recovery. Buffering it would let the next real
      // trigger open as already-RESOLVED and page nobody. A genuine early resolve
      // for a new episode then leaves that incident open, which still pages.
      const recentlyResolved = await tx.incident.findFirst({
        where: {
          serviceId,
          dedupKey: { in: candidateDedupKeys },
          status: 'RESOLVED',
          resolvedAt: { not: null },
        },
        orderBy: [{ resolvedAt: 'desc' }, { id: 'desc' }],
        select: { id: true },
      });
      if (recentlyResolved) {
        await persistAlert(recentlyResolved.id);
        logger.info('event.resolve_late_for_resolved_incident', {
          dedupKey: dedup_key,
          serviceId,
          incidentId: recentlyResolved.id,
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

      const noiseReceivedAt = processingLease ? envelope.receivedAt : new Date();
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

      // This event opens a new incident. Send the pre-paging lookups now (dedicated pool, own deadline) so
      // they overlap the reads below instead of holding this transaction's connection later. Nothing
      // happens when the service's policy is OFF; the hook further down decides what the answers mean. A
      // buffered resolve, or a maintenance hold skips the noise hook, so it skips the lookups too.
      const noisePrefetch =
        recentResolveAlert || isSuppressed
          ? null
          : beginIngestNoiseLookups(
              {
                serviceId,
                fingerprintHash: alertShape.fingerprintHash,
                dedupKey: dedup_key,
                receivedAt: noiseReceivedAt,
              },
              { integrationId }
            );

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
      const noiseInput = () => ({
        serviceId,
        source: normalizedSource,
        summary: sanitizedTitle,
        severity: alertShape.severity,
        urgency,
        labels: alertShape.labels,
        resourceKey: alertShape.resourceKey,
        fingerprintHash: alertShape.fingerprintHash,
        dedupKey: dedup_key,
        receivedAt: noiseReceivedAt,
      });
      // One pipeline (J1.5, per service, default OFF): an in-process lookup. OFF keeps today's order with
      // no extra await; SHADOW/ON evaluate the noise decision first (it does not depend on automation).
      const pipelineOrder =
        recentResolveAlert || isSuppressed ? 'OFF' : noisePipelineOrder(serviceId, integrationId);
      let noise =
        pipelineOrder === 'OFF'
          ? null
          : await evaluateIngestNoiseControls(tx, noiseInput(), {
              integrationId,
              prefetch: noisePrefetch,
            });
      const noiseFirst = pipelineOrder === 'ON';
      let automation = noiseFirst
        ? null
        : await prepareAutomation(tx, envelope, classification, service.policy);
      let finalPriority = automation?.finalPriority ?? classification.priority;

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

      // Pre-paging noise controls (per-service, default OFF). OFF is one in-process map lookup; SHADOW
      // and ON make at most a few index-backed reads under one shared deadline and fail open on any
      // error, timeout or cold cache. Only ON decisions change what happens below.
      // A maintenance hold already decides this incident; noise controls stay out.
      if (pipelineOrder === 'OFF')
        noise = isSuppressed
          ? null
          : await evaluateIngestNoiseControls(tx, noiseInput(), {
              integrationId,
              prefetch: noisePrefetch,
            });
      let applied = noise?.apply ? noise : null;
      // SHADOW/ON: dropped and appended alerts get (or would get) no automation work.
      const skippedAutomation = (decision: IngestNoiseDecision) => {
        if (pipelineOrder !== 'OFF')
          decision.evidence = {
            ...decision.evidence,
            pipeline: { order: pipelineOrder, automation: 'SKIPPED' },
          };
      };
      if (applied?.transform && applied.action !== 'DROP') {
        const { severity, labels } = applied.transform;
        alertShapeOverride = {
          ...(severity ? { severity: normalizeSeverity(severity, alertShape.severity) } : {}),
          ...(labels ? { labels: { ...alertShape.labels, ...labels } } : {}),
        };
      }

      if (applied?.action === 'DROP') {
        // Dropped alerts are still stored (unlinked) so the decision can be reviewed and reversed.
        const alert = await persistAlert();
        skippedAutomation(applied);
        await recordIngestNoiseDecision(tx, applied, {
          serviceId,
          alertId: alert.id,
          incidentId: null,
        });
        logger.info('event.dropped_by_noise_control', {
          dedupKey: dedup_key,
          serviceId,
          source: normalizedSource,
          alertId: alert.id,
          sourceId: applied.sourceId,
        });
        return { action: 'dropped' as const, reason: applied.reason, dedupKey: dedup_key };
      }

      const noiseTarget =
        (applied?.action === 'APPEND' || applied?.action === 'GROUP_CHILD') &&
        applied.targetIncidentId
          ? await tx.incident.findFirst({
              where: {
                id: applied.targetIncidentId,
                status: { in: [...NOISE_TARGET_STATUSES[applied.action]] },
              },
            })
          : null;
      if ((applied?.action === 'APPEND' || applied?.action === 'GROUP_CHILD') && !noiseTarget) {
        // The open incident it pointed at closed in the meantime: page normally, as if no control matched.
        logger.info('event.noise_control_target_gone', {
          dedupKey: dedup_key,
          serviceId,
          action: applied.action,
          targetIncidentId: applied.targetIncidentId,
        });
        applied = null;
        noise = null;
      }

      if (applied?.action === 'APPEND' && noiseTarget) {
        // Content dedup: the same problem is already open. Append like a re-trigger and never lower urgency.
        const alert = await persistAlert(noiseTarget.id);
        const raisedUrgency = maxUrgency(
          noiseTarget.urgency,
          applied.transform?.urgency ?? urgency
        );
        const urgencyRaised = raisedUrgency !== noiseTarget.urgency;
        let releasedDeferral = false;
        if (urgencyRaised) {
          const previousUrgency = noiseTarget.urgency;
          await tx.incident.update({
            where: { id: noiseTarget.id },
            data: { urgency: raisedUrgency },
          });
          noiseTarget.urgency = raisedUrgency;
          releasedDeferral = (
            await reconcileIncidentEngagementAfterUrgencyChange(tx, {
              incidentId: noiseTarget.id,
              previousUrgency,
              urgency: raisedUrgency,
            })
          ).released;
        }
        await tx.incidentEvent.create({
          data: {
            incidentId: noiseTarget.id,
            message: truncateString(
              `Alert from ${normalizedSource} appended by noise control (${applied.control}): ${applied.reason}. Summary: ${sanitizedTitle}.${urgencyRaised ? ` Urgency raised to ${raisedUrgency}.` : ''}${releasedDeferral ? ' Support-hours engagement deferral released.' : ''} Reverse the decision to page it as its own incident.`,
              1_000
            ),
          },
        });
        skippedAutomation(applied);
        await recordIngestNoiseDecision(tx, applied, {
          serviceId,
          alertId: alert.id,
          incidentId: noiseTarget.id,
        });
        logger.info('event.appended_by_noise_control', {
          incidentId: noiseTarget.id,
          dedupKey: dedup_key,
          source: normalizedSource,
        });
        return { action: 'deduplicated' as const, incident: noiseTarget };
      }

      const effectiveUrgency: IncidentUrgency =
        applied?.action === 'DOWNGRADE' && applied.urgency
          ? applied.urgency
          : (applied?.transform?.urgency ?? urgency);
      const noiseSuppressed = applied?.action === 'SUPPRESS';
      const suppressed = isSuppressed || noiseSuppressed;
      const stormParent = applied?.action === 'GROUP_CHILD' ? noiseTarget : null;
      // Holds are bounded (≤ 60 s) and never delay HIGH urgency, whatever the policy says.
      const holdUntil =
        applied?.action === 'HOLD' && applied.holdUntil && effectiveUrgency !== 'HIGH'
          ? applied.holdUntil
          : null;

      // One pipeline (J1.5). ON: automation runs now, on what the noise decision transformed, and an
      // orchestration reroute/attach is applied. SHADOW: the same re-evaluation, pure and recorded only.
      let attachRunbookIds: string[] | undefined;
      let pipeline: Record<string, unknown> | null = null;
      if (noiseFirst) {
        const transform = applied?.transform;
        const inputs = noiseFirstInputs(envelope, classification, transform, effectiveUrgency);
        automation = await prepareAutomation(
          tx,
          inputs.envelope,
          inputs.classification,
          service.policy
        );
        finalPriority = automation?.finalPriority ?? classification.priority;
        const reroute =
          transform?.serviceId && transform.serviceId !== serviceId
            ? await applyOrchestrationReroute(tx, automation, transform.serviceId)
            : null;
        attachRunbookIds = transform?.runbookIds?.length ? transform.runbookIds : undefined;
        pipeline = {
          order: 'ON',
          automation: automation
            ? outcomeOf(
                automation.fallbackReason ? null : automation.result,
                automation.basePriority,
                service.escalationPolicyId
              )
            : null,
          ...(reroute ? { reroute } : {}),
          ...(attachRunbookIds ? { attachRunbookIds } : {}),
        };
      } else if (
        pipelineOrder === 'SHADOW' &&
        (noise?.action === 'DROP' || noise?.action === 'APPEND')
      ) {
        // A shadow drop/append that was not applied: noise-first would have skipped automation.
        pipeline = { order: 'SHADOW', automation: 'SKIPPED' };
      } else if (pipelineOrder === 'SHADOW' && noise) {
        // Compared as if the noise decision were applied, whatever its own mode.
        const transform = noise.transform;
        const decidedUrgency =
          noise.action === 'DOWNGRADE' && noise.urgency
            ? noise.urgency
            : (transform?.urgency ?? urgency);
        const inputs = noiseFirstInputs(envelope, classification, transform, decidedUrgency);
        const changed = inputs.envelope !== envelope || inputs.classification !== classification;
        const actual = automation?.fallbackReason ? null : (automation?.result ?? null);
        const wouldBe = changed
          ? reevaluateNoiseFirst(automation, inputs.envelope, inputs.classification)
          : actual;
        const before = automation
          ? outcomeOf(actual, automation.basePriority, service.escalationPolicyId)
          : null;
        const after =
          automation && wouldBe
            ? outcomeOf(wouldBe, automation.basePriority, service.escalationPolicyId)
            : null;
        pipeline = {
          order: 'SHADOW',
          automation: before
            ? {
                actual: before,
                noiseFirst: after,
                different:
                  !!after &&
                  (after.priority !== before.priority || after.policyId !== before.policyId),
              }
            : null,
          ...(transform?.serviceId && transform.serviceId !== serviceId
            ? {
                reroute: {
                  serviceId: transform.serviceId,
                  wouldApply: !rerouteBlocker(automation),
                },
              }
            : {}),
          ...(transform?.runbookIds?.length ? { attachRunbookIds: transform.runbookIds } : {}),
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
        urgency: effectiveUrgency,
        supportHours: await resolveSupportHours(
          tx,
          { serviceId, at: incidentCreatedAt },
          publishedPolicies.support
        ),
        now: incidentCreatedAt,
      });
      const deliveryNotBefore =
        holdUntil && holdUntil > engagement.earliestDeliveryAt
          ? holdUntil
          : engagement.earliestDeliveryAt;
      const creationMessage = maintenanceWindow
        ? `Incident created in SUPPRESSED state: service is in maintenance window "${truncateString(maintenanceWindow.title, 200)}". Nobody is paged until the window ends.`
        : noiseSuppressed
          ? `Incident created in SUPPRESSED state by noise control (${applied!.control}) from ${normalizedSource}: ${applied!.reason}. It does not page; reverse the decision under Settings → Intelligence → Noise controls to page it.`
          : stormParent
            ? `Incident triggered via API from ${normalizedSource} and grouped under storm parent "${truncateString(stormParent.title, 200)}" (${stormParent.id}) by noise control (STORM): ${applied!.reason}. Paging rolls up to the parent; reverse the decision to page it on its own.`
            : `Incident triggered via API from ${normalizedSource}`;
      const creationMessages = [
        truncateString(creationMessage, 1_000),
        ...(applied
          ? noiseDecisionMessages(applied, urgency, effectiveUrgency, holdUntil, noiseFirst)
          : []),
      ];
      const newIncident = await tx.incident.create({
        data: {
          title: sanitizedTitle,
          automationSourceRestricted: !!automation,
          description: truncatedDescription,
          status: suppressed ? 'SUPPRESSED' : 'OPEN',
          maintenanceWindowId: maintenanceWindow?.id ?? null,
          urgency: effectiveUrgency,
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
            create:
              creationMessages.length === 1
                ? { message: creationMessages[0] }
                : creationMessages.map(message => ({ message })),
          },
          ...(suppressed
            ? {
                escalationStatus: 'COMPLETED',
                nextEscalationAt: null,
                slaPauseStartedAt: incidentCreatedAt,
                slaPauses: {
                  create: {
                    reason: maintenanceWindow ? 'maintenance-window' : 'noise-control-suppression',
                    startedAt: incidentCreatedAt,
                  },
                },
              }
            : stormParent
              ? // A storm child is visible and actionable but does not start its own escalation.
                { escalationStatus: 'COMPLETED', nextEscalationAt: null }
              : {}),
        },
      });

      logger.info(
        maintenanceWindow
          ? 'event.incident_created_suppressed_maintenance'
          : noiseSuppressed
            ? 'event.incident_created_suppressed_noise_control'
            : stormParent
              ? 'event.incident_created_storm_child'
              : 'event.incident_created',
        {
          incidentId: newIncident.id,
          dedupKey: dedup_key,
          source: normalizedSource,
          severity: eventData.severity,
          urgency: effectiveUrgency,
          maintenanceWindowId: maintenanceWindow?.id,
          ...(noise
            ? { noiseControl: noise.control, noiseAction: noise.action, noiseApplied: noise.apply }
            : {}),
        }
      );

      await persistAutomation(
        tx,
        newIncident.id,
        envelope,
        automation,
        !suppressed && !stormParent,
        service.escalationPolicyId
      );

      if (stormParent) {
        await linkStormChild(tx, {
          parentIncidentId: stormParent.id,
          childIncidentId: newIncident.id,
          evidence: applied!.evidence,
        });
        // The parent pages for the whole storm, so it carries the most urgent child's urgency.
        const parentUrgency = maxUrgency(stormParent.urgency, effectiveUrgency);
        let parentReleased = false;
        // Conditional so concurrent children only ever raise it: a lower child never overwrites a higher one.
        const parentRaised =
          parentUrgency !== stormParent.urgency &&
          (
            await tx.incident.updateMany({
              where: {
                id: stormParent.id,
                urgency: {
                  in: (Object.keys(URGENCY_RANK) as IncidentUrgency[]).filter(
                    level => URGENCY_RANK[level] < URGENCY_RANK[parentUrgency]
                  ),
                },
              },
              data: { urgency: parentUrgency },
            })
          ).count > 0;
        if (parentRaised) {
          const previousUrgency = stormParent.urgency;
          parentReleased = (
            await reconcileIncidentEngagementAfterUrgencyChange(tx, {
              incidentId: stormParent.id,
              previousUrgency,
              urgency: parentUrgency,
            })
          ).released;
        }
        await tx.incidentEvent.create({
          data: {
            incidentId: stormParent.id,
            message: truncateString(
              `Storm child grouped under this incident: "${sanitizedTitle}" (${newIncident.id}) from ${normalizedSource}. ${applied!.reason}.${parentRaised ? ` Urgency raised to ${parentUrgency}.` : ''}${parentReleased ? ' Support-hours engagement deferral released.' : ''}`,
              1_000
            ),
          },
        });
        // Only the service-channel post is queued, and it rolls up under the parent's notification.
        await enqueueStormChildSideEffects(tx, newIncident.id, {
          escalationGeneration: newIncident.escalationGeneration ?? 0,
          status: newIncident.status,
        });
      }

      if (!suppressed && !stormParent) {
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
          notBefore: deliveryNotBefore,
          generation: newIncident.escalationGeneration ?? 0,
          routing: inMemoryRouting,
        });
        await enqueueEventSideEffects(
          tx,
          'triggered',
          newIncident.id,
          deliveryNotBefore,
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
        ...(attachRunbookIds ? { attachRunbookIds } : {}),
      });

      if (noise) {
        if (pipeline) noise.evidence = { ...noise.evidence, pipeline };
        // SHADOW and ON decisions are both recorded against the alert they were made for.
        const alert = await tx.alert.findFirst({
          where: { incidentId: newIncident.id },
          select: { id: true },
        });
        await recordIngestNoiseDecision(tx, noise, {
          serviceId,
          alertId: alert?.id ?? null,
          incidentId: newIncident.id,
        });
      }

      return {
        action: suppressed
          ? ('suppressed' as const)
          : stormParent
            ? ('grouped' as const)
            : ('triggered' as const),
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

    if (event_action === 'resolve' && existingIncident!.openOtherAlertKeys) {
      // Content dedup appended other keys to this incident and some still fire: it stays open.
      const openKeys = existingIncident!.openOtherAlertKeys;
      await tx.incidentEvent.create({
        data: {
          incidentId: existingIncident!.id,
          message: `Alert cleared by event from ${normalizedSource}; ${openKeys} other alert ${openKeys === 1 ? 'key is' : 'keys are'} still firing, so the incident stays open.`,
        },
      });
      logger.info('event.alert_resolved_incident_open', {
        incidentId: existingIncident!.id,
        dedupKey: dedup_key,
        source: normalizedSource,
        openOtherAlertKeys: openKeys,
      });
      delete existingIncident!.openOtherAlertKeys;
      return { action: 'alert_resolved' as const, incident: existingIncident! };
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

  // The paging transaction is already durable. A lost hint only delays optional analysis.
  if ('incident' in result && result.incident?.id) signalIntelligenceIncident(result.incident.id);

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
