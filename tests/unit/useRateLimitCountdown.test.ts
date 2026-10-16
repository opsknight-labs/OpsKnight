// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  formatRemainingTime,
  parseCooldownSeconds,
  useRateLimitCountdown,
} from '@/components/settings/authentication/useRateLimitCountdown';

describe('useRateLimitCountdown utilities', () => {
  describe('formatRemainingTime', () => {
    it('formats 0 or negative seconds as 0s', () => {
      expect(formatRemainingTime(0)).toBe('0s');
      expect(formatRemainingTime(-5)).toBe('0s');
    });

    it('formats pure seconds with singular and plural forms', () => {
      expect(formatRemainingTime(1)).toBe('1 second');
      expect(formatRemainingTime(15)).toBe('15 seconds');
      expect(formatRemainingTime(59)).toBe('59 seconds');
    });

    it('formats exact minutes', () => {
      expect(formatRemainingTime(60)).toBe('1 minute');
      expect(formatRemainingTime(120)).toBe('2 minutes');
      expect(formatRemainingTime(300)).toBe('5 minutes');
    });

    it('formats combined minutes and seconds', () => {
      expect(formatRemainingTime(65)).toBe('1m 5s');
      expect(formatRemainingTime(270)).toBe('4m 30s');
    });
  });

  describe('parseCooldownSeconds', () => {
    it('returns 0 for empty or non-rate-limit messages', () => {
      expect(parseCooldownSeconds('')).toBe(0);
      expect(parseCooldownSeconds('Invalid credentials. Check password.')).toBe(0);
    });

    it('parses combined minute and second tokens like 4m 30s', () => {
      expect(
        parseCooldownSeconds('Too many authentication policy changes. Try again in 4m 30s.')
      ).toBe(270);
    });

    it('parses words format like 25 seconds', () => {
      expect(
        parseCooldownSeconds('Too many authentication operations. Try again in 25 seconds.')
      ).toBe(25);
    });

    it('parses words format like 5 minutes', () => {
      expect(
        parseCooldownSeconds('Too many authentication operations. Try again in 5 minutes.')
      ).toBe(300);
    });

    it('parses short s format like 10s', () => {
      expect(parseCooldownSeconds('Too many requests. Try again in 10s.')).toBe(10);
    });
  });

  describe('useRateLimitCountdown hook', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('returns empty/inert state when message is empty or has no cooldown', () => {
      const { result } = renderHook(() => useRateLimitCountdown(''));
      expect(result.current.isCooldown).toBe(false);
      expect(result.current.displayMessage).toBe('');
      expect(result.current.remainingSeconds).toBe(0);

      const { result: nonCooldownResult } = renderHook(() =>
        useRateLimitCountdown('Operation failed. Check configuration.')
      );
      expect(nonCooldownResult.current.isCooldown).toBe(false);
      expect(nonCooldownResult.current.displayMessage).toBe(
        'Operation failed. Check configuration.'
      );
    });

    it('initializes with cooldown state and counts down every second', () => {
      const initialMessage = 'Too many authentication policy changes. Try again in 10 seconds.';
      const { result } = renderHook(() => useRateLimitCountdown(initialMessage));

      expect(result.current.isCooldown).toBe(true);
      expect(result.current.remainingSeconds).toBe(10);
      expect(result.current.displayMessage).toContain('Try again in 10 seconds');

      // Advance by 3 seconds
      act(() => {
        vi.advanceTimersByTime(3000);
      });

      expect(result.current.isCooldown).toBe(true);
      expect(result.current.remainingSeconds).toBe(7);
      expect(result.current.displayMessage).toContain('Try again in 7 seconds');

      // Advance past completion
      act(() => {
        vi.advanceTimersByTime(7000);
      });

      expect(result.current.isCooldown).toBe(false);
      expect(result.current.remainingSeconds).toBe(0);
      expect(result.current.displayMessage).toContain('Cooldown expired. You can try again now');
    });
  });
});
