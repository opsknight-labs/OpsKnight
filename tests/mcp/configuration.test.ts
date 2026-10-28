import { describe, expect, it } from 'vitest';
import { mcpConfigurationIssues, mcpOrigin } from '@/lib/mcp/auth/config';

const good = {
  MCP_PUBLIC_ORIGIN: 'https://opsknight.example.com',
  MCP_TOKEN_HASH_SECRET: 'a'.repeat(32),
} as unknown as NodeJS.ProcessEnv;

describe('MCP configuration diagnostics', () => {
  it('accepts a complete bootstrap configuration', () => {
    expect(mcpConfigurationIssues(good)).toEqual([]);
    expect(mcpConfigurationIssues({ ...good, MCP_PUBLIC_ORIGIN: 'http://localhost:3000' })).toEqual(
      []
    );
  });
  it('reports a missing or short secret without echoing it', () => {
    for (const secret of [undefined, '', 'short-secret']) {
      const issues = mcpConfigurationIssues({ ...good, MCP_TOKEN_HASH_SECRET: secret });
      expect(issues).toHaveLength(1);
      expect(issues[0]).toContain('MCP_TOKEN_HASH_SECRET');
      expect(JSON.stringify(issues)).not.toContain('short-secret');
    }
  });
  it('reports an insecure or malformed origin', () => {
    for (const origin of [
      'http://opsknight.example.com',
      'https://x.example.com/path',
      'not a url',
    ]) {
      const issues = mcpConfigurationIssues({ ...good, MCP_PUBLIC_ORIGIN: origin });
      expect(issues.some(issue => issue.includes('MCP_PUBLIC_ORIGIN'))).toBe(true);
    }
  });
  it('does not leave the process environment replaced', () => {
    const before = process.env;
    mcpConfigurationIssues({} as NodeJS.ProcessEnv);
    expect(process.env).toBe(before);
  });

  it('does not allow production to silently use the localhost origin fallback', () => {
    const issues = mcpConfigurationIssues({
      NODE_ENV: 'production',
      MCP_TOKEN_HASH_SECRET: 'a'.repeat(32),
    } as unknown as NodeJS.ProcessEnv);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('MCP_PUBLIC_ORIGIN or NEXTAUTH_URL');
  });

  it('rejects loopback HTTP origins in production even when explicitly configured', () => {
    const env = {
      NODE_ENV: 'production',
      MCP_PUBLIC_ORIGIN: 'http://localhost:3000',
      MCP_TOKEN_HASH_SECRET: 'a'.repeat(32),
    } as unknown as NodeJS.ProcessEnv;
    expect(() => mcpOrigin(env)).toThrow();
    expect(mcpConfigurationIssues(env)).toEqual([expect.stringContaining('MCP_PUBLIC_ORIGIN')]);
  });

  it('allows production loopback HTTP only with the explicit opt-in and an explicit origin', () => {
    const base = { NODE_ENV: 'production', MCP_TOKEN_HASH_SECRET: 'a'.repeat(32) };
    const env = (extra: Record<string, string>) =>
      ({ ...base, ...extra }) as unknown as NodeJS.ProcessEnv;
    for (const origin of ['http://localhost:3042', 'http://127.0.0.1:3042', 'http://[::1]:3042'])
      expect(
        mcpOrigin(env({ MCP_PUBLIC_ORIGIN: origin, MCP_ALLOW_LOOPBACK_HTTP_ORIGIN: 'true' }))
      ).toBe(new URL(origin).origin);
    for (const value of ['1', 'yes', 'TRUE', ''])
      expect(() =>
        mcpOrigin(
          env({ MCP_PUBLIC_ORIGIN: 'http://localhost:3042', MCP_ALLOW_LOOPBACK_HTTP_ORIGIN: value })
        )
      ).toThrow();
    for (const origin of [
      'http://opsknight.example.com',
      'http://10.0.0.5:3000',
      'http://localhost.example.com',
    ])
      expect(() =>
        mcpOrigin(env({ MCP_PUBLIC_ORIGIN: origin, MCP_ALLOW_LOOPBACK_HTTP_ORIGIN: 'true' }))
      ).toThrow();
    // The opt-in never revives the silent fallback.
    expect(() => mcpOrigin(env({ MCP_ALLOW_LOOPBACK_HTTP_ORIGIN: 'true' }))).toThrow();
  });
});
