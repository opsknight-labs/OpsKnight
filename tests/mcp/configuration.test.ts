import { describe, expect, it } from 'vitest';
import { resolveMcpOrigin, validateMcpOrigin } from '@/lib/mcp/auth/config';

const env = (values: Record<string, string>) => values as unknown as NodeJS.ProcessEnv;
const production = { NODE_ENV: 'production' };

describe('MCP public origin (no MCP environment variables required)', () => {
  it('uses the App URL configured in Settings → System', () => {
    expect(resolveMcpOrigin('https://ops.example.com', env(production))).toEqual({
      origin: 'https://ops.example.com',
      originSource: 'app-url',
      originIssue: null,
    });
    // A trailing slash is the same origin.
    expect(resolveMcpOrigin('https://ops.example.com/', env(production)).origin).toBe(
      'https://ops.example.com'
    );
  });

  it('prefers an explicit override, then the App URL, then the application URL settings', () => {
    expect(
      resolveMcpOrigin(
        'https://ui.example.com',
        env({ ...production, MCP_PUBLIC_ORIGIN: 'https://override.example.com' })
      ).originSource
    ).toBe('override');
    expect(
      resolveMcpOrigin(null, env({ ...production, NEXTAUTH_URL: 'https://auth.example.com' }))
    ).toMatchObject({ origin: 'https://auth.example.com', originSource: 'app-environment' });
  });

  it('reports, without throwing, an unset public URL in production', () => {
    const resolved = resolveMcpOrigin(null, env(production));
    expect(resolved.origin).toBeNull();
    expect(resolved.originIssue).toContain('Settings → System');
  });

  it('defaults to localhost only outside production', () => {
    expect(resolveMcpOrigin(null, env({ NODE_ENV: 'development' }))).toMatchObject({
      origin: 'http://localhost:3000',
      originSource: 'development',
    });
  });

  it('rejects insecure or malformed public URLs with an actionable message', () => {
    for (const value of [
      'http://ops.example.com',
      'https://ops.example.com/opsknight',
      'https://user:pass@ops.example.com',
      'not a url',
    ]) {
      const resolved = resolveMcpOrigin(value, env(production));
      expect(resolved.origin, value).toBeNull();
      expect(resolved.originIssue, value).toContain('Settings → System');
    }
  });

  it('accepts loopback HTTP in production only when an administrator configured it', () => {
    expect(resolveMcpOrigin('http://localhost:3042', env(production)).origin).toBe(
      'http://localhost:3042'
    );
    expect(
      resolveMcpOrigin(null, env({ ...production, NEXTAUTH_URL: 'http://localhost:3042' })).origin
    ).toBeNull();
    for (const host of ['localhost', '127.0.0.1', '[::1]'])
      expect(validateMcpOrigin(`http://${host}:3042`, { production: true, explicit: true })).toBe(
        `http://${host}:3042`
      );
    expect(() =>
      validateMcpOrigin('http://10.0.0.5:3000', { production: true, explicit: true })
    ).toThrow('MCP_HTTPS_REQUIRED');
    expect(() =>
      validateMcpOrigin('http://localhost.example.com', { production: false, explicit: true })
    ).toThrow('MCP_HTTPS_REQUIRED');
  });
});
