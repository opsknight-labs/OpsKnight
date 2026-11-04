import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import { buildMcpConsentOffer } from '@/lib/mcp/auth/consent-offer';
import { consentIdentity, consentRedirectFacts } from '@/lib/mcp/auth/consent-identity';
import { assistantBrandFor } from '@/components/common/BrandLogos';
import { mcpHttpError } from '@/lib/mcp/auth/http';
import { McpBoundaryError } from '@/lib/mcp/core/errors';
import { missingConsentScopes, requireOperationAuthority } from '@/lib/mcp/core/execution';
import { MCP_OPERATION_MAP } from '@/lib/mcp/catalog';
import { authorizationActorFromUser } from '@/lib/authorization-actors';

const actor = (role: string, scopes: string[]) => ({
  ...authorizationActorFromUser({ id: 'u1', role, status: 'ACTIVE', teamMemberships: [] })!,
  apiKey: { id: 'mcp:g1', scopes },
});
const operation = (id: string) => MCP_OPERATION_MAP.get(id)!;

describe('B4: re-consent starts from the replaced connection', () => {
  it('pre-selects change permissions the previous grant had, and only those', () => {
    const offer = buildMcpConsentOffer({
      scopes: ['incidents:read', 'incidents:write', 'services:write'],
      explicitlyRequested: [],
      role: 'ADMIN',
      previouslyGranted: ['incidents:write'],
    });
    const checked = Object.fromEntries(
      offer.groups.flatMap(group => [...group.view, ...group.change]).map(i => [i.scope, i.checked])
    );
    expect(checked).toEqual({
      'incidents:read': true,
      'incidents:write': true,
      'services:write': false,
    });
  });
});

describe('B5: missing consent versus missing role', () => {
  it('names the scopes a role-permitted operation lacks', () => {
    const user = actor('USER', ['incidents:read']);
    expect(missingConsentScopes(user, operation('listServices'))).toEqual(['services:read']);
    let error: unknown;
    try {
      requireOperationAuthority(user, operation('listServices'));
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({ code: 'MCP_SCOPE_NOT_GRANTED', status: 403 });
    expect((error as McpBoundaryError).hint).toContain('services:read');
  });
  it('keeps MCP_OPERATION_FORBIDDEN when the role is what is missing', () => {
    const auditor = actor('AUDITOR', ['incidents:read', 'incidents:write']);
    expect(missingConsentScopes(auditor, operation('createIncident'))).toEqual([]);
    expect(() => requireOperationAuthority(auditor, operation('createIncident'))).toThrow(
      'MCP_OPERATION_FORBIDDEN'
    );
  });
  it('lets an authorized operation through', () => {
    expect(() =>
      requireOperationAuthority(actor('USER', ['services:read']), operation('listServices'))
    ).not.toThrow();
  });
  it('marks 401 challenges as invalid_token', () => {
    process.env.MCP_PUBLIC_ORIGIN = 'http://localhost:3000';
    const header = mcpHttpError(new McpBoundaryError('MCP_ACCESS_CHANGED', 401)).headers.get(
      'www-authenticate'
    )!;
    expect(header).toMatch(/^Bearer error="invalid_token", error_description="[^"\\]+", /);
    expect(header).toContain('resource_metadata="');
  });
});

describe('B8: consent identity', () => {
  it('identifies metadata-document clients by host and flags self-registered names', () => {
    expect(
      consentIdentity({
        metadataUrl: 'https://claude.ai/oauth/claude-code-client-metadata',
        dynamicRegistration: false,
      })
    ).toEqual({ kind: 'metadata', host: 'claude.ai' });
    expect(consentIdentity({ metadataUrl: null, dynamicRegistration: true })).toEqual({
      kind: 'self-registered',
    });
    expect(consentIdentity({ metadataUrl: null, dynamicRegistration: false })).toEqual({
      kind: 'registered',
    });
  });
  it('treats loopback and app-scheme redirects as local, web hosts as not', () => {
    expect(consentRedirectFacts('http://127.0.0.1:5173/cb')).toEqual({
      host: '127.0.0.1:5173',
      staysLocal: true,
    });
    expect(consentRedirectFacts('http://localhost/cb').staysLocal).toBe(true);
    expect(consentRedirectFacts('cursor://anysphere.cursor-mcp/oauth').staysLocal).toBe(true);
    expect(consentRedirectFacts('https://evil.example/cb')).toEqual({
      host: 'evil.example',
      staysLocal: false,
    });
  });
  it('shows a brand only for a verified host of that brand', () => {
    expect(assistantBrandFor('claude.ai')).toBe('claude');
    expect(assistantBrandFor('chatgpt.com')).toBe('chatgpt');
    expect(assistantBrandFor('www.cursor.com')).toBe('cursor');
    expect(assistantBrandFor('claude.ai.evil.example')).toBeNull();
    expect(assistantBrandFor('notclaude.ai')).toBeNull();
    expect(assistantBrandFor(null)).toBeNull();
  });
});
