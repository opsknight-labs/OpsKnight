import { describe, expect, it } from 'vitest';
import { isAllowedRedirect, redirectUriAllowed, urlForLog } from '@/lib/mcp/auth/redirect-uri';

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

describe('isAllowedRedirect', () => {
  it.each([
    'https://claude.ai/api/mcp/auth_callback',
    'http://127.0.0.1:33418',
    'http://localhost:8787/callback',
    'cursor://anysphere.cursor-mcp/oauth/callback',
    'vscode://vscode.github-authentication/did-authenticate',
    'vscode-insiders://ms-vscode.mcp/callback',
    'windsurf://codeium.windsurf/oauth',
    'com.example.app:/oauth2redirect',
  ])('accepts %s', value => {
    expect(isAllowedRedirect(value)).toBe(true);
  });

  it.each([
    ['plain http off loopback', 'http://evil.example/callback'],
    ['credentials', 'https://u:p@claude.ai/cb'],
    ['a fragment', 'https://claude.ai/cb#x'],
    ['script', 'javascript:alert(1)'],
    ['inline data', 'data:text/html,hi'],
    ['a local file', 'file:///etc/passwd'],
    ['a blob', 'blob:https://x.example/1'],
    ['a socket', 'wss://x.example/cb'],
    ['an unknown dotless scheme', 'myapp://callback'],
    ['credentials on an app scheme', 'cursor://u:p@x/#f'],
    ['a fragment on an app scheme', 'cursor://anysphere.cursor-mcp/cb#x'],
    ['a non-canonical app scheme', 'Cursor://anysphere.cursor-mcp/cb'],
    ['an empty app callback', 'cursor:'],
    ['a non-canonical web address', 'https://Claude.ai/cb'],
  ])('refuses %s', (_name, value) => {
    expect(isAllowedRedirect(value)).toBe(false);
  });

  it('keeps metadata-document web redirects as written but app schemes exact', () => {
    expect(isAllowedRedirect('https://Claude.ai/cb', { canonicalWeb: false })).toBe(true);
    expect(isAllowedRedirect('Cursor://anysphere.cursor-mcp/cb', { canonicalWeb: false })).toBe(
      false
    );
  });

  it('matches an app-scheme callback exactly, with no port or path flexibility', () => {
    const registered = ['cursor://anysphere.cursor-mcp/oauth/callback'];
    expect(redirectUriAllowed(registered, registered[0])).toBe(true);
    expect(redirectUriAllowed(registered, 'cursor://anysphere.cursor-mcp/oauth/other')).toBe(false);
    expect(redirectUriAllowed(registered, 'cursor://anysphere.cursor-mcp:9/oauth/callback')).toBe(
      false
    );
  });
});

describe('urlForLog', () => {
  it('drops query strings and fragments, which can carry credentials', () => {
    expect(urlForLog('https://app.example/cb?api_key=secret')).toBe('https://app.example/cb?…');
    expect(urlForLog('http://localhost:5000/callback#token=secret')).toBe(
      'http://localhost:5000/callback?…'
    );
    expect(urlForLog('https://claude.ai/api/mcp/auth_callback')).toBe(
      'https://claude.ai/api/mcp/auth_callback'
    );
  });

  it('keeps a registered client id as it is, bounded', () => {
    expect(urlForLog('cmvt5fuwj034tm9k62fcz9r4z')).toBe('cmvt5fuwj034tm9k62fcz9r4z');
    expect(urlForLog('x'.repeat(400))).toHaveLength(256);
  });
});
