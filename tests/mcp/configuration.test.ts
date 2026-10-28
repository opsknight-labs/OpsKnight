import { describe, expect, it } from 'vitest';
import { mcpConfigurationIssues } from '@/lib/mcp/auth/config';

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
});
