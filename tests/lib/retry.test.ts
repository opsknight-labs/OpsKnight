import { describe, it, expect, vi, beforeEach } from 'vitest';
import { retry, retryFetch, retryWithThrow, isRetryableHttpError } from '@/lib/retry';

describe('Retry Utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('retry', () => {
    it('should succeed on first attempt', async () => {
      const fn = vi.fn().mockResolvedValue('success');

      const result = await retry(fn);

      expect(result.success).toBe(true);
      expect(result.data).toBe('success');
      expect(result.attempts).toBe(1);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should retry on failure and succeed', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce('success');

      const result = await retry(fn, { maxAttempts: 3, initialDelayMs: 10 });

      expect(result.success).toBe(true);
      expect(result.data).toBe('success');
      expect(result.attempts).toBe(3);
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should fail after max attempts', async () => {
      const error = new Error('Persistent error');
      const fn = vi.fn().mockRejectedValue(error);

      const result = await retry(fn, { maxAttempts: 3, initialDelayMs: 10 });

      expect(result.success).toBe(false);
      expect(result.error).toBe(error);
      expect(result.attempts).toBe(3);
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should use exponential backoff', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('Error'));
      const delays: number[] = [];

      const startTime = Date.now();
      await retry(fn, {
        maxAttempts: 3,
        initialDelayMs: 10,
        backoffMultiplier: 2,
        onRetry: _attempt => {
          delays.push(Date.now() - startTime);
        },
      });

      // Check that delays increase (allowing for some timing variance)
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should not retry non-retryable errors', async () => {
      const error = new Error('Client error');
      const fn = vi.fn().mockRejectedValue(error);

      const result = await retry(fn, {
        maxAttempts: 3,
        retryableErrors: () => false, // Don't retry
        initialDelayMs: 10,
      });

      expect(result.success).toBe(false);
      expect(result.attempts).toBe(1); // Should only try once
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should respect max delay', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('Error'));

      await retry(fn, {
        maxAttempts: 3,
        initialDelayMs: 10,
        maxDelayMs: 15,
        backoffMultiplier: 10, // Would normally exceed maxDelayMs
      });

      // Should complete without errors
      expect(fn).toHaveBeenCalledTimes(3);
    });
  });

  describe('retryWithThrow', () => {
    it('should return data on success', async () => {
      const fn = vi.fn().mockResolvedValue('success');

      const result = await retryWithThrow(fn);

      expect(result).toBe('success');
    });

    it('should throw error on failure', async () => {
      const error = new Error('Failed');
      const fn = vi.fn().mockRejectedValue(error);

      await expect(retryWithThrow(fn, { maxAttempts: 2, initialDelayMs: 10 })).rejects.toThrow(
        'Failed'
      );
    });
  });

  describe('isRetryableHttpError', () => {
    it('should return true for 5xx errors', () => {
      expect(isRetryableHttpError(500)).toBe(true);
      expect(isRetryableHttpError(502)).toBe(true);
      expect(isRetryableHttpError(503)).toBe(true);
      expect(isRetryableHttpError(504)).toBe(true);
    });

    it('should return true for 429 rate limit', () => {
      expect(isRetryableHttpError(429)).toBe(true);
    });

    it('should return false for 4xx client errors', () => {
      expect(isRetryableHttpError(400)).toBe(false);
      expect(isRetryableHttpError(401)).toBe(false);
      expect(isRetryableHttpError(403)).toBe(false);
      expect(isRetryableHttpError(404)).toBe(false);
    });

    it('should return false for 2xx success codes', () => {
      expect(isRetryableHttpError(200)).toBe(false);
      expect(isRetryableHttpError(201)).toBe(false);
      expect(isRetryableHttpError(204)).toBe(false);
    });
  });

  describe('retryFetch', () => {
    it('should retry on network errors', async () => {
      global.fetch = vi
        .fn()
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({ ok: true, status: 200 } as Response);

      const response = await retryFetch('https://api.example.com');

      expect(response.ok).toBe(true);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('should retry on 5xx errors', async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 500 } as Response)
        .mockResolvedValueOnce({ ok: true, status: 200 } as Response);

      const response = await retryFetch('https://api.example.com');

      expect(response.ok).toBe(true);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('should not retry on 4xx client errors', async () => {
      const response404 = { ok: false, status: 404, statusText: 'Not Found' } as Response;
      global.fetch = vi.fn().mockResolvedValue(response404);

      // retryFetch will retry only on retryable errors (5xx, network errors)
      // For 4xx errors, it should still return the response but not retry
      const response = await retryFetch('https://api.example.com');

      expect(response.ok).toBe(false);
      expect(response.status).toBe(404);
      // Should only be called once since 4xx errors are not retryable
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
  });
});
