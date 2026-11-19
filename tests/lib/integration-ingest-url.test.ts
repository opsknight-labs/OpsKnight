import { describe, expect, it } from 'vitest';
import { getWebhookUrl } from '@/lib/integrations/ingest-url';

describe('getWebhookUrl', () => {
  it('builds provider ingest URLs from the given App URL', () => {
    expect(getWebhookUrl('https://ops.example.com', 'DATADOG', 'int_123', 'key-abc')).toBe(
      'https://ops.example.com/api/integrations/datadog?integrationId=int_123&integrationKey=key-abc'
    );
  });

  it('does not read the environment when a base URL is supplied', () => {
    const previous = process.env.NEXT_PUBLIC_APP_URL;
    process.env.NEXT_PUBLIC_APP_URL = 'https://env.example.com';
    try {
      expect(getWebhookUrl('https://settings.example.com', 'GRAFANA', 'int_1', 'k')).toMatch(
        /^https:\/\/settings\.example\.com\/api\/integrations\/grafana\?/
      );
    } finally {
      if (previous === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
      else process.env.NEXT_PUBLIC_APP_URL = previous;
    }
  });

  it('removes trailing slashes so the path has no double slash', () => {
    expect(getWebhookUrl('https://ops.example.com/', 'WEBHOOK', 'int_1', 'k')).toBe(
      'https://ops.example.com/api/integrations/webhook?integrationId=int_1&integrationKey=k'
    );
    expect(
      getWebhookUrl('https://ops.example.com/opsknight//', 'EVENTS_API_V2', 'int_1', 'k')
    ).toBe('https://ops.example.com/opsknight/api/events');
  });

  it('URL-encodes the integration key', () => {
    expect(getWebhookUrl('https://ops.example.com', 'SENTRY', 'int_1', 'a+b/c=d&e f')).toBe(
      'https://ops.example.com/api/integrations/sentry?integrationId=int_1&integrationKey=a%2Bb%2Fc%3Dd%26e%20f'
    );
  });

  it('points EVENTS_API_V2 at /api/events without the key in the query string', () => {
    expect(getWebhookUrl('https://ops.example.com', 'EVENTS_API_V2', 'int_1', 'secret')).toBe(
      'https://ops.example.com/api/events'
    );
  });

  it('keeps the PagerDuty-compatible enqueue path', () => {
    expect(getWebhookUrl('https://ops.example.com', 'PAGERDUTY', 'int_1', 'k')).toBe(
      'https://ops.example.com/api/integrations/pagerduty/v2/enqueue?integrationId=int_1&integrationKey=k'
    );
  });
});
