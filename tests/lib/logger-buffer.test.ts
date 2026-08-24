import { describe, it, expect, vi } from 'vitest';
import {
  logger,
  getLogBuffer,
  sanitizeString,
  runWithContext,
  getRequestContext,
  withRequestContext,
} from '@/lib/logger';
import * as publicLogsRoute from '@/app/api/public-logs/route';
import { createMockRequest, parseResponse } from '../helpers/api-test';

const mockAssertAdmin = vi.hoisted(() => vi.fn());
vi.mock('@/lib/rbac', () => ({
  assertAdmin: mockAssertAdmin,
}));

describe('Logger Buffer', () => {
  it('stores log entries for later retrieval', () => {
    const message = `buffer-test-${Date.now()}`;
    logger.info(message);

    const entries = getLogBuffer(50);
    const _validItems = entries.filter((item: any) => item.level === 'error'); // eslint-disable-line @typescript-eslint/no-explicit-any
    const match = entries.find(entry => entry.message === message);
    expect(match).toBeTruthy();
  });

  it('returns the most recent entry when limited', () => {
    const first = `buffer-first-${Date.now()}`;
    const second = `buffer-second-${Date.now()}`;
    logger.info(first);
    logger.info(second);

    const entries = getLogBuffer(1);
    expect(entries).toHaveLength(1);
    expect(entries[0].message).toBe(second);
  });
});

describe('String Sanitization & ReDoS Defense', () => {
  it('redacts sensitive tokens and emails cleanly', () => {
    expect(sanitizeString('Contact user at test@example.com for info')).toBe(
      'Contact user at [REDACTED] for info'
    );
    expect(sanitizeString('Token Bearer eyJhbGciOiJIUzI1NiJ9')).toBe('Token [REDACTED]');
    expect(sanitizeString('Webhook https://api.ops.com?token=secret123&other=val')).toBe(
      'Webhook [REDACTED]&other=val'
    );
  });

  it('safely handles strings with repeated percent signs without polynomial backtracking', () => {
    const payload = '%' + '%'.repeat(5000) + '@example.com';
    const start = performance.now();
    const result = sanitizeString(payload);
    const elapsed = performance.now() - start;

    expect(typeof result).toBe('string');
    expect(elapsed).toBeLessThan(100);
  });

  it('safely handles strings with repeated http prefixes without polynomial backtracking', () => {
    const payload = 'http://' + 'http://'.repeat(2000) + '?token=abc';
    const start = performance.now();
    const result = sanitizeString(payload);
    const elapsed = performance.now() - start;

    expect(typeof result).toBe('string');
    expect(elapsed).toBeLessThan(100);
  });
});

describe('Public Logs API', () => {
  it('returns log entries without stack traces', async () => {
    mockAssertAdmin.mockResolvedValue({ id: 'admin-1', role: 'ADMIN', status: 'ACTIVE' });

    const message = `public-logs-${Date.now()}`;
    logger.error(message, { error: new Error('kaboom') });

    const req = await createMockRequest('GET', '/api/public-logs?limit=50');
    const res = await publicLogsRoute.GET(req);
    const { status, data } = await parseResponse(res);

    expect(status).toBe(200);
    const entries = Array.isArray(data?.data) ? data.data : [];
    const entry = entries.find((item: any) => item.message === message); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(entry).toBeTruthy();
    expect(entry.error?.message).toBe('kaboom');
    expect(entry.error?.stack).toBeUndefined();
  });
});

describe('AsyncLocalStorage Request Context', () => {
  it('propagates request context to log entries automatically', () => {
    const message = `context-test-${Date.now()}`;
    runWithContext({ requestId: 'req-123', userId: 'user-456', component: 'api' }, () => {
      expect(getRequestContext()).toEqual({
        requestId: 'req-123',
        userId: 'user-456',
        component: 'api',
      });
      logger.info(message);
    });

    const entries = getLogBuffer(50);
    const match = entries.find(entry => entry.message === message);
    expect(match).toBeTruthy();
    expect(match?.requestId).toBe('req-123');
    expect(match?.userId).toBe('user-456');
    expect(match?.component).toBe('api');
  });

  it('allows explicit context to override AsyncLocalStorage context', () => {
    const message = `override-test-${Date.now()}`;
    runWithContext({ requestId: 'req-original', userId: 'user-original', component: 'api' }, () => {
      logger.info(message, { requestId: 'req-custom', component: 'worker' });
    });

    const entries = getLogBuffer(50);
    const match = entries.find(entry => entry.message === message);
    expect(match).toBeTruthy();
    expect(match?.requestId).toBe('req-custom');
    expect(match?.userId).toBe('user-original');
    expect(match?.component).toBe('worker');
  });

  it('keeps concurrent asynchronous request contexts isolated', async () => {
    const observed = await Promise.all([
      runWithContext({ requestId: 'request-a' }, async () => {
        await new Promise(resolve => setTimeout(resolve, 5));
        return getRequestContext().requestId;
      }),
      runWithContext({ requestId: 'request-b' }, async () => {
        await Promise.resolve();
        return getRequestContext().requestId;
      }),
    ]);

    expect(observed).toEqual(['request-a', 'request-b']);
  });

  it('wraps route handlers and returns a correlation header', async () => {
    const handler = withRequestContext(async () => {
      return Response.json({ requestId: getRequestContext().requestId });
    }, 'api.test');
    const response = await handler(
      new Request('http://localhost/api/test', { headers: { 'x-request-id': 'external-123' } })
    );

    expect(response.headers.get('x-request-id')).toBe('external-123');
    await expect(response.json()).resolves.toEqual({ requestId: 'external-123' });
  });
});
