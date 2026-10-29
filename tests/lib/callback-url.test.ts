import { describe, expect, it } from 'vitest';
import { isSafeCallbackUrl, sanitizeCallbackUrl } from '@/lib/callback-url';

describe('callback URL security contract', () => {
  const accepted = [
    '/incidents/abc',
    '/services',
    '/action-items?status=OPEN',
    '/status#current',
  ];

  const rejected = [
    '',
    'https://evil.example',
    '//evil.example',
    '\\evil.example',
    '/\\evil.example',
    '/https:evil.example',
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    '/login',
    '/login/oidc',
    '/m/login',
    '/auth/signout',
    '/api/auth/signout',
    '/foo/signout/bar',
  ];

  it.each(accepted)('accepts safe same-origin path %s', candidate => {
    expect(isSafeCallbackUrl(candidate)).toBe(true);
    expect(sanitizeCallbackUrl(candidate)).toBe(candidate);
  });

  it.each(rejected)('rejects unsafe callback %s', candidate => {
    expect(isSafeCallbackUrl(candidate)).toBe(false);
    expect(sanitizeCallbackUrl(candidate, '/safe')).toBe('/safe');
  });

  it('fails closed for absent callback values', () => {
    expect(isSafeCallbackUrl(null)).toBe(false);
    expect(isSafeCallbackUrl(undefined)).toBe(false);
    expect(sanitizeCallbackUrl(null)).toBe('/');
  });

  it.each([
    '/%2f%2fevil.example',
    '/%5cevil.example',
    '/%2F%5Cevil.example',
    '/%252f%252fevil.example',
  ])('never turns encoded separator payload %s into an external redirect', candidate => {
    const result = sanitizeCallbackUrl(candidate);
    expect(result.startsWith('/')).toBe(true);
    expect(result.startsWith('//')).toBe(false);
    // The sanitizer returns a path string only; browser URL resolution must
    // therefore remain on the caller-provided origin.
    const resolved = new URL(result, 'https://opsknight.example');
    expect(resolved.origin).toBe('https://opsknight.example');
  });
});
