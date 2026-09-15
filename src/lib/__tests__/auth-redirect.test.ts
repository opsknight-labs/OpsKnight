import { describe, expect, it } from 'vitest';
import { safeInternalCallbackUrl } from '@/lib/auth-redirect';

describe('safeInternalCallbackUrl', () => {
  it('accepts ordinary internal paths', () => {
    expect(safeInternalCallbackUrl('/incidents')).toBe('/incidents');
    expect(safeInternalCallbackUrl('/settings/security?tab=sessions')).toBe(
      '/settings/security?tab=sessions'
    );
    expect(safeInternalCallbackUrl('/?tab=open')).toBe('/?tab=open');
    expect(safeInternalCallbackUrl('/m')).toBe('/m');
    expect(safeInternalCallbackUrl('/m/incidents/inc-123')).toBe('/m/incidents/inc-123');
  });

  it('honors surface-specific fallback destinations', () => {
    expect(safeInternalCallbackUrl(null, '/m')).toBe('/m');
    expect(safeInternalCallbackUrl('', '/m')).toBe('/m');
    expect(safeInternalCallbackUrl('/login', '/m')).toBe('/m');
    expect(safeInternalCallbackUrl('https://malicious.com', '/m')).toBe('/m');
    expect(safeInternalCallbackUrl(null, '/')).toBe('/');
  });

  it.each([
    'https://evil.example',
    'http://evil.example',
    '//evil.example',
    '///evil.example',
    '/\\evil.example',
    '/%5cevil.example',
    '/%2f%2fevil.example',
    'javascript:alert(1)',
    'data:text/html,x',
    '\n/incidents',
  ])('rejects unsafe callback %s', value => {
    expect(safeInternalCallbackUrl(value, '/safe')).toBe('/safe');
  });

  it.each([
    '/login',
    '/m/login',
    '/forgot-password',
    '/reset-password',
    '/set-password',
    '/setup',
    '/auth/signout',
    '/api/auth/signout',
  ])('rejects auth-loop destination %s', value => {
    expect(safeInternalCallbackUrl(value, '/safe')).toBe('/safe');
  });
});
