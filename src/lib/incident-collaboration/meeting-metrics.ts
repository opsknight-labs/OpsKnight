/**
 * Incident Meeting Operational Metrics Producers
 *
 * Emits strictly bounded, low-cardinality operational telemetry for
 * incident meeting provisioning, closing, retries, and reconciliation.
 *
 * Invariant I14: No operational metric uses high-cardinality identifiers
 * (incidentId, meetingId, userId, tenantId, email, providerMeetingId).
 */

import {
  addOperationalMetric,
  observeOperationalHistogram,
  setOperationalGauge,
} from '@/lib/metrics/operational/registry';
import type { IncidentMeetingProvider } from './types';
import { InvariantPredicates } from './invariants';

export type MeetingMetricResult = 'success' | 'retry' | 'failed' | 'stale' | 'skipped';

export type MeetingMetricOperation = 'provision' | 'close' | 'reconcile' | 'cleanup';

export type MeetingMetricRetryReason =
  | 'rate_limit'
  | 'permission'
  | 'network'
  | 'provider_5xx'
  | 'timeout'
  | 'stale_generation'
  | 'cleanup';

function assertBoundedLabels(labels: Record<string, string | number>): void {
  const labelKeys = Object.keys(labels);
  if (!InvariantPredicates.isMetricLabelSetAllowed(labelKeys)) {
    throw new Error(
      `Forbidden high-cardinality label detected in meeting telemetry: ${labelKeys.join(', ')}`
    );
  }
}

/**
 * Record outcome of an incident meeting provision attempt.
 */
export function recordMeetingProvisionOutcome(
  provider: IncidentMeetingProvider,
  result: MeetingMetricResult
): void {
  const labels = { provider, result };
  assertBoundedLabels(labels);
  addOperationalMetric('opsknight_meeting_provision_total', 1, labels);
}

/**
 * Record latency for incident meeting provisioning.
 */
export function observeMeetingProvisionDuration(
  provider: IncidentMeetingProvider,
  durationSeconds: number
): void {
  const labels = { provider };
  assertBoundedLabels(labels);
  observeOperationalHistogram(
    'opsknight_meeting_provision_duration_seconds',
    Math.max(0, durationSeconds),
    labels
  );
}

/**
 * Record outcome of an incident meeting close attempt.
 */
export function recordMeetingCloseOutcome(
  provider: IncidentMeetingProvider,
  result: MeetingMetricResult
): void {
  const labels = { provider, result };
  assertBoundedLabels(labels);
  addOperationalMetric('opsknight_meeting_close_total', 1, labels);
}

/**
 * Record latency for incident meeting close/detachment.
 */
export function observeMeetingCloseDuration(
  provider: IncidentMeetingProvider,
  durationSeconds: number
): void {
  const labels = { provider };
  assertBoundedLabels(labels);
  observeOperationalHistogram(
    'opsknight_meeting_close_duration_seconds',
    Math.max(0, durationSeconds),
    labels
  );
}

/**
 * Record a meeting operation retry with normalized reason.
 */
export function recordMeetingRetry(
  provider: IncidentMeetingProvider,
  operation: MeetingMetricOperation,
  reason: MeetingMetricRetryReason
): void {
  const labels = { provider, operation, reason };
  assertBoundedLabels(labels);
  addOperationalMetric('opsknight_meeting_retry_total', 1, labels);
}

/**
 * Record outcome of a meeting reconciliation pass.
 */
export function recordMeetingReconciliationOutcome(
  provider: IncidentMeetingProvider,
  result: MeetingMetricResult
): void {
  const labels = { provider, result };
  assertBoundedLabels(labels);
  addOperationalMetric('opsknight_meeting_reconciliation_total', 1, labels);
}

/**
 * Update the gauge for meetings with pending external cleanup debt.
 */
export function setMeetingCleanupPendingGauge(
  provider: IncidentMeetingProvider,
  count: number
): void {
  const labels = { provider };
  assertBoundedLabels(labels);
  setOperationalGauge('opsknight_meeting_cleanup_pending', Math.max(0, count), labels);
}

/**
 * Update the distribution gauges for meeting lifecycle state.
 */
export function setMeetingStateGauge(
  provider: IncidentMeetingProvider,
  state: string,
  count: number
): void {
  const labels = { provider, state };
  assertBoundedLabels(labels);
  setOperationalGauge('opsknight_meeting_state', Math.max(0, count), labels);
}

/**
 * Update the distribution gauges for meeting operational health.
 */
export function setMeetingHealthGauge(
  provider: IncidentMeetingProvider,
  health: string,
  count: number
): void {
  const labels = { provider, health };
  assertBoundedLabels(labels);
  setOperationalGauge('opsknight_meeting_health', Math.max(0, count), labels);
}

const ALL_PROVIDERS: IncidentMeetingProvider[] = [
  'MICROSOFT_TEAMS',
  'ZOOM',
  'GOOGLE_MEET',
  'JITSI',
  'NONE',
];

const ALL_STATES = ['REQUESTED', 'PROVISIONING', 'READY', 'CLOSING', 'CLOSED', 'FAILED'];

const ALL_HEALTHS = ['HEALTHY', 'DEGRADED', 'UNAVAILABLE'];

/**
 * Periodically produce snapshot gauges from the database for:
 * - provider x state
 * - provider x health
 * - provider x cleanup debt
 * Explicitly writes zeros for missing bounded combinations to prevent stale gauges.
 */
export async function collectIncidentCollaborationMetricsFromDB(): Promise<void> {
  const prisma = (await import('@/lib/prisma')).default;
  if (!prisma?.incidentMeeting?.groupBy) return;

  try {
    const [stateGroups, healthGroups, debtGroups] = await Promise.all([
      prisma.incidentMeeting.groupBy({
        by: ['provider', 'state'],
        _count: { id: true },
      }),
      prisma.incidentMeeting.groupBy({
        by: ['provider', 'health'],
        _count: { id: true },
      }),
      prisma.incidentMeeting.groupBy({
        by: ['provider'],
        where: { externalCleanupPending: true },
        _count: { id: true },
      }),
    ]);

    const stateMap = new Map<string, number>();
    for (const g of stateGroups) {
      stateMap.set(`${g.provider}:${g.state}`, g._count.id);
    }

    const healthMap = new Map<string, number>();
    for (const g of healthGroups) {
      healthMap.set(`${g.provider}:${g.health}`, g._count.id);
    }

    const debtMap = new Map<string, number>();
    for (const g of debtGroups) {
      debtMap.set(g.provider, g._count.id);
    }

    // Explicitly write zero for all bounded combinations
    for (const provider of ALL_PROVIDERS) {
      setMeetingCleanupPendingGauge(provider, debtMap.get(provider) ?? 0);

      for (const state of ALL_STATES) {
        setMeetingStateGauge(provider, state, stateMap.get(`${provider}:${state}`) ?? 0);
      }

      for (const health of ALL_HEALTHS) {
        setMeetingHealthGauge(provider, health, healthMap.get(`${provider}:${health}`) ?? 0);
      }
    }
  } catch {
    // Non-blocking in degraded DB or unit test environment
  }
}
