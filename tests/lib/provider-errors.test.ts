import { describe, expect, it } from 'vitest';
import {
  integrationProviderError,
  notificationProviderUnavailable,
} from '@/lib/provider-errors';

describe('provider error normalization', () => {
  it('maps provider authentication codes without inspecting messages', () => {
    const error = integrationProviderError({
      provider: 'slack',
      operation: 'conversations.list',
      providerCode: 'token_revoked',
      status: 200,
    });

    expect(error.code).toBe('INTEGRATION_AUTHENTICATION_FAILED');
    expect(error.status).toBe(401);
    expect(error.retryable).toBe(false);
    expect(error.details).toMatchObject({
      provider: 'slack',
      providerCode: 'token_revoked',
    });
  });

  it('maps provider input/permission rejections to non-retryable validation errors', () => {
    const error = integrationProviderError({
      provider: 'slack',
      operation: 'conversations.join',
      providerCode: 'missing_scope',
      status: 200,
    });

    expect(error.code).toBe('INTEGRATION_VALIDATION_FAILED');
    expect(error.status).toBe(400);
    expect(error.retryable).toBe(false);
    expect(error.action).toContain('scopes');
  });

  it('maps provider rate limits and server failures to retryable safe errors', () => {
    for (const status of [429, 500, 503]) {
      const error = integrationProviderError({
        provider: 'jira',
        operation: 'GET /rest/api/3/myself',
        status,
      });

      expect(error.code).toBe('INTERNAL_ERROR');
      expect(error.status).toBe(500);
      expect(error.retryable).toBe(true);
    }
  });

  it('treats network failures as retryable without parsing the exception text', () => {
    const error = integrationProviderError({
      provider: 'jira',
      operation: 'POST /rest/api/3/issue',
      cause: new Error('arbitrary transport wording'),
    });

    expect(error.code).toBe('INTERNAL_ERROR');
    expect(error.retryable).toBe(true);
  });

  it('marks actual notification delivery outages as retryable provider failures', () => {
    const error = notificationProviderUnavailable({
      provider: 'web-push',
      operation: 'send_test_push',
    });

    expect(error.code).toBe('NOTIFICATION_PROVIDER_UNAVAILABLE');
    expect(error.status).toBe(503);
    expect(error.retryable).toBe(true);
  });
});