import { beforeAll, describe, expect, it } from 'vitest';
import { McpBoundaryError } from '@/lib/mcp/core/errors';
import { mcpHttpError } from '@/lib/mcp/auth/http';
import { challengeScopes } from '@/lib/mcp/auth/discovery-policy';

beforeAll(() => {
  process.env.MCP_PUBLIC_ORIGIN = 'http://localhost:3000';
});

const challenge = (code: string, scope?: string) => {
  const error = new McpBoundaryError(code, 401);
  error.challengeScope = scope;
  return mcpHttpError(error).headers.get('www-authenticate');
};

describe('401 challenges', () => {
  it('sends no error code when no token was sent, and invalid_token otherwise', () => {
    expect(challenge('MCP_TOKEN_REQUIRED', 'incidents:read')).toBe(
      'Bearer resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource/mcp", scope="incidents:read"'
    );
    expect(challenge('MCP_INVALID_TOKEN', 'incidents:read')).toMatch(
      /^Bearer error="invalid_token", error_description="[^"]+", resource_metadata="[^"]+", scope="incidents:read"$/
    );
  });

  it('leaves out a scope value that could break out of the quoted field', () => {
    for (const unsafe of ['a"b', 'a\\b', 'a  b', ' a'])
      expect(challenge('MCP_TOKEN_REQUIRED', unsafe)).not.toContain('scope=');
    expect(challenge('MCP_TOKEN_REQUIRED')).not.toContain('scope=');
  });
});

describe('challengeScopes', () => {
  const policy = {
    enabled: true,
    dcrEnabled: true,
    dcrScopes: ['incidents:read', 'admin:manage'],
    cimdEnabled: true,
    cimdScopes: ['services:read'],
    cimdAllowedHosts: [],
    allowedBrowserOrigins: [],
  };
  it('prefers the registration ceiling, then the metadata-document one, never admin:manage', () => {
    expect(challengeScopes(policy)).toEqual(['incidents:read']);
    expect(challengeScopes({ ...policy, dcrEnabled: false })).toEqual(['services:read']);
    expect(challengeScopes({ ...policy, enabled: false })).toEqual([]);
    expect(challengeScopes(null)).toEqual([]);
  });
});
