import { normalizeDedupKeys } from '@/lib/incidents/event-identity';
import { describe, expect, it } from 'vitest';
import {
  sanitizeProviderData,
  sanitizeIntegrationEnvelope,
  isCredentialField,
} from '@/lib/integrations/payload-security';

describe('shared integration credential filtering', () => {
  it.each([
    'secret_key',
    'ssh_private_key',
    'authorization_header',
    'auth_header',
    'AWS_SECRET_ACCESS_KEY',
    'clientSecret',
    'refresh_token',
    'databasePassword',
    'x-api-key',
    'credentials',
    'proxyAuthorizationHeader',
    '%54oken',
    '%41PI_KEY',
    '%41uthorization',
  ])('classifies credential field %s', key => {
    expect(isCredentialField(key)).toBe(true);
    expect(sanitizeProviderData({ nested: [{ [key]: { arbitrary: 'sensitive-value' } }] })).toEqual(
      { nested: [{ [key]: '[REDACTED]' }] }
    );
  });
  it.each([
    'groupKey',
    'dedup_key',
    'monkey',
    'fingerprint',
    'teamKey',
    'secretary',
    'authorizationStatus',
    'authenticationMethod',
    'tokenCount',
    'public_key',
    'owner',
  ])('preserves ordinary business field %s', key => {
    expect(isCredentialField(key)).toBe(false);
    expect(sanitizeProviderData({ [key]: 'ordinary-context' })).toEqual({
      [key]: 'ordinary-context',
    });
  });
  it('redacts encoded URL credential fields and multiline private keys while preserving routing context', () => {
    const result = sanitizeProviderData({
      urls: [
        'https://user:sensitive-password@host/path?secret_key=sensitive-one&teamKey=ops',
        'https://host/path?ssh%5Fprivate%5Fkey=sensitive-two#auth_header=sensitive-three',
        'https://host/path?%54oken=sensitive-four&%41PI_KEY=sensitive-five&%6bey=sensitive-six&%73ig=sensitive-seven',
      ],
      text: 'prefix -----BEGIN RSA PRIVATE KEY-----\nsensitive-pem\n-----END RSA PRIVATE KEY----- suffix',
      owner: 'oncall@example.test',
    });
    expect(JSON.stringify(result)).not.toContain('sensitive-');
    expect(JSON.stringify(result)).toContain('teamKey=ops');
    expect(result).toMatchObject({
      owner: 'oncall@example.test',
      text: 'prefix [REDACTED] suffix',
    });
  });
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
