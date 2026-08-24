import { describe, it, expect } from 'vitest';
import {
  calculateMTTA,
  calculateMTTR,
  checkAckSLA,
  checkResolveSLA,
  serializeSlaMetrics,
  SLAMetrics,
} from '@/lib/sla';

describe('SLA (Service Level Agreement) Tracking', () => {
  describe('calculateMTTA', () => {
    it('should calculate Mean Time To Acknowledge in milliseconds', () => {
      const createdAt = new Date('2024-01-01T10:00:00.000Z');
      const acknowledgedAt = new Date('2024-01-01T10:15:00.000Z');

      const mtta = calculateMTTA({ createdAt, acknowledgedAt });

      expect(mtta).toBe(15 * 60 * 1000); // 15 minutes in ms
    });

    it('should return null when incident is not acknowledged', () => {
      const createdAt = new Date('2024-01-01T10:00:00.000Z');

      const mtta = calculateMTTA({ createdAt, acknowledgedAt: null });

      expect(mtta).toBeNull();
    });
  });

  describe('calculateMTTR', () => {
    it('should calculate Mean Time To Resolve in milliseconds', () => {
      const createdAt = new Date('2024-01-01T10:00:00.000Z');
      const resolvedAt = new Date('2024-01-01T11:30:00.000Z');

      const mttr = calculateMTTR({ createdAt, resolvedAt });

      expect(mttr).toBe(90 * 60 * 1000); // 90 minutes in ms
    });

    it('should return null when incident is unresolved', () => {
      const createdAt = new Date('2024-01-01T10:00:00.000Z');

      const mttr = calculateMTTR({ createdAt, resolvedAt: null });

      expect(mttr).toBeNull();
    });
  });

  describe('checkAckSLA', () => {
    it('should return true when acknowledgement is within target SLA', () => {
      const createdAt = new Date('2024-01-01T12:00:00.000Z');
      const acknowledgedAt = new Date('2024-01-01T12:10:00.000Z'); // 10 mins

      const metCustom = checkAckSLA({ createdAt, acknowledgedAt }, { targetAckMinutes: 20 });
      const metDefault = checkAckSLA(
        { createdAt, acknowledgedAt },
        {} // default 15 mins
      );

      expect(metCustom).toBe(true);
      expect(metDefault).toBe(true);
    });

    it('should return false when acknowledgement breaches SLA or is unacknowledged', () => {
      const createdAt = new Date('2024-01-01T12:00:00.000Z');
      const lateAckAt = new Date('2024-01-01T12:30:00.000Z'); // 30 mins

      const breached = checkAckSLA(
        { createdAt, acknowledgedAt: lateAckAt },
        { targetAckMinutes: 15 }
      );
      const unacked = checkAckSLA({ createdAt, acknowledgedAt: null }, { targetAckMinutes: 15 });

      expect(breached).toBe(false);
      expect(unacked).toBe(false);
    });
  });

  describe('checkResolveSLA', () => {
    it('should return true when resolution is within target SLA', () => {
      const createdAt = new Date('2024-01-01T12:00:00.000Z');
      const resolvedAt = new Date('2024-01-01T13:00:00.000Z'); // 60 mins

      const met = checkResolveSLA({ createdAt, resolvedAt }, { targetResolveMinutes: 120 });

      expect(met).toBe(true);
    });

    it('should return false when resolution exceeds target SLA or is unresolved', () => {
      const createdAt = new Date('2024-01-01T12:00:00.000Z');
      const lateResolvedAt = new Date('2024-01-01T15:00:00.000Z'); // 180 mins

      const breached = checkResolveSLA(
        { createdAt, resolvedAt: lateResolvedAt },
        { targetResolveMinutes: 120 }
      );
      const unresolved = checkResolveSLA(
        { createdAt, resolvedAt: null },
        { targetResolveMinutes: 120 }
      );

      expect(breached).toBe(false);
      expect(unresolved).toBe(false);
    });
  });

  describe('serializeSlaMetrics', () => {
    it('should convert all Date objects to ISO strings for API serialization', () => {
      const mockMetrics: SLAMetrics = {
        effectiveStart: new Date('2024-01-01T00:00:00.000Z'),
        effectiveEnd: new Date('2024-01-31T23:59:59.999Z'),
        requestedStart: new Date('2024-01-01T00:00:00.000Z'),
        requestedEnd: new Date('2024-01-31T23:59:59.999Z'),
        isClipped: false,
        retentionDays: 30,
        mttr: 45,
        mttd: null,
        mtti: null,
        mttk: null,
        mttaP50: 5,
        mttaP95: 12,
        mttrP50: 30,
        mttrP95: 90,
        mtbfMs: 86400000,
        ackCompliance: 98.5,
        resolveCompliance: 95.0,
        ackBreaches: 1,
        resolveBreaches: 2,
        totalIncidents: 20,
        resolvedIncidents: 18,
        activeIncidents: 2,
        unassignedActive: 0,
        highUrgencyCount: 4,
        mediumUrgencyCount: 10,
        lowUrgencyCount: 6,
        alertsCount: 45,
        openCount: 1,
        acknowledgedCount: 1,
        snoozedCount: 0,
        suppressedCount: 0,
        resolved24h: 3,
        dynamicStatus: 'OPERATIONAL',
        activeCount: 2,
        criticalCount: 0,
        ackRate: 95.0,
        resolveRate: 90.0,
        highUrgencyRate: 20.0,
        afterHoursRate: 10.0,
        alertsPerIncident: 2.25,
        escalationRate: 5.0,
        reopenRate: 0,
        autoResolveRate: 10.0,
        previousPeriod: {
          totalIncidents: 15,
          highUrgencyCount: 3,
          mtta: 6,
          mttr: 50,
          ackRate: 93.3,
          resolveRate: 86.6,
        },
        coveragePercent: 100,
        coverageGapDays: 0,
        onCallHoursMs: 744 * 3600 * 1000,
        onCallUsersCount: 4,
        activeOverrides: 0,
        autoResolvedCount: 2,
        manualResolvedCount: 16,
        eventsCount: 80,
        avgLatencyP99: 120,
        errorRate: 0.01,
        totalRequests: 100000,
        saturation: 45.2,
        trendSeries: [],
        statusMix: [{ status: 'RESOLVED', count: 18 }],
        urgencyMix: [{ urgency: 'HIGH', count: 4 }],
        topServices: [{ id: 'svc-1', name: 'API Gateway', count: 12 }],
        assigneeLoad: [{ id: 'user-1', name: 'Alice', count: 10 }],
        statusAges: [{ status: 'RESOLVED', avgMs: 2700000 }],
        onCallLoad: [],
        serviceSlaTable: [],
        recurringTitles: [],
        eventsPerIncident: 4,
        heatmapData: [],
        serviceMetrics: [],
        insights: [{ type: 'positive', text: 'MTTR improved by 10%' }],
        currentShifts: [],
        recentIncidents: [
          {
            id: 'inc-1',
            title: 'High latency on checkout',
            description: 'Database query slow',
            status: 'RESOLVED',
            urgency: 'HIGH',
            createdAt: new Date('2024-01-15T08:00:00.000Z'),
            resolvedAt: new Date('2024-01-15T08:45:00.000Z'),
            service: { id: 'svc-1', name: 'Checkout' },
          },
        ],
      };

      const serialized = serializeSlaMetrics(mockMetrics);

      expect(serialized.effectiveStart).toBe('2024-01-01T00:00:00.000Z');
      expect(serialized.effectiveEnd).toBe('2024-01-31T23:59:59.999Z');
      expect(serialized.requestedStart).toBe('2024-01-01T00:00:00.000Z');
      expect(serialized.requestedEnd).toBe('2024-01-31T23:59:59.999Z');
      expect(serialized.recentIncidents?.[0].createdAt).toBe('2024-01-15T08:00:00.000Z');
      expect(serialized.recentIncidents?.[0].resolvedAt).toBe('2024-01-15T08:45:00.000Z');
      expect(serialized.ackCompliance).toBe(98.5);
      expect(serialized.totalIncidents).toBe(20);
    });
  });
});
