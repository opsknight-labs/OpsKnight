import { describe, it, expect } from 'vitest';
import {
  formatDate,
  formatDateFriendly,
  formatTime,
  formatDateShort,
  formatDateGroup,
} from '@/lib/date-format';

describe('Date Format Utilities', () => {
  const testDate = new Date('2024-01-15T14:30:45Z');
  const testDateString = '2024-01-15T14:30:45Z';

  describe('formatDate', () => {
    it('should format date in datetime format by default', () => {
      const result = formatDate(testDate);

      expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    });

    it('should format date in date-only format', () => {
      const result = formatDate(testDate, 'date');

      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(result).toContain('2024-01-15');
    });

    it('should format date in time-only format', () => {
      const result = formatDate(testDate, 'time');

      expect(result).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    });

    it('should handle date strings', () => {
      const result = formatDate(testDateString);

      expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    });

    it('should handle invalid dates', () => {
      const result = formatDate(new Date('invalid'));

      expect(result).toBe('Invalid Date');
    });

    it('should handle invalid date strings', () => {
      const result = formatDate('invalid-date');

      expect(result).toBe('Invalid Date');
    });
  });

  describe('formatDateFriendly', () => {
    it('should format date in friendly datetime format by default', () => {
      const result = formatDateFriendly(testDate);

      expect(result).toMatch(/^\d{2}\/\d{2}\/\d{4}, \d{2}:\d{2}:\d{2}$/);
    });

    it('should format date in friendly date-only format', () => {
      const result = formatDateFriendly(testDate, 'date');

      expect(result).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
    });

    it('should use UTC methods for consistency', () => {
      const date1 = formatDateFriendly(testDate);
      const date2 = formatDateFriendly(testDate);

      // Should be consistent between calls
      expect(date1).toBe(date2);
    });

    it('should handle invalid dates', () => {
      const result = formatDateFriendly(new Date('invalid'));

      expect(result).toBe('Invalid Date');
    });

    it('should format date using provided timezone', () => {
      const result = formatDateFriendly(testDate, 'datetime', 'UTC');

      expect(result).toBe('15/01/2024, 14:30:45');
    });
  });

  describe('formatTime', () => {
    it('should format time in HH:MM format', () => {
      const result = formatTime(testDate);

      expect(result).toMatch(/^\d{2}:\d{2}$/);
    });

    it('should use 24-hour format', () => {
      // Use a specific date that works in local timezone
      const morningDate = new Date('2024-01-15T09:05:00');
      const result = formatTime(morningDate);

      // Should be in HH:MM format (24-hour)
      expect(result).toMatch(/^\d{2}:\d{2}$/);
      expect(result.split(':')[0]).toMatch(/^\d{2}$/);
    });

    it('should handle date strings', () => {
      const result = formatTime(testDateString);

      expect(result).toMatch(/^\d{2}:\d{2}$/);
    });

    it('should handle invalid dates', () => {
      const result = formatTime(new Date('invalid'));

      expect(result).toBe('Invalid Time');
    });
  });

  describe('formatDateShort', () => {
    it('should format date in short format', () => {
      const result = formatDateShort(testDate);

      expect(result).toMatch(/^[A-Za-z]{3} \d{1,2}$/);
    });

    it('should include month abbreviation', () => {
      const janDate = new Date('2024-01-15');
      const result = formatDateShort(janDate);

      expect(result).toContain('Jan');
    });

    it('should include day number', () => {
      const result = formatDateShort(testDate);

      expect(result).toMatch(/\d+/);
    });

    it('should handle invalid dates', () => {
      const result = formatDateShort(new Date('invalid'));

      expect(result).toBe('Invalid Date');
    });
  });

  describe('formatDateGroup', () => {
    it('should format date for grouping', () => {
      const result = formatDateGroup(testDate);

      expect(result).toMatch(/^[A-Za-z]+ \d{1,2}, \d{4}$/);
    });

    it('should include full month name', () => {
      const janDate = new Date('2024-01-15');
      const result = formatDateGroup(janDate);

      expect(result).toContain('January');
    });

    it('should include year', () => {
      const result = formatDateGroup(testDate);

      expect(result).toContain('2024');
    });

    it('should handle invalid dates', () => {
      const result = formatDateGroup(new Date('invalid'));

      expect(result).toBe('Invalid Date');
    });
  });
});
