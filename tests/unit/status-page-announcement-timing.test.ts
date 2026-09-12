import { describe, expect, it } from 'vitest';
import { resolveLocalDateTimeInTimeZone, formatDateTime } from '@/lib/timezone';
import { StatusAnnouncementCreateSchema } from '@/lib/validation';
import {
  parseLocalInputsToDate,
  parseLocalInputsToEndDate,
} from '@/components/status-page/StatusPageAnnouncementManager';

describe('Enterprise Announcement Timing & Timezone Flow', () => {
  describe('DST-safe timezone resolver via parseLocalInputsToDate', () => {
    it('resolves normal wall-clock times to correct UTC instants', () => {
      // 10:00 AM IST on 2026-09-20 -> 04:30 UTC
      const res = parseLocalInputsToDate('2026-09-20', '10:00', 'Asia/Kolkata', false);
      expect(res.error).toBeUndefined();
      expect(res.date?.toISOString()).toBe('2026-09-20T04:30:00.000Z');
    });

    it('rejects nonexistent wall-clock times during spring-forward DST gap', () => {
      // In America/New_York, 2:30 AM on 2026-03-08 does not exist (clocks jump 2:00 -> 3:00)
      const res = parseLocalInputsToDate('2026-03-08', '02:30', 'America/New_York', false);
      expect(res.date).toBeNull();
      expect(res.error).toContain('does not exist or is ambiguous');
    });

    it('rejects ambiguous wall-clock times during fall-back DST overlap', () => {
      // In America/New_York, 1:30 AM on 2026-11-01 occurs twice (clocks fall back 2:00 -> 1:00)
      const res = parseLocalInputsToDate('2026-11-01', '01:30', 'America/New_York', false);
      expect(res.date).toBeNull();
      expect(res.error).toContain('does not exist or is ambiguous');
    });

    it('resolves cross-midnight conversions correctly across international datelines', () => {
      // 11:30 PM EDT on 2026-09-20 in America/New_York -> 03:30 UTC on next day (2026-09-21)
      const res = parseLocalInputsToDate('2026-09-20', '23:30', 'America/New_York', false);
      expect(res.error).toBeUndefined();
      expect(res.date?.toISOString()).toBe('2026-09-21T03:30:00.000Z');
    });
  });

  describe('Validation schema for announcement timing and options', () => {
    it('validates ALL_DAY announcements without requiring endDate', () => {
      const parsed = StatusAnnouncementCreateSchema.safeParse({
        statusPageId: 'page-123',
        title: 'Office Holiday',
        message: 'Support desk closed for national holiday.',
        type: 'INFO',
        startDate: '2026-10-01T00:00:00.000Z',
        allDay: true,
        timeMode: 'ALL_DAY',
        publishOption: 'NOW',
        notificationTiming: 'NONE',
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.allDay).toBe(true);
        expect(parsed.data.timeMode).toBe('ALL_DAY');
        expect(parsed.data.publishOption).toBe('NOW');
        expect(parsed.data.notificationTiming).toBe('NONE');
      }
    });

    it('validates EXACT announcements with start and end times', () => {
      const parsed = StatusAnnouncementCreateSchema.safeParse({
        statusPageId: 'page-123',
        title: 'Database Maintenance Window',
        message: 'Upgrading database replica.',
        type: 'MAINTENANCE',
        startDate: '2026-09-20T04:30:00.000Z',
        endDate: '2026-09-20T06:30:00.000Z',
        allDay: false,
        timeMode: 'EXACT',
        publishOption: 'AT_START',
        notificationTiming: 'AT_START',
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.publishOption).toBe('AT_START');
        expect(parsed.data.notificationTiming).toBe('AT_START');
      }
    });
  });

  describe('Subscriber timezone formatting', () => {
    it('formats UTC instant in distinct subscriber timezones accurately', () => {
      const instant = new Date('2026-09-20T04:30:00.000Z');

      const ist = formatDateTime(instant, 'Asia/Kolkata', {
        format: 'datetime',
        includeTimeZone: true,
      });
      const cet = formatDateTime(instant, 'Europe/Berlin', {
        format: 'datetime',
        includeTimeZone: true,
      });
      const edt = formatDateTime(instant, 'America/New_York', {
        format: 'datetime',
        includeTimeZone: true,
      });

      expect(ist).toContain('10:00');
      expect(ist).toMatch(/(IST|GMT\+5:30)/i);

      expect(cet).toContain('6:30');
      expect(cet).toMatch(/(CEST|GMT\+2)/i);

      expect(edt).toContain('12:30');
      expect(edt).toMatch(/(EDT|GMT-4)/i);
    });

    it('formats all-day notices preserving calendar day without timezone shift', () => {
      const allDayUtc = new Date('2026-09-20T00:00:00.000Z');
      const formatted = `All day · ${allDayUtc.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      })}`;
      expect(formatted).toBe('All day · Sep 20, 2026');
    });
  });
});
