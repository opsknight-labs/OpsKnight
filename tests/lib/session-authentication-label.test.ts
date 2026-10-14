import { describe, expect, it } from 'vitest';
import { sessionAuthenticationLabel } from '@/lib/session-authentication-label';
describe('proven session method labels', () => {
  it.each([undefined, null, 'unrecognized', 'legacy-emergency', '', 42])(
    'labels unproven method %s Unknown',
    method => {
      expect(sessionAuthenticationLabel(method)).toBe('Unknown');
    }
  );
  it('labels only explicit credentials and OIDC', () => {
    expect(sessionAuthenticationLabel('credentials')).toBe('Password');
    expect(sessionAuthenticationLabel('oidc')).toBe('OIDC');
  });
});
