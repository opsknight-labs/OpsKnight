import { describe, expect, it } from 'vitest';
import { jsonOk } from '@/lib/api-response';
import { logger, withRequestContext } from '@/lib/logger';

describe('request correlation contract', () => {
  it('uses one incoming id for logs, response headers, and response envelopes', async () => {
    const handler = withRequestContext(async () => {
      logger.info('correlation.test');
      return jsonOk({ ok: true });
    }, 'api.correlation.test');

    const response = await handler(
      new Request('https://opsknight.test/api/test', {
        headers: { 'x-request-id': 'request-shared-123' },
      })
    );
    const body = await response.json();

    expect(response.headers.get('x-request-id')).toBe('request-shared-123');
    expect(body.requestId).toBe('request-shared-123');
  });
});
