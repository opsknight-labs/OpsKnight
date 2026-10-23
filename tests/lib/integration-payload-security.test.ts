import { normalizeDedupKeys } from '@/lib/incidents/event-identity';
import { describe, expect, it } from 'vitest';
import {
  sanitizeProviderData,
  sanitizeIntegrationEnvelope,
} from '@/lib/integrations/payload-security';

describe('shared integration credential filtering', () => {
  it('removes nested credentials while preserving domain identifiers and context', () => {
    const input = {
      routing_key: 'sensitive-routing',
      headers: { 'x-api-key': 'sensitive-header', 'x-integration-key': 'sensitive-header' },
      raw: {
        routingKey: 'sensitive-routing',
        payload: {
          custom_details: {
            api_key: 'sensitive-api',
            accessToken: 'sensitive-token',
            groupKey: 'group',
            dedup_key: 'identity',
            fingerprint: 'fingerprint',
            state: 'down',
          },
        },
      },
    };
    const output = sanitizeProviderData(input);
    expect(JSON.stringify(output)).not.toContain('sensitive-');
    expect(output).toMatchObject({
      raw: {
        payload: {
          custom_details: {
            groupKey: 'group',
            dedup_key: 'identity',
            fingerprint: 'fingerprint',
            state: 'down',
          },
        },
      },
    });
    expect(sanitizeProviderData({ owner: 'owner@example.test', teamKey: 'operations' })).toEqual({
      owner: 'owner@example.test',
      teamKey: 'operations',
    });
    expect(input.routing_key).toBe('sensitive-routing');
  });
  it('preserves the original implicit incident identity across filtering and replay', () => {
    const input = {
      serviceId: 'service',
      integrationId: 'integration',
      integrationType: 'WEBHOOK',
      receivedAt: new Date(),
      providerPayload: { routing_key: 'private' },
      event: {
        event_action: 'trigger' as const,
        dedup_key: '',
        payload: {
          summary: 'Bearer private-token',
          source: 'host',
          severity: 'critical' as const,
          custom_details: { routing_key: 'private' },
        },
      },
    };
    const expected = normalizeDedupKeys('', input.integrationId, input.event.payload).primary;
    const sanitized = sanitizeIntegrationEnvelope(input);
    expect(
      normalizeDedupKeys(sanitized.event.dedup_key, input.integrationId, sanitized.event.payload)
        .primary
    ).toBe(expected);
    expect(sanitizeIntegrationEnvelope(sanitized)).toEqual(sanitized);
    expect(JSON.stringify(sanitized)).not.toContain('private');
  });

  it('filters credential-bearing strings and repeated references without mutating provider input', () => {
    const item = { authorization: 'Bearer sensitive-value' };
    expect(sanitizeProviderData([item, item])).toEqual([
      { authorization: '[REDACTED]' },
      { authorization: '[REDACTED]' },
    ]);
    expect(sanitizeProviderData('postgresql://user:password@localhost/db')).not.toContain(
      'password'
    );
  });
});
