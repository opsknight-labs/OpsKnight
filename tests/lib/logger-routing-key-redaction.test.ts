import { describe, expect, it } from 'vitest';
import {
  redactRoutingKeyParams,
  sanitizeAuditContext,
  sanitizeContext,
  sanitizeString,
} from '@/lib/logger';

const KEY = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

describe('routing keys in query strings never reach logs or audit rows', () => {
  it.each(['integrationKey', 'integration_key', 'routingKey', 'routing_key', 'key', 'token', 'secret'])(
    'redacts ?%s= on a relative path and keeps the other parameters',
    name => {
      const out = redactRoutingKeyParams(`/api/integrations/grafana?integrationId=int_1&${name}=${KEY}&x=1`);
      expect(out).not.toContain(KEY);
      expect(out).toContain('integrationId=int_1');
      expect(out).toContain(`${name}=[REDACTED]`);
      expect(out).toContain('&x=1');
    }
  );

  it('redacts a key that is the first parameter and is case-insensitive', () => {
    expect(redactRoutingKeyParams(`/api/events?IntegrationKey=${KEY}`)).toBe(
      '/api/events?IntegrationKey=[REDACTED]'
    );
  });

  it('does not touch parameters that merely end in key-like words', () => {
    const value = '/p?integrationId=int_1&monkey=1&keyboard=2';
    expect(redactRoutingKeyParams(value)).toBe(value);
  });

  it('redacts inside a log message, an Error message and a nested context', () => {
    const url = `/api/integrations/datadog?integrationId=int_1&integrationKey=${KEY}`;
    expect(sanitizeString(`POST ${url} failed`)).not.toContain(KEY);
    const logged = JSON.stringify(
      sanitizeContext({
        request: { url },
        error: new Error(`upstream rejected ${url}`),
      })
    );
    expect(logged).not.toContain(KEY);
    expect(logged).toContain('integrationId=int_1');
  });

  it('redacts absolute URLs too', () => {
    const out = sanitizeString(`https://ops.example.com/api/integrations/x?integrationId=1&routingKey=${KEY}`);
    expect(out).not.toContain(KEY);
  });

  it('redacts audit details but keeps the readable path', () => {
    const url = `/api/integrations/grafana?integrationId=int_1&key=${KEY}`;
    const stored = JSON.stringify(sanitizeAuditContext({ requestPath: url }));
    expect(stored).not.toContain(KEY);
    expect(stored).toContain('/api/integrations/grafana?integrationId=int_1');
  });
});
