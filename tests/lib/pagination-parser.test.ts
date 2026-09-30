import { describe, it, expect } from 'vitest';
import {
  parsePageParam,
  parsePageSizeParam,
  calculatePaginationBounds,
  formatPaginationSummary,
  parseEnumValue,
} from '@/lib/pagination-parser';

describe('pagination-parser', () => {
  describe('parsePageParam', () => {
    it('handles normal positive integers', () => {
      expect(parsePageParam(1)).toBe(1);
      expect(parsePageParam('5')).toBe(5);
      expect(parsePageParam(' 42 ')).toBe(42);
    });

    it('handles NaN, non-numeric strings, and invalid inputs gracefully', () => {
      expect(parsePageParam('abc')).toBe(1);
      expect(parsePageParam(NaN)).toBe(1);
      expect(parsePageParam(undefined)).toBe(1);
      expect(parsePageParam(null)).toBe(1);
      expect(parsePageParam(-5)).toBe(1);
      expect(parsePageParam(0)).toBe(1);
    });

    it('respects custom defaultPage', () => {
      expect(parsePageParam('invalid', 3)).toBe(3);
    });

    it('floors decimal page inputs', () => {
      expect(parsePageParam(4.9)).toBe(4);
      expect(parsePageParam('3.2')).toBe(3);
    });
  });

  describe('parsePageSizeParam', () => {
    it('handles valid sizes and caps at maximum', () => {
      expect(parsePageSizeParam('25')).toBe(25);
      expect(parsePageSizeParam('500', 20, 100)).toBe(100);
    });

    it('handles invalid sizes by falling back to default', () => {
      expect(parsePageSizeParam('not-a-number', 20)).toBe(20);
      expect(parsePageSizeParam(-10, 20)).toBe(20);
    });
  });

  describe('calculatePaginationBounds', () => {
    it('calculates correct bounds for standard pagination', () => {
      const bounds = calculatePaginationBounds({ totalItems: 95, page: 2, pageSize: 20 });
      expect(bounds.totalPages).toBe(5);
      expect(bounds.page).toBe(2);
      expect(bounds.skip).toBe(20);
      expect(bounds.take).toBe(20);
      expect(bounds.startItem).toBe(21);
      expect(bounds.endItem).toBe(40);
      expect(bounds.hasPrev).toBe(true);
      expect(bounds.hasNext).toBe(true);
    });

    it('clamps page to totalPages if requested page is out of bounds', () => {
      const bounds = calculatePaginationBounds({ totalItems: 50, page: 9999, pageSize: 20 });
      expect(bounds.totalPages).toBe(3);
      expect(bounds.page).toBe(3);
      expect(bounds.skip).toBe(40);
      expect(bounds.startItem).toBe(41);
      expect(bounds.endItem).toBe(50);
      expect(bounds.hasNext).toBe(false);
      expect(bounds.hasPrev).toBe(true);
    });

    it('handles 0 items gracefully without displaying 1-0', () => {
      const bounds = calculatePaginationBounds({ totalItems: 0, page: 1, pageSize: 20 });
      expect(bounds.totalPages).toBe(1);
      expect(bounds.page).toBe(1);
      expect(bounds.skip).toBe(0);
      expect(bounds.startItem).toBe(0);
      expect(bounds.endItem).toBe(0);
      expect(bounds.hasPrev).toBe(false);
      expect(bounds.hasNext).toBe(false);
    });
  });

  describe('formatPaginationSummary', () => {
    it('formats non-zero item counts correctly', () => {
      expect(formatPaginationSummary(1, 20, 45, 'users')).toBe('Showing 1-20 of 45 users');
    });

    it('formats 0 items correctly avoiding 1-0 display', () => {
      expect(formatPaginationSummary(0, 0, 0, 'users')).toBe('Showing 0 of 0 users');
    });
  });

  describe('parseEnumValue', () => {
    const allowed = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;

    it('returns matched enum value', () => {
      expect(parseEnumValue('PUBLISHED', allowed)).toBe('PUBLISHED');
      expect(parseEnumValue('  DRAFT  ', allowed)).toBe('DRAFT');
    });

    it('returns fallback or undefined for invalid enum value', () => {
      expect(parseEnumValue('SOMETHING_ELSE', allowed)).toBeUndefined();
      expect(parseEnumValue('INVALID', allowed, 'DRAFT')).toBe('DRAFT');
      expect(parseEnumValue(123, allowed)).toBeUndefined();
    });
  });
});
