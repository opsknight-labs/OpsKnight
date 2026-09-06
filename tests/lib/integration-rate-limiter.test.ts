import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  checkRateLimit,
  getRateLimitStatus,
  createRateLimitHeaders,
} from '@/lib/integrations/rate-limiter';

// Mock the global rate limiter
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(),
}));

import { checkRateLimit as checkGlobalRateLimit } from '@/lib/rate-limit';

describe('Integration Rate Limiter', () => {
  const testIntegrationId = 'test-integration-123';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('checkRateLimit', () => {
    it('should call global rate limiter', async () => {
      (checkGlobalRateLimit as any).mockResolvedValue({
        allowed: true,
        remaining: 99,
        resetAt: Date.now() + 60000,
        count: 1,
      });

      const result = await checkRateLimit(testIntegrationId);

      expect(checkGlobalRateLimit).toHaveBeenCalledWith(
        `integration:${testIntegrationId}`,
        expect.any(Number),
        expect.any(Number)
      );
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(99);
    });

    it('should handle rate limited response', async () => {
      const now = Date.now();
      const resetAt = now + 60000;
      (checkGlobalRateLimit as any).mockResolvedValue({
        allowed: false,
        remaining: 0,
        resetAt: resetAt,
        count: 101,
      });

      const result = await checkRateLimit(testIntegrationId);

      expect(result.allowed).toBe(false);
      expect(result.retryAfter).toBeGreaterThan(0);
      expect(result.retryAfter).toBeLessThanOrEqual(60);
    });
  });

  describe('getRateLimitStatus', () => {
    it('should return estimates (stubbed behavior)', () => {
      const status = getRateLimitStatus(testIntegrationId);
      expect(status.allowed).toBe(true);
      expect(status.remaining).toBeGreaterThan(0);
    });
  });

  describe('createRateLimitHeaders', () => {
    it('should create proper headers for allowed request', () => {
      const result = { allowed: true, remaining: 15, resetAt: Date.now() + 60000 };
      const headers = createRateLimitHeaders(result);

      expect(headers['X-RateLimit-Remaining']).toBe('15');
      expect(headers['X-RateLimit-Reset']).toBeDefined();
    });

    it('should include Retry-After for rate limited request', () => {
      const result = { allowed: false, remaining: 0, resetAt: Date.now() + 60000, retryAfter: 30 };
      const headers = createRateLimitHeaders(result);

      expect(headers['Retry-After']).toBe('30');
    });
  });
});
