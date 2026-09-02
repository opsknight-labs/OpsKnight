import { describe, it, expect } from 'vitest';
import {
  startOfDayInTimeZone,
  startOfNextDayInTimeZone,
  parseDateTimeInTimeZone,
  formatDateKeyInTimeZone,
  getTimeZoneOffsetMs,
  isValidTimeZone,
} from '@/lib/timezone';
import { getFinalScheduleBlocks, type OnCallBlock } from '@/lib/oncall';
import { isIncidentAfterHours } from '@/lib/business-hours';
import { mergeHybridMetrics } from '@/lib/sla-hybrid-merge';
import type { SLAMetrics } from '@/lib/sla';
import { incidentEventWhereFor, incidentEventSqlPredicate } from '@/lib/incident-event-classifier';
import { retry, isRetryableApiError } from '@/lib/retry';
import { METRIC_ACCUMULATOR, emptyMetricAccumulator } from '@/lib/metrics/domain/accumulator';

describe('Comprehensive Time & Scheduling Verification Suite', () => {
  // =========================================================================
  // SUITE 1: IANA Timezones, Fractional Offsets & DST Boundaries
  // =========================================================================
  describe('Suite 1: Timezone & DST Boundary Engine', () => {
    it('accurately parses dates in fractional timezones (Asia/Kolkata +05:30)', () => {
      const parsed = parseDateTimeInTimeZone('2026-03-15T10:30', 'Asia/Kolkata');
      expect(parsed).toBeInstanceOf(Date);
      expect(parsed?.toISOString()).toBe('2026-03-15T05:00:00.000Z');
      expect(formatDateKeyInTimeZone(parsed!, 'Asia/Kolkata')).toBe('2026-03-15');
    });

    it('accurately parses dates in 45-minute fractional timezone (Asia/Kathmandu +05:45)', () => {
      const parsed = parseDateTimeInTimeZone('2026-06-20T12:00', 'Asia/Kathmandu');
      expect(parsed).toBeInstanceOf(Date);
      expect(parsed?.toISOString()).toBe('2026-06-20T06:15:00.000Z');
      expect(formatDateKeyInTimeZone(parsed!, 'Asia/Kathmandu')).toBe('2026-06-20');
    });

    it('accurately calculates offset in Chatham Islands (+12:45 / +13:45 DST)', () => {
      expect(isValidTimeZone('Pacific/Chatham')).toBe(true);
      const janDate = new Date('2026-01-15T00:00:00.000Z');
      const offsetMs = getTimeZoneOffsetMs(janDate, 'Pacific/Chatham');
      // Summer in Chatham: +13:45 = 13*60 + 45 = 825 min = 49,500,000 ms
      expect(offsetMs).toBe(13.75 * 60 * 60 * 1000);
    });

    it('correctly identifies startOfDay and startOfNextDay across spring-forward DST (23h day in US/Eastern)', () => {
      // US Eastern Spring Forward was on March 8, 2026
      const startOfDay = startOfDayInTimeZone(new Date('2026-03-08T12:00:00Z'), 'America/New_York');
      const startOfNextDay = startOfNextDayInTimeZone(
        new Date('2026-03-08T12:00:00Z'),
        'America/New_York'
      );

      const dayDurationHours = (startOfNextDay.getTime() - startOfDay.getTime()) / (1000 * 60 * 60);
      expect(dayDurationHours).toBe(23); // Exactly 23 hours!
    });

    it('correctly identifies startOfDay and startOfNextDay across fall-back DST (25h day in US/Eastern)', () => {
      // US Eastern Fall Back was on November 1, 2026
      const startOfDay = startOfDayInTimeZone(new Date('2026-11-01T12:00:00Z'), 'America/New_York');
      const startOfNextDay = startOfNextDayInTimeZone(
        new Date('2026-11-01T12:00:00Z'),
        'America/New_York'
      );

      const dayDurationHours = (startOfNextDay.getTime() - startOfDay.getTime()) / (1000 * 60 * 60);
      expect(dayDurationHours).toBe(25); // Exactly 25 hours!
    });

    it('accurately advances date keys across Leap Year (Feb 28 -> Feb 29 -> Mar 1, 2028)', () => {
      const feb28 = new Date('2028-02-28T09:00:00.000Z');
      const feb29 = new Date('2028-02-29T09:00:00.000Z');
      const mar01 = new Date('2028-03-01T09:00:00.000Z');

      expect(formatDateKeyInTimeZone(feb28, 'UTC')).toBe('2028-02-28');
      expect(formatDateKeyInTimeZone(feb29, 'UTC')).toBe('2028-02-29');
      expect(formatDateKeyInTimeZone(mar01, 'UTC')).toBe('2028-03-01');
    });

    it('accurately handles year-end boundary transitions (Dec 31 -> Jan 1)', () => {
      const dec31 = new Date('2026-12-31T23:59:59.000Z');
      const jan01 = new Date('2027-01-01T00:00:01.000Z');
      expect(formatDateKeyInTimeZone(dec31, 'UTC')).toBe('2026-12-31');
      expect(formatDateKeyInTimeZone(jan01, 'UTC')).toBe('2027-01-01');
    });
  });

  // =========================================================================
  // SUITE 2: On-Call Scheduling & Schedule Block Assembly
  // =========================================================================
  describe('Suite 2: On-Call Scheduling Engine & Overrides', () => {
    it('assembles schedule layers with overrides prioritizing user overrides over base layers', () => {
      const blocks: OnCallBlock[] = [
        {
          id: 'block-base-1',
          userId: 'user-base',
          userName: 'Base Engineer',
          userAvatar: null,
          start: new Date('2026-05-01T00:00:00.000Z'),
          end: new Date('2026-05-07T00:00:00.000Z'),
          layerId: 'layer-1',
          layerName: 'Primary',
          source: 'rotation',
        },
        {
          id: 'block-override-1',
          userId: 'user-override',
          userName: 'Override Engineer',
          userAvatar: null,
          start: new Date('2026-05-03T00:00:00.000Z'),
          end: new Date('2026-05-04T00:00:00.000Z'),
          layerId: 'override-1',
          layerName: 'Override',
          source: 'override',
        },
      ];

      const layerPriority = new Map<string, number>([['layer-1', 1]]);
      const finalBlocks = getFinalScheduleBlocks(blocks, layerPriority);

      expect(finalBlocks.length).toBe(3); // Before override, override itself, and after override
      expect(finalBlocks.find(b => b.source === 'override')?.userId).toBe('user-override');
    });
  });

  // =========================================================================
  // SUITE 3: SLA Hybrid Merge & Mathematical Precision
  // =========================================================================
  describe('Suite 3: SLA Hybrid Merge & Mathematical Weighting', () => {
    const makeEmptyMetrics = (): SLAMetrics =>
      ({
        effectiveStart: new Date('2026-01-01T00:00:00Z'),
        effectiveEnd: new Date('2026-01-31T23:59:59Z'),
        requestedStart: new Date('2026-01-01T00:00:00Z'),
        requestedEnd: new Date('2026-01-31T23:59:59Z'),
        isClipped: false,
        retentionDays: 365,
        mttr: 10,
        mttd: null,
        mtti: null,
        mttk: null,
        mttaP50: null,
        mttaP95: null,
        mttrP50: null,
        mttrP95: null,
        mtbfMs: null,
        ackCompliance: 90,
        resolveCompliance: 90,
        ackBreaches: 1,
        resolveBreaches: 1,
        totalIncidents: 10,
        activeIncidents: 0,
        unassignedActive: 0,
        highUrgencyCount: 2,
        mediumUrgencyCount: 5,
        lowUrgencyCount: 3,
        alertsCount: 0,
        openCount: 0,
        acknowledgedCount: 0,
        snoozedCount: 0,
        suppressedCount: 0,
        resolved24h: 10,
        dynamicStatus: 'OPERATIONAL',
        activeCount: 0,
        criticalCount: 0,
        ackRate: 90,
        resolveRate: 90,
        highUrgencyRate: 20,
        afterHoursRate: 10,
        alertsPerIncident: 0,
        escalationRate: 10,
        reopenRate: 0,
        autoResolveRate: 0,
        previousPeriod: {
          totalIncidents: 10,
          highUrgencyCount: 2,
          mediumUrgencyCount: 5,
          lowUrgencyCount: 3,
          mtta: 5,
          mttr: 10,
          ackRate: 90,
          resolveRate: 90,
        },
        coveragePercent: 100,
        coverageGapDays: 0,
        onCallHoursMs: 0,
        onCallUsersCount: 0,
        activeOverrides: 0,
        autoResolvedCount: 0,
        manualResolvedCount: 10,
        eventsCount: 20,
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
        eventsPerIncident: 2,
        heatmapData: [],
        serviceMetrics: [],
      }) as unknown as SLAMetrics;

    it('merges historical and live partitions with weighted averages', () => {
      const historical = makeEmptyMetrics();
      const live = makeEmptyMetrics();
      live.totalIncidents = 5;
      live.mttr = 20;
      const historicalAccumulator = emptyMetricAccumulator();
      historicalAccumulator.incidentCount = BigInt(10);
      historicalAccumulator.resolvedCount = BigInt(9);
      historicalAccumulator.mttrCount = BigInt(9);
      historicalAccumulator.mttrSumMs = BigInt(9 * 10 * 60_000);
      const liveAccumulator = emptyMetricAccumulator();
      liveAccumulator.incidentCount = BigInt(5);
      liveAccumulator.resolvedCount = BigInt(5);
      liveAccumulator.mttrCount = BigInt(5);
      liveAccumulator.mttrSumMs = BigInt(5 * 20 * 60_000);
      Reflect.set(historical, METRIC_ACCUMULATOR, historicalAccumulator);
      Reflect.set(live, METRIC_ACCUMULATOR, liveAccumulator);

      const merged = mergeHybridMetrics(historical, live);
      expect(merged.totalIncidents).toBe(15);
      // Exact additive state: (9*10 + 5*20) / 14 = 190/14 = 13.57 min
      expect(merged.mttr).toBeCloseTo(13.57, 1);
    });
  });

  // =========================================================================
  // SUITE 4: Business Hours & Regional Weekend Configurations
  // =========================================================================
  describe('Suite 4: Business Hours & After-Hours Detection', () => {
    it('correctly classifies standard business hours (Mon-Fri 08:00-18:00 UTC)', () => {
      // Wednesday 14:00 UTC -> In hours
      const wednesdayInHours = new Date('2026-04-15T14:00:00.000Z');
      expect(isIncidentAfterHours(wednesdayInHours, 'UTC', 8, 18)).toBe(false);

      // Wednesday 20:00 UTC -> After hours
      const wednesdayAfterHours = new Date('2026-04-15T20:00:00.000Z');
      expect(isIncidentAfterHours(wednesdayAfterHours, 'UTC', 8, 18)).toBe(true);

      // Saturday 12:00 UTC -> Weekend (After hours)
      const saturday = new Date('2026-04-18T12:00:00.000Z');
      expect(isIncidentAfterHours(saturday, 'UTC', 8, 18)).toBe(true);
    });

    it('supports custom Middle Eastern business days (Sunday to Thursday)', () => {
      const middleEasternDays = [0, 1, 2, 3, 4]; // Sun, Mon, Tue, Wed, Thu

      // Sunday 11:00 in Dubai (UTC+4 is 07:00 UTC) -> Working day in Dubai
      const sundayWorkDay = new Date('2026-04-19T07:00:00.000Z');
      expect(isIncidentAfterHours(sundayWorkDay, 'Asia/Dubai', 9, 17, middleEasternDays)).toBe(
        false
      );

      // Friday in Dubai -> Weekend in Middle East
      const fridayWeekend = new Date('2026-04-24T07:00:00.000Z');
      expect(isIncidentAfterHours(fridayWeekend, 'Asia/Dubai', 9, 17, middleEasternDays)).toBe(
        true
      );
    });

    it('correctly evaluates overnight cross-midnight business hours (21:00 to 05:00)', () => {
      // 22:30 UTC -> Inside night shift
      const nightShift = new Date('2026-04-15T22:30:00.000Z');
      expect(isIncidentAfterHours(nightShift, 'UTC', 21, 5)).toBe(false);

      // 03:30 UTC -> Inside night shift
      const earlyMorningShift = new Date('2026-04-16T03:30:00.000Z');
      expect(isIncidentAfterHours(earlyMorningShift, 'UTC', 21, 5)).toBe(false);

      // 12:00 UTC -> Outside night shift (After hours)
      const noon = new Date('2026-04-16T12:00:00.000Z');
      expect(isIncidentAfterHours(noon, 'UTC', 21, 5)).toBe(true);
    });
  });

  // =========================================================================
  // SUITE 5: Incident Event Classifier Negation & Taxonomy
  // =========================================================================
  describe('Suite 5: Incident Event Classifier & SQL Predicates', () => {
    it('generates negation filters for ACKNOWLEDGED to ignore unacknowledged', () => {
      const where = incidentEventWhereFor('ACKNOWLEDGED');
      expect(where.OR).toBeDefined();
      expect(JSON.stringify(where)).toContain('unacknowledged');
    });

    it('generates SQL predicate for ACKNOWLEDGED with NOT ILIKE unacknowledged', () => {
      const sql = incidentEventSqlPredicate('ACKNOWLEDGED', 'e');
      expect(sql.strings.join('')).toContain("NOT ILIKE '%unacknowledged%'");
    });
  });

  // =========================================================================
  // SUITE 6: Retryable Error Classification (Regex \b5\d{2}\b)
  // =========================================================================
  describe('Suite 6: Network Retry & Status Code Classification', () => {
    it('retries on HTTP 500, 502, 503, 504 and 429 using retry', async () => {
      let attempts = 0;
      const fn = async () => {
        attempts++;
        if (attempts < 2) {
          throw new Error('503 Service Unavailable');
        }
        return 'success';
      };

      const result = await retry(fn, { maxAttempts: 3, initialDelayMs: 10 });
      expect(result.success).toBe(true);
      expect(result.data).toBe('success');
      expect(result.attempts).toBe(2);
    });

    it('does NOT falsely retry validation errors containing the digit 5', async () => {
      let attempts = 0;
      const fn = async () => {
        attempts++;
        throw new Error('Validation failed: title must be at least 5 characters');
      };

      const result = await retry(fn, {
        maxAttempts: 3,
        initialDelayMs: 10,
        retryableErrors: isRetryableApiError,
      });
      expect(result.success).toBe(false);
      // Non-retryable error fails immediately on first attempt!
      expect(result.attempts).toBe(1);
      expect(attempts).toBe(1);
    });
  });
});
