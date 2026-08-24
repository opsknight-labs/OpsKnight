import { describe, it, expect } from 'vitest';
import { serializeSlaMetrics, serializeRecentIncidents, type SLAMetrics } from '@/lib/sla';

describe('SLA Metrics Serialization', () => {
  describe('serializeRecentIncidents', () => {
    it('should convert Date fields to ISO strings', () => {
      const incidents = [
        {
          id: 'inc-1',
          title: 'Test Incident',
          description: 'Test description',
          status: 'OPEN',
          urgency: 'HIGH',
          createdAt: new Date('2026-01-01T10:00:00.000Z'),
          resolvedAt: new Date('2026-01-01T12:00:00.000Z'),
          service: { id: 'svc-1', name: 'Test Service', region: 'us-east' },
        },
      ];

      const serialized = serializeRecentIncidents(incidents);

      expect(serialized).toHaveLength(1);
      expect(serialized[0].createdAt).toBe('2026-01-01T10:00:00.000Z');
      expect(serialized[0].resolvedAt).toBe('2026-01-01T12:00:00.000Z');
      expect(serialized[0].id).toBe('inc-1');
      expect(serialized[0].title).toBe('Test Incident');
    });

    it('should handle null resolvedAt', () => {
      const incidents = [
        {
          id: 'inc-2',
          title: 'Unresolved Incident',
          description: null,
          status: 'OPEN',
          urgency: 'MEDIUM',
          createdAt: new Date('2026-01-02T08:00:00.000Z'),
          resolvedAt: null,
          service: { id: 'svc-2', name: 'Service Two' },
        },
      ];

      const serialized = serializeRecentIncidents(incidents);

      expect(serialized[0].createdAt).toBe('2026-01-02T08:00:00.000Z');
      expect(serialized[0].resolvedAt).toBeNull();
    });

    it('should return empty array for undefined input', () => {
      const serialized = serializeRecentIncidents(undefined);
      expect(serialized).toEqual([]);
    });

    it('should return empty array for empty input', () => {
      const serialized = serializeRecentIncidents([]);
      expect(serialized).toEqual([]);
    });
  });

  describe('serializeSlaMetrics', () => {
    it('should serialize recentIncidents within full metrics object', () => {
      // Create a minimal SLAMetrics object for testing
      const metrics: SLAMetrics = {
        mttr: 60,
        mttd: 15,
        mtti: 5,
        mttk: 10,
        mttaP50: 10,
        mttaP95: 20,
        mttrP50: 45,
        mttrP95: 90,
        mtbfMs: 86400000,
        ackCompliance: 95,
        resolveCompliance: 90,
        ackBreaches: 2,
        resolveBreaches: 1,
        totalIncidents: 10,
        resolvedIncidents: 8,
        activeIncidents: 2,
        unassignedActive: 0,
        highUrgencyCount: 3,
        mediumUrgencyCount: 2,
        lowUrgencyCount: 1,
        alertsCount: 15,
        openCount: 1,
        acknowledgedCount: 1,
        snoozedCount: 0,
        suppressedCount: 0,
        resolved24h: 5,
        dynamicStatus: 'OPERATIONAL',
        activeCount: 2,
        criticalCount: 1,
        ackRate: 80,
        resolveRate: 75,
        highUrgencyRate: 30,
        afterHoursRate: 20,
        alertsPerIncident: 1.5,
        escalationRate: 10,
        reopenRate: 5,
        autoResolveRate: 15,
        previousPeriod: {
          totalIncidents: 8,
          highUrgencyCount: 2,
          mtta: 12,
          mttr: 55,
          ackRate: 75,
          resolveRate: 70,
        },
        coveragePercent: 100,
        coverageGapDays: 0,
        onCallHoursMs: 168 * 60 * 60 * 1000,
        onCallUsersCount: 5,
        activeOverrides: 0,
        autoResolvedCount: 3,
        manualResolvedCount: 7,
        eventsCount: 50,
        avgLatencyP99: 150,
        errorRate: 0.5,
        totalRequests: 10000,
        saturation: 45,
        trendSeries: [],
        statusMix: [],
        urgencyMix: [],
        topServices: [],
        assigneeLoad: [],
        statusAges: [],
        onCallLoad: [],
        serviceSlaTable: [],
        recurringTitles: [],
        eventsPerIncident: 5,
        heatmapData: [],
        // Retention metadata
        effectiveStart: new Date('2026-01-01T00:00:00.000Z'),
        effectiveEnd: new Date('2026-01-08T00:00:00.000Z'),
        requestedStart: new Date('2026-01-01T00:00:00.000Z'),
        requestedEnd: new Date('2026-01-08T00:00:00.000Z'),
        isClipped: false,
        retentionDays: 90,
        serviceMetrics: [],
        insights: [],
        currentShifts: [],
        recentIncidents: [
          {
            id: 'inc-test',
            title: 'Test',
            description: null,
            status: 'RESOLVED',
            urgency: 'LOW',
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            resolvedAt: new Date('2026-01-01T01:00:00.000Z'),
            service: { id: 's1', name: 'Svc1' },
          },
        ],
      };

      const serialized = serializeSlaMetrics(metrics);

      // Check that recentIncidents are serialized
      expect(serialized.recentIncidents).toBeDefined();
      expect(serialized.recentIncidents![0].createdAt).toBe('2026-01-01T00:00:00.000Z');
      expect(serialized.recentIncidents![0].resolvedAt).toBe('2026-01-01T01:00:00.000Z');

      // Check retention fields
      expect(serialized.effectiveStart).toBe('2026-01-01T00:00:00.000Z');
      expect(serialized.effectiveEnd).toBe('2026-01-08T00:00:00.000Z');
      expect(serialized.requestedStart).toBe('2026-01-01T00:00:00.000Z');
      expect(serialized.requestedEnd).toBe('2026-01-08T00:00:00.000Z');

      // Check that other fields are preserved
      expect(serialized.mttr).toBe(60);
      expect(serialized.totalIncidents).toBe(10);
      expect(serialized.dynamicStatus).toBe('OPERATIONAL');
    });

    it('should handle undefined recentIncidents', () => {
      const metrics: SLAMetrics = {
        mttr: null,
        mttd: null,
        mtti: null,
        mttk: null,
        mttaP50: null,
        mttaP95: null,
        mttrP50: null,
        mttrP95: null,
        mtbfMs: null,
        ackCompliance: 0,
        resolveCompliance: 0,
        ackBreaches: 0,
        resolveBreaches: 0,
        totalIncidents: 0,
        resolvedIncidents: 0,
        activeIncidents: 0,
        unassignedActive: 0,
        highUrgencyCount: 0,
        mediumUrgencyCount: 0,
        lowUrgencyCount: 0,
        alertsCount: 0,
        openCount: 0,
        acknowledgedCount: 0,
        snoozedCount: 0,
        suppressedCount: 0,
        resolved24h: 0,
        dynamicStatus: 'OPERATIONAL' as const,
        activeCount: 0,
        criticalCount: 0,
        ackRate: 0,
        resolveRate: 0,
        highUrgencyRate: 0,
        afterHoursRate: 0,
        alertsPerIncident: 0,
        escalationRate: 0,
        reopenRate: 0,
        autoResolveRate: 0,
        previousPeriod: {
          totalIncidents: 0,
          highUrgencyCount: 0,
          mtta: null,
          mttr: null,
          ackRate: 0,
          resolveRate: 0,
        },
        coveragePercent: 0,
        coverageGapDays: 0,
        onCallHoursMs: 0,
        onCallUsersCount: 0,
        activeOverrides: 0,
        autoResolvedCount: 0,
        manualResolvedCount: 0,
        eventsCount: 0,
        avgLatencyP99: null,
        errorRate: null,
        totalRequests: 0,
        saturation: null,
        trendSeries: [],
        statusMix: [],
        urgencyMix: [],
        topServices: [],
        assigneeLoad: [],
        statusAges: [],
        onCallLoad: [],
        serviceSlaTable: [],
        recurringTitles: [],
        eventsPerIncident: 0,
        heatmapData: [],
        // Retention metadata
        effectiveStart: new Date('2026-01-01T00:00:00.000Z'),
        effectiveEnd: new Date('2026-01-08T00:00:00.000Z'),
        requestedStart: new Date('2026-01-01T00:00:00.000Z'),
        requestedEnd: new Date('2026-01-08T00:00:00.000Z'),
        isClipped: false,
        retentionDays: 90,
        serviceMetrics: [],
        insights: [],
        currentShifts: [],
        // No recentIncidents
      };

      const serialized = serializeSlaMetrics(metrics);
      expect(serialized.recentIncidents).toBeUndefined();
    });
  });
});
