import { afterEach, describe, expect, it, vi } from 'vitest';
import { hasConfidentialAgentTransport } from '@/lib/runbooks/agent-transport';

afterEach(() => vi.unstubAllEnvs());
describe('Agent secret transport', () => {
  it('ignores spoofed forwarding headers without explicit proxy trust', () => {
    vi.stubEnv('TRUST_PROXY_HEADERS', 'false');
    expect(
      hasConfidentialAgentTransport(
        new Request('http://app/claim', {
          headers: { 'x-forwarded-proto': 'https' },
        })
      )
    ).toBe(false);
    expect(hasConfidentialAgentTransport(new Request('https://app/claim'))).toBe(true);
    expect(
      hasConfidentialAgentTransport(
        new Request('https://app/claim', {
          headers: { 'x-forwarded-proto': 'https' },
        })
      )
    ).toBe(false);
  });
  it('requires an unambiguous overwritten protocol at a trusted ingress', () => {
    vi.stubEnv('TRUST_PROXY_HEADERS', 'true');
    for (const protocol of ['http', 'https,http', 'https, https']) {
      expect(
        hasConfidentialAgentTransport(
          new Request('http://app/claim', {
            headers: { 'x-forwarded-proto': protocol },
          })
        )
      ).toBe(false);
    }
    expect(
      hasConfidentialAgentTransport(
        new Request('http://app/claim', {
          headers: { 'x-forwarded-proto': 'https' },
        })
      )
    ).toBe(true);
  });
});
