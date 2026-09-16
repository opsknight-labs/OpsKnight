import { beforeEach, describe, expect, it } from 'vitest';
import {
  OPERATIONAL_METRICS,
  OperationalMetricSnapshot,
  clearRuntimeOperationalMetrics,
  runtimeOperationalMetrics,
} from '@/lib/metrics/operational/registry';
import {
  observeMeetingCloseDuration,
  observeMeetingProvisionDuration,
  recordMeetingCloseOutcome,
  recordMeetingProvisionOutcome,
  recordMeetingReconciliationOutcome,
  recordMeetingRetry,
  setMeetingCleanupPendingGauge,
  setMeetingHealthGauge,
  setMeetingStateGauge,
} from '@/lib/incident-collaboration/meeting-metrics';
import {
  COLLABORATION_INVARIANTS,
  InvariantPredicates,
} from '@/lib/incident-collaboration/invariants';

describe('Incident Collaboration Metrics & Invariants Contract', () => {
  beforeEach(() => {
    clearRuntimeOperationalMetrics();
  });

  describe('Invariant I14: Bounded Cardinality Guard', () => {
    it('strictly forbids high-cardinality labels in all operational metrics', () => {
      const FORBIDDEN_LABELS = [
        'incidentid',
        'meetingid',
        'warroomid',
        'userid',
        'user_id',
        'channelid',
        'channel_id',
        'tenantid',
        'tenant_id',
        'email',
        'providermeetingid',
        'provider_meeting_id',
        'token',
        'provisioningtoken',
      ];

      for (const metric of OPERATIONAL_METRICS) {
        for (const label of metric.labels as readonly string[]) {
          const lower = label.toLowerCase();
          expect(
            FORBIDDEN_LABELS.includes(lower),
            `Metric "${metric.name}" uses forbidden high-cardinality label "${label}"`
          ).toBe(false);
        }
      }
    });

    it('enforces total series cardinality budget across all registered operational metrics', () => {
      const totalEstimated = OPERATIONAL_METRICS.reduce(
        (sum, m) => sum + (m.estimatedMaxSeries ?? 0),
        0
      );
      expect(totalEstimated).toBeLessThan(10_000);
    });
  });

  describe('Meeting Metric Definitions', () => {
    const REQUIRED_MEETING_METRICS = [
      'opsknight_meeting_state',
      'opsknight_meeting_health',
      'opsknight_meeting_provision_total',
      'opsknight_meeting_provision_duration_seconds',
      'opsknight_meeting_close_total',
      'opsknight_meeting_close_duration_seconds',
      'opsknight_meeting_retry_total',
      'opsknight_meeting_cleanup_pending',
      'opsknight_meeting_reconciliation_total',
    ];

    it('registers all required Phase 6 operational metrics', () => {
      const names = new Set(OPERATIONAL_METRICS.map(m => m.name));
      for (const req of REQUIRED_MEETING_METRICS) {
        expect(names.has(req as never), `Missing registered metric: ${req}`).toBe(true);
      }
    });

    it('uses correct label shapes for meeting metrics', () => {
      const stateMetric = OPERATIONAL_METRICS.find(m => m.name === 'opsknight_meeting_state');
      expect(stateMetric?.labels).toEqual(['provider', 'state']);

      const healthMetric = OPERATIONAL_METRICS.find(m => m.name === 'opsknight_meeting_health');
      expect(healthMetric?.labels).toEqual(['provider', 'health']);

      const provisionMetric = OPERATIONAL_METRICS.find(
        m => m.name === 'opsknight_meeting_provision_total'
      );
      expect(provisionMetric?.labels).toEqual(['provider', 'result']);

      const retryMetric = OPERATIONAL_METRICS.find(m => m.name === 'opsknight_meeting_retry_total');
      expect(retryMetric?.labels).toEqual(['provider', 'operation', 'reason']);
    });
  });

  describe('Meeting Metric Producers', () => {
    it('records provision outcome counters and duration histograms', () => {
      recordMeetingProvisionOutcome('MICROSOFT_TEAMS', 'success');
      recordMeetingProvisionOutcome('MICROSOFT_TEAMS', 'retry');
      observeMeetingProvisionDuration('MICROSOFT_TEAMS', 1.45);

      const runtime = runtimeOperationalMetrics();
      const provisionEntries = runtime.get('opsknight_meeting_provision_total') || [];
      expect(provisionEntries.length).toBeGreaterThanOrEqual(1);

      const successEntry = provisionEntries.find(
        e => e.labels.provider === 'MICROSOFT_TEAMS' && e.labels.result === 'success'
      );
      expect(successEntry?.value).toBe(1);

      const rendered = new OperationalMetricSnapshot().render();
      expect(rendered).toContain('# TYPE opsknight_meeting_provision_duration_seconds histogram');
      expect(rendered).toContain(
        'opsknight_meeting_provision_duration_seconds_count{provider="MICROSOFT_TEAMS"} 1'
      );
    });

    it('records close outcome counters and duration histograms', () => {
      recordMeetingCloseOutcome('MICROSOFT_TEAMS', 'success');
      observeMeetingCloseDuration('MICROSOFT_TEAMS', 0.85);

      const runtime = runtimeOperationalMetrics();
      const closeEntries = runtime.get('opsknight_meeting_close_total') || [];
      const entry = closeEntries.find(
        e => e.labels.provider === 'MICROSOFT_TEAMS' && e.labels.result === 'success'
      );
      expect(entry?.value).toBe(1);

      const rendered = new OperationalMetricSnapshot().render();
      expect(rendered).toContain('# TYPE opsknight_meeting_close_duration_seconds histogram');
      expect(rendered).toContain(
        'opsknight_meeting_close_duration_seconds_count{provider="MICROSOFT_TEAMS"} 1'
      );
    });

    it('records meeting retries with normalized reasons', () => {
      recordMeetingRetry('MICROSOFT_TEAMS', 'provision', 'rate_limit');
      recordMeetingRetry('MICROSOFT_TEAMS', 'close', 'timeout');

      const runtime = runtimeOperationalMetrics();
      const retryEntries = runtime.get('opsknight_meeting_retry_total') || [];
      expect(retryEntries).toHaveLength(2);
    });

    it('records reconciliation outcomes and cleanup debt gauges', () => {
      recordMeetingReconciliationOutcome('MICROSOFT_TEAMS', 'success');
      setMeetingCleanupPendingGauge('MICROSOFT_TEAMS', 3);
      setMeetingStateGauge('MICROSOFT_TEAMS', 'READY', 10);
      setMeetingHealthGauge('MICROSOFT_TEAMS', 'HEALTHY', 10);

      const runtime = runtimeOperationalMetrics();
      const cleanupPending = runtime.get('opsknight_meeting_cleanup_pending') || [];
      expect(cleanupPending[0]?.value).toBe(3);

      const stateGauge = runtime.get('opsknight_meeting_state') || [];
      expect(stateGauge[0]?.value).toBe(10);
    });
  });

  describe('Invariant Predicates', () => {
    it('verifies all 15 invariants (I1 - I15) are defined in constants', () => {
      expect(Object.keys(COLLABORATION_INVARIANTS)).toHaveLength(15);
      expect(COLLABORATION_INVARIANTS.I1).toBeDefined();
      expect(COLLABORATION_INVARIANTS.I15).toBeDefined();
    });

    it('evaluates hasSingleMeetingOwner predicate (I1)', () => {
      expect(InvariantPredicates.hasSingleMeetingOwner(['token-a'])).toBe(true);
      expect(InvariantPredicates.hasSingleMeetingOwner(['token-a', 'token-a'])).toBe(true);
      expect(InvariantPredicates.hasSingleMeetingOwner(['token-a', 'token-b'])).toBe(false);
    });

    it('evaluates isJobGenerationFresh predicate (I3)', () => {
      expect(InvariantPredicates.isJobGenerationFresh(1, 1)).toBe(true);
      expect(InvariantPredicates.isJobGenerationFresh(1, 2)).toBe(false);
    });

    it('evaluates doesClosedTakePrecedence predicate (I4)', () => {
      expect(InvariantPredicates.doesClosedTakePrecedence('READY', 'CLOSING')).toBe(false);
      expect(InvariantPredicates.doesClosedTakePrecedence('CLOSED', 'CLOSING')).toBe(true);
      expect(InvariantPredicates.doesClosedTakePrecedence('READY', 'PROVISIONING')).toBe(true);
    });

    it('evaluates doAllRoomsProjectCanonicalMeeting predicate (I10)', () => {
      const url = 'https://teams.microsoft.com/l/meetup-join/abc';
      expect(InvariantPredicates.doAllRoomsProjectCanonicalMeeting([url, url], url)).toBe(true);
      expect(
        InvariantPredicates.doAllRoomsProjectCanonicalMeeting(
          [url, 'https://teams.microsoft.com/l/meetup-join/other'],
          url
        )
      ).toBe(false);
    });
  });
});
