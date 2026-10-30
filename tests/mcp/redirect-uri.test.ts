import { describe, expect, it } from 'vitest';
import { redirectUriAllowed } from '@/lib/mcp/auth/redirect-uri';

const CLAUDE_CODE = ['http://localhost/callback', 'http://127.0.0.1/callback'];

describe('redirectUriAllowed', () => {
  it('matches a registered loopback redirect on any port', () => {
    expect(redirectUriAllowed(CLAUDE_CODE, 'http://localhost:53172/callback')).toBe(true);
    expect(redirectUriAllowed(CLAUDE_CODE, 'http://127.0.0.1:8765/callback')).toBe(true);
    expect(
      redirectUriAllowed(['http://localhost:8765/callback'], 'http://localhost:9/callback')
    ).toBe(true);
  });

  it.each([
    ['another loopback host', 'http://[::1]:5000/callback'],
    ['another path', 'http://localhost:5000/other'],
    ['an added query', 'http://localhost:5000/callback?x=1'],
    ['credentials', 'http://user:pw@localhost:5000/callback'],
    ['a fragment', 'http://localhost:5000/callback#x'],
    ['a non-loopback host', 'http://evil.example:5000/callback'],
    ['https on loopback', 'https://localhost:5000/callback'],
  ])('refuses %s', (_name, requested) => {
    expect(redirectUriAllowed(CLAUDE_CODE, requested)).toBe(false);
  });

  it('keeps https redirects exact', () => {
    const registered = ['https://claude.ai/api/mcp/auth_callback'];
    expect(redirectUriAllowed(registered, 'https://claude.ai/api/mcp/auth_callback')).toBe(true);
    expect(redirectUriAllowed(registered, 'https://claude.ai:444/api/mcp/auth_callback')).toBe(
      false
    );
    expect(redirectUriAllowed(registered, 'https://claude.com/api/mcp/auth_callback')).toBe(false);
  });
});
